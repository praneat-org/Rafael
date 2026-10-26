import { createHash } from 'node:crypto';
import { PROTOCOL_VERSION, type ServerMessage } from '@rafael/protocol';
import { log } from '../log.js';
import type { DriveFile, SourceProvider } from './drive.js';

// D11: pack text lives in memory only (PackStore). log() gets counts / ms, never content.
export type TokenCounter = (text: string) => number | Promise<number>;

// ponytail: conservative over-estimate (ASCII ~3 chars/token, every other char = 1 token, so Thai is
// never under-counted). Exact count: pass packTokenCounter(client, model) (brain/gemini.ts, countTokens) as buildPack countTokens; this stays the no-client fallback.
export const estimateTokens = (text: string): number => {
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
/** One anchored chunk. file / locator are the deduped labels used in `anchor`. */
export interface PackChunk {
  anchor: string; // `[file › locator]`, unique per pack
  file: string;
  fileId: string;
  locator: string;
  text: string; // trimmed body, without the anchor line
}

/** The only place pack text is formatted: text, anchors and chunks cannot disagree. */
export const renderPackText = (chunks: PackChunk[]) =>
  chunks.map((c) => `${c.anchor}\n${c.text}`).join('\n\n');

export interface Pack {
  packId: string; // sha256 of text: same input => same id
  text: string; // = renderPackText(chunks); byte-stable, no timestamps / session ids (cache prefix)
  anchors: string[]; // = chunks.map(c => c.anchor); BE-94 verifies against this list
  chunks: PackChunk[];
  tokens: number;
  files: PackFileRef[];
  unreadable: (PackFileRef & { reason: string })[];
  hints: string[];
  builtAt: number;
  buildMs: number;
}

/** PACK_TOO_LARGE lists at most this many files (largest first): enough to pick what to drop, bounded wire size */
export const MAX_TOO_LARGE_FILES = 10;

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

// NFC + strip zero-width so visually identical names (Mac NFD vs NFC) give one label
const clean = (s: string) =>
  s
    .normalize('NFC')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[[\]›\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'untitled';

// total order by UTF-16 code unit (locale-independent; localeCompare ties on NFC/NFD)
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Deterministic unique labels: sort by (clean name, fileId); 2nd+ file with the same name gets ` (n)`. */
function labels(files: DriveFile[]): Map<string, string> {
  const sorted = [...files].sort(
    (a, b) => cmp(clean(a.name), clean(b.name)) || cmp(a.fileId, b.fileId),
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
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
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
  const concurrency = o.concurrency ?? 4;
  const warnRatio = o.warnRatio ?? 0.8;
  const maxHints = o.maxHints ?? 100;
  // bad options fail loudly up front (0 workers would otherwise surface as a TypeError later)
  if (!(Number.isFinite(max) && max > 0)) throw new RangeError('maxTokens must be > 0');
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RangeError('concurrency must be a positive integer');
  if (!(warnRatio >= 0 && warnRatio <= 1)) throw new RangeError('warnRatio must be within 0..1');
  if (!Number.isInteger(maxHints) || maxHints < 0)
    throw new RangeError('maxHints must be a non-negative integer');
  const t0 = now();

  const listed = await provider.listFolder(folder);
  const label = labels(listed);
  const order = [...listed].sort(
    (a, b) => cmp(label.get(a.fileId)!, label.get(b.fileId)!) || cmp(a.fileId, b.fileId),
  );
  const ref = (f: DriveFile): PackFileRef => ({ file: label.get(f.fileId)!, fileId: f.fileId });

  const results: Awaited<ReturnType<SourceProvider['readFile']>>[] = new Array(order.length);
  const readDone: DriveFile[] = [];
  const unreadableDone: DriveFile[] = []; // kept apart so emit stays O(n)
  const emit = (state: 'loading' | 'ready' | 'error', tokens = 0) =>
    o.onStatus?.({
      v: PROTOCOL_VERSION,
      t: 'pack.status',
      state,
      files: readDone.map(ref),
      tokens,
      unreadable: unreadableDone.map(ref),
      read: readDone.length,
      total: order.length,
    });

  // bounded-concurrency reads; results land by index so output order never depends on timing
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, order.length) }, async () => {
      while (next < order.length) {
        const i = next++;
        try {
          results[i] = await provider.readFile(order[i]!);
        } catch {
          results[i] = { unreadable: 'read failed' }; // fixed text, never e.message (D11)
        }
        readDone.push(order[i]!);
        if ('unreadable' in results[i]!) unreadableDone.push(order[i]!);
        emit('loading');
      }
    }),
  );

  const seen = new Set<string>();
  const chunks: PackChunk[] = [];
  const unreadable: Pack['unreadable'] = [];
  order.forEach((f, i) => {
    const r = results[i]!;
    if ('unreadable' in r) {
      unreadable.push({ ...ref(f), reason: r.unreadable });
      return;
    }
    const file = label.get(f.fileId)!;
    for (const c of r.chunks) {
      const base = clean(c.locator);
      let locator = base;
      for (let n = 2; seen.has(`[${file} › ${locator}]`); n++) locator = `${base} (${n})`;
      const anchor = `[${file} › ${locator}]`;
      seen.add(anchor);
      chunks.push({ anchor, file, fileId: f.fileId, locator, text: c.text.trim() });
    }
  });

  const text = renderPackText(chunks);
  const anchors = chunks.map((c) => c.anchor);
  const tokens = text ? await count(text) : 0;
  const files = order.filter((f) => chunks.some((c) => c.fileId === f.fileId)).map(ref);

  if (tokens > max) {
    // ponytail: per-file numbers are the sync estimate (no extra counter calls that could fail or
    // fan out): the UI shows them as approximate; exact per-file counts need a bounded counter pass
    const perFile = files.map((f) => ({
      ...f,
      tokens: estimateTokens(renderPackText(chunks.filter((c) => c.fileId === f.fileId))),
    }));
    emit('error', tokens);
    log('pack.too_large', { tokens, max, files: files.length });
    throw new PackTooLargeError(
      tokens,
      max,
      perFile
        .sort((a, b) => b.tokens - a.tokens || cmp(a.file, b.file))
        .slice(0, MAX_TOO_LARGE_FILES),
    );
  }
  if (tokens > max * warnRatio) log('pack.near_limit', { tokens, max });

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
    chunks,
    tokens,
    files,
    unreadable,
    hints: hintsFrom(
      files.map((f) => f.file),
      chunks.map((c) => c.text),
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
