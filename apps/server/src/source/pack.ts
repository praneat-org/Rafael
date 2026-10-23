import { createHash } from 'node:crypto';
import { PROTOCOL_VERSION, type ServerMessage } from '@rafael/protocol';
import { log } from '../log.js';
import type { DriveFile, SourceProvider } from './drive.js';

// D11: pack text lives in memory only (PackStore). log() gets counts / ms, never content.
export type TokenCounter = (text: string) => number | Promise<number>;

// ponytail: conservative over-estimate (ASCII ~3 chars/token, every other char = 1 token, so Thai is
// never under-counted). Upgrade: inject LlmClient.countTokens (Vertex countTokens, D20) when it exists.
export const estimateTokens: TokenCounter = (text) => {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3) + other;
};

export interface PackFileRef {
  file: string; // display name used inside anchors (unique per pack)
  fileId: string;
}
export interface Pack {
  packId: string; // sha256 of text: same input => same id
  text: string; // byte-stable: no timestamps / session ids (cache prefix)
  anchors: string[]; // exact `[file › locator]` ids, unique; BE-94 verifies against this list
  tokens: number;
  files: PackFileRef[];
  unreadable: (PackFileRef & { reason: string })[];
  hints: string[];
  builtAt: number;
  buildMs: number;
}

export class PackTooLargeError extends Error {
  readonly code = 'PACK_TOO_LARGE' as const;
  constructor(
    readonly tokens: number,
    readonly max: number,
    /** per-file tokens, largest first, so the user can pick what to drop */
    readonly files: (PackFileRef & { tokens: number })[],
  ) {
    super('PACK_TOO_LARGE');
  }
}

export interface BuildOptions {
  countTokens?: TokenCounter;
  maxTokens?: number; // PACK_MAX_TOKENS, default 150k
  warnRatio?: number; // log warn above this share of maxTokens
  concurrency?: number;
  maxHints?: number;
  onStatus?: (m: Extract<ServerMessage, { t: 'pack.status' }>) => void;
  now?: () => number;
}

const clean = (s: string) =>
  s
    .replace(/[[\]›\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'untitled';

/** Deterministic unique labels: sort by (name, fileId); 2nd+ file with the same name gets ` (n)`. */
function labels(files: DriveFile[]): Map<string, string> {
  const sorted = [...files].sort(
    (a, b) => a.name.localeCompare(b.name) || a.fileId.localeCompare(b.fileId),
  );
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const f of sorted) {
    const base = clean(f.name);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
    used.add(name);
    out.set(f.fileId, name);
  }
  return out;
}

const HINT = /\b(?:[A-Z][A-Za-z0-9]+|[A-Z0-9]{2,})\b/g;
// ponytail: latin-only heuristic (Thai has no case); add a Thai proper-noun pass if STT misses names
function hintsFrom(names: string[], texts: string[], max: number): string[] {
  const freq = new Map<string, number>();
  for (const n of names)
    for (const w of n.match(HINT) ?? []) freq.set(w, (freq.get(w) ?? 0) + 1000);
  for (const t of texts) for (const w of t.match(HINT) ?? []) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

export async function buildPack(
  provider: SourceProvider,
  folder: string,
  o: BuildOptions = {},
): Promise<Pack> {
  const now = o.now ?? Date.now;
  const count: TokenCounter = o.countTokens ?? estimateTokens;
  const max = o.maxTokens ?? 150_000;
  const t0 = now();

  const listed = await provider.listFolder(folder);
  const label = labels(listed);
  const order = [...listed].sort((a, b) =>
    label.get(a.fileId)!.localeCompare(label.get(b.fileId)!),
  );
  const ref = (f: DriveFile): PackFileRef => ({ file: label.get(f.fileId)!, fileId: f.fileId });

  const results: Awaited<ReturnType<SourceProvider['readFile']>>[] = new Array(order.length);
  const readDone: DriveFile[] = [];
  const emit = (state: 'loading' | 'ready' | 'error', tokens = 0) =>
    o.onStatus?.({
      v: PROTOCOL_VERSION,
      t: 'pack.status',
      state,
      files: readDone.map(ref),
      tokens,
      unreadable: readDone.filter((f) => 'unreadable' in results[order.indexOf(f)]!).map(ref),
    });

  // bounded-concurrency reads; results land by index so output order never depends on timing
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(o.concurrency ?? 4, order.length) }, async () => {
      while (next < order.length) {
        const i = next++;
        results[i] = await provider.readFile(order[i]!);
        readDone.push(order[i]!);
        emit('loading');
      }
    }),
  );

  const anchors: string[] = [];
  const seen = new Set<string>();
  const parts: { fileId: string; text: string }[] = [];
  const unreadable: Pack['unreadable'] = [];
  order.forEach((f, i) => {
    const r = results[i]!;
    if ('unreadable' in r) {
      unreadable.push({ ...ref(f), reason: r.unreadable });
      return;
    }
    for (const c of r.chunks) {
      const base = clean(c.locator);
      let loc = base;
      for (let n = 2; seen.has(`[${label.get(f.fileId)} › ${loc}]`); n++) loc = `${base} (${n})`;
      const a = `[${label.get(f.fileId)} › ${loc}]`;
      seen.add(a);
      anchors.push(a);
      parts.push({ fileId: f.fileId, text: `${a}\n${c.text.trim()}` });
    }
  });

  const text = parts.map((p) => p.text).join('\n\n');
  const tokens = text ? await count(text) : 0;
  const files = order.filter((f) => parts.some((p) => p.fileId === f.fileId)).map(ref);

  if (tokens > max) {
    const perFile = await Promise.all(
      files.map(async (f) => ({
        ...f,
        tokens: await count(
          parts
            .filter((p) => p.fileId === f.fileId)
            .map((p) => p.text)
            .join('\n\n'),
        ),
      })),
    );
    emit('error', tokens);
    log('pack.too_large', { tokens, max, files: files.length });
    throw new PackTooLargeError(
      tokens,
      max,
      perFile.sort((a, b) => b.tokens - a.tokens || a.file.localeCompare(b.file)),
    );
  }
  if (tokens > max * (o.warnRatio ?? 0.8)) log('pack.near_limit', { tokens, max });

  const buildMs = now() - t0;
  emit('ready', tokens);
  log('pack.built', {
    tokens,
    files: files.length,
    unreadable: unreadable.length,
    anchors: anchors.length,
    buildMs,
  });
  return {
    packId: createHash('sha256').update(text).digest('hex').slice(0, 32),
    text,
    anchors,
    tokens,
    files,
    unreadable,
    hints: hintsFrom(
      files.map((f) => f.file),
      parts.map((p) => p.text),
      o.maxHints ?? 100,
    ),
    builtAt: t0,
    buildMs,
  };
}

/**
 * Session packs in memory (D11). Hook cleanup to SessionStore.onEnd (BE-96, PR #14, not merged yet):
 * `store.onEnd((s) => packs.clear(s.id))`.
 */
export class PackStore {
  private packs = new Map<string, Pack>();
  private pending = new Map<string, object>();

  get(sessionId: string) {
    return this.packs.get(sessionId);
  }
  set(sessionId: string, pack: Pack) {
    this.packs.set(sessionId, pack);
  }
  /** Drop the pack and cancel any in-flight rebuild so it cannot resurrect. */
  clear(sessionId: string) {
    this.pending.delete(sessionId);
    this.packs.delete(sessionId);
  }
  /**
   * Rebuild, then swap in one assignment. A failed build keeps the old pack (throws). If the session
   * ended or a newer refresh started meanwhile, this result is dropped (returns undefined).
   */
  async refresh(sessionId: string, build: () => Promise<Pack>): Promise<Pack | undefined> {
    const tok = {};
    this.pending.set(sessionId, tok);
    const pack = await build();
    if (this.pending.get(sessionId) !== tok) return undefined;
    this.pending.delete(sessionId);
    this.packs.set(sessionId, pack);
    return pack;
  }
}
