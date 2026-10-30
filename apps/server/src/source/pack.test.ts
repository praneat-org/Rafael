import { ServerMessage } from '@rafael/protocol';
import { expect, test, vi } from 'vitest';
import type { DriveFile, ReadResult, SourceProvider } from './drive.js';
import {
  buildPack,
  estimateTokens,
  MAX_TOO_LARGE_FILES,
  PackStore,
  PackTooLargeError,
  renderPackText,
} from './pack.js';

// Synthetic content only — no customer data.
const F = (fileId: string, name: string): DriveFile => ({ fileId, name, mimeType: 'x' });
function provider(
  files: DriveFile[],
  reads: Record<string, ReadResult>,
  delay = (_id: string) => 0,
) {
  return {
    listFolder: async () => files,
    readFile: async (f: DriveFile) => {
      await new Promise((r) => setTimeout(r, delay(f.fileId)));
      return reads[f.fileId]!;
    },
  } satisfies SourceProvider;
}
const doc = (t: string): ReadResult => ({ chunks: [{ locator: 'เอกสาร', text: t }] });

test('every chunk starts with its anchor and all anchors are listed', async () => {
  const p = await buildPack(
    provider([F('1', 'Deck')], {
      '1': {
        chunks: [
          { locator: 'slide 1', text: 'a' },
          { locator: 'slide 2', text: 'b' },
        ],
      },
    }),
    'x',
  );
  expect(p.anchors).toEqual(['[Deck › slide 1]', '[Deck › slide 2]']);
  expect(p.text).toBe('[Deck › slide 1]\na\n\n[Deck › slide 2]\nb');
});

test('duplicate file names and duplicate locators get unique anchors, deterministic by fileId', async () => {
  const reads = {
    b: doc('B'),
    a: doc('A'),
    c: {
      chunks: [
        { locator: 'tab T', text: '1' },
        { locator: 'tab T', text: '2' },
      ],
    },
  };
  const files = [F('b', 'Price'), F('a', 'Price'), F('c', 'Sheet')];
  const p1 = await buildPack(provider(files, reads), 'x');
  const p2 = await buildPack(provider([...files].reverse(), reads), 'x');
  expect(p1.anchors).toEqual([
    '[Price › เอกสาร]',
    '[Price (2) › เอกสาร]',
    '[Sheet › tab T]',
    '[Sheet › tab T (2)]',
  ]);
  expect(p1.files.find((f) => f.fileId === 'a')!.file).toBe('Price'); // lowest fileId first
  expect(p2).toEqual({ ...p1, builtAt: p2.builtAt, buildMs: p2.buildMs });
});

test('names that tie (NFC vs NFD, zero-width) give one packId under every list order', async () => {
  const nfc = 'Café';
  const nfd = 'Café';
  const files = [F('4', nfd), F('2', nfc), F('3', 'a​b'), F('1', 'ab')];
  const reads = { '1': doc('one'), '2': doc('two'), '3': doc('three'), '4': doc('four') };
  const ids = new Set<string>();
  let perm = files;
  for (let i = 0; i < 24; i++) {
    perm = [...perm.slice(1), perm[0]!];
    if (i % 2) perm = [...perm].reverse();
    ids.add((await buildPack(provider(perm, reads), 'x')).packId);
  }
  expect(ids.size).toBe(1);
  const p = await buildPack(provider(files, reads), 'x');
  expect(p.anchors).toEqual([
    `[${nfc} › เอกสาร]`, // fileId 2
    `[${nfc} (2) › เอกสาร]`, // fileId 4 (was NFD)
    '[ab › เอกสาร]', // fileId 1
    '[ab (2) › เอกสาร]', // fileId 3 (zero-width stripped)
  ]);
});

test('chunks are the single source: text and anchors derive from them', async () => {
  const p = await buildPack(
    provider([F('1', 'Deck'), F('2', 'Deck')], {
      '1': { chunks: [{ locator: 'slide 1', text: '  a \n' }] },
      '2': { chunks: [{ locator: 'slide 1', text: 'b' }] },
    }),
    'x',
  );
  expect(p.chunks).toEqual([
    { anchor: '[Deck › slide 1]', file: 'Deck', fileId: '1', locator: 'slide 1', text: 'a' },
    {
      anchor: '[Deck (2) › slide 1]',
      file: 'Deck (2)',
      fileId: '2',
      locator: 'slide 1',
      text: 'b',
    },
  ]);
  expect(p.text).toBe(renderPackText(p.chunks));
  expect(p.anchors).toEqual(p.chunks.map((c) => c.anchor));
});

test('pack logs keep their fields (allowlisted) and never contain content', async () => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((l) => void lines.push(String(l)));
  try {
    await buildPack(provider([F('1', 'SecretName')], { '1': doc('secretbody') }), 'x');
  } finally {
    spy.mockRestore();
  }
  const built = JSON.parse(lines.find((l) => l.includes('pack.built'))!);
  expect(built).toMatchObject({ tokens: expect.any(Number), files: 1, anchors: 1 });
  expect(lines.join('\n')).not.toMatch(/droppedCount|secretbody|SecretName/);
});

test('anchor delimiters in file names are neutralised', async () => {
  const p = await buildPack(provider([F('1', 'a] › [b')], { '1': doc('x') }), 'x');
  expect(p.anchors).toEqual(['[a b › เอกสาร]']);
});

test('pack is byte-stable regardless of read timing, clock, concurrency', async () => {
  const files = [F('1', 'A'), F('2', 'B'), F('3', 'C')];
  const reads = { '1': doc('one'), '2': doc('two'), '3': doc('three') };
  const a = await buildPack(
    provider(files, reads, (id) => (id === '1' ? 20 : 0)),
    'x',
    {
      now: () => 1,
    },
  );
  const b = await buildPack(provider(files, reads), 'x', { now: () => 999, concurrency: 1 });
  expect(a.text).toBe(b.text);
  expect(a.packId).toBe(b.packId);
  expect(a.hints).toEqual(b.hints);
});

test('unreadable files are reported, not in text or anchors', async () => {
  const p = await buildPack(
    provider([F('1', 'A'), F('2', 'Scan')], {
      '1': doc('x'),
      '2': { unreadable: 'no text layer (scanned?)' },
    }),
    'x',
  );
  expect(p.unreadable).toEqual([{ file: 'Scan', fileId: '2', reason: 'no text layer (scanned?)' }]);
  expect(p.text).not.toContain('Scan');
  expect(p.files.map((f) => f.fileId)).toEqual(['1']);
});

test('tokens come from the injected counter on the full text', async () => {
  const seen: string[] = [];
  const p = await buildPack(provider([F('1', 'A')], { '1': doc('hello') }), 'x', {
    countTokens: (t) => (seen.push(t), 42),
  });
  expect(p.tokens).toBe(42);
  expect(seen[0]).toBe(p.text);
});

test('default estimate never under-counts Thai (1 token per non-ASCII char)', () => {
  expect(estimateTokens('สวัสดี')).toBe(6);
  expect(estimateTokens('abcdef')).toBe(2);
});

test('over PACK_MAX_TOKENS -> PACK_TOO_LARGE with files largest first, and status error', async () => {
  const states: string[] = [];
  const run = buildPack(
    provider([F('1', 'Aaa'), F('2', 'Zzz')], { '1': doc('x'), '2': doc('y'.repeat(500)) }),
    'x',
    { countTokens: (t) => t.length, maxTokens: 100, onStatus: (m) => states.push(m.state) },
  );
  const err = (await run.catch((e) => e)) as PackTooLargeError;
  expect(err).toBeInstanceOf(PackTooLargeError);
  expect(err.code).toBe('PACK_TOO_LARGE');
  expect(err.files.map((f) => f.file)).toEqual(['Zzz', 'Aaa']);
  expect(states.at(-1)).toBe('error');
  expect(
    ServerMessage.safeParse({
      v: 1,
      t: 'error',
      code: err.code,
      files: err.files.map((f) => ({ name: f.file, tokens: f.tokens })),
    }).success,
  ).toBe(true);
  // exactly at the limit is fine
  const ok = await buildPack(provider([F('1', 'S')], { '1': doc('x') }), 'x', {
    countTokens: () => 100,
    maxTokens: 100,
  });
  expect(ok.tokens).toBe(100);
});

test('BE-112: exclude skips files; read/total count only the rest; too-large files carry fileId', async () => {
  const seen: { read?: number; total?: number }[] = [];
  const p = provider([F('1', 'Aaa'), F('2', 'Zzz'), F('3', 'Mmm')], {
    '1': doc('x'),
    '2': doc('y'.repeat(500)),
    '3': doc('z'),
  });
  const o = {
    countTokens: (t: string) => t.length,
    onStatus: (m: { read?: number; total?: number }) => seen.push(m),
  };
  const big = (await buildPack(p, 'x', { ...o, maxTokens: 100 }).catch(
    (e) => e,
  )) as PackTooLargeError;
  expect(big.files[0]).toMatchObject({ fileId: '2', file: 'Zzz' });
  const ok = await buildPack(p, 'x', {
    ...o,
    maxTokens: 100,
    exclude: [big.files[0]!.fileId, 'nope'],
  });
  expect(ok.files.map((f) => f.fileId)).toEqual(['1', '3']);
  expect(ok.text).not.toContain('yyy');
  expect(seen.at(-1)).toMatchObject({ read: 2, total: 2 });
});

test('BE-110: PACK_TOO_LARGE lists at most MAX_TOO_LARGE_FILES files, largest first', async () => {
  const ids = Array.from({ length: 15 }, (_, i) => String(i));
  const err = (await buildPack(
    provider(
      ids.map((i) => F(i, `F${i.padStart(2, '0')}`)),
      Object.fromEntries(ids.map((i) => [i, doc('y'.repeat(30 + 30 * Number(i)))])),
    ),
    'x',
    { countTokens: (t) => t.length, maxTokens: 10 },
  ).catch((e) => e)) as PackTooLargeError;
  expect(err.files).toHaveLength(MAX_TOO_LARGE_FILES);
  expect(err.files[0]!.file).toBe('F14');
  expect(err.files.map((f) => f.tokens)).toEqual(
    [...err.files.map((f) => f.tokens)].sort((a, b) => b - a),
  );
});

test('pack.status flows loading n/m then ready, and validates against the protocol schema', async () => {
  const msgs: ServerMessage[] = [];
  await buildPack(
    provider([F('1', 'A'), F('2', 'B')], { '1': doc('x'), '2': { unreadable: 'empty' } }),
    'x',
    { onStatus: (m) => msgs.push(m) },
  );
  expect(msgs.map((m) => m.t === 'pack.status' && [m.state, m.files.length])).toEqual([
    ['loading', 1],
    ['loading', 2],
    ['ready', 2],
  ]);
  expect(msgs.map((m) => m.t === 'pack.status' && [m.read, m.total])).toEqual([
    [1, 2],
    [2, 2],
    [2, 2],
  ]);
  const last = msgs.at(-1)!;
  expect(last.t === 'pack.status' && last.unreadable).toEqual([{ file: 'B', fileId: '2' }]);
  for (const m of msgs) expect(ServerMessage.safeParse(m).success).toBe(true);
});

test('hints: file names first, capitalised / acronym words, capped', async () => {
  const p = await buildPack(
    provider([F('1', 'Praneat Proposal')], {
      '1': doc('we use SLA and Kubernetes. also lowercase words'),
    }),
    'x',
    { maxHints: 4 },
  );
  expect(p.hints).toEqual(['Praneat', 'Proposal', 'Kubernetes', 'SLA']);
});

const mk = (t: string) => buildPack(provider([F('1', 'A')], { '1': doc(t) }), 'x');

test('PackStore: set/get/clear (end deletes)', async () => {
  const s = new PackStore();
  const p = await mk('x');
  s.set('s1', p);
  expect(s.get('s1')).toBe(p);
  s.clear('s1');
  expect(s.get('s1')).toBeUndefined();
});

test('refresh replaces the pack; failed rebuild keeps the old one', async () => {
  const s = new PackStore();
  s.set('s', await mk('old'));
  const fresh = await s.refresh('s', () => mk('new'));
  expect(s.get('s')).toBe(fresh);
  expect(s.get('s')!.text).toContain('new');
  await expect(s.refresh('s', () => Promise.reject(new Error('boom')))).rejects.toThrow();
  expect(s.get('s')).toBe(fresh);
});

test('refresh in flight when the session ends does not resurrect the pack; newer refresh wins', async () => {
  const s = new PackStore();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = s.refresh('s', async () => (await gate, mk('slow')));
  s.clear('s');
  release();
  expect(await slow).toBeUndefined();
  expect(s.get('s')).toBeUndefined();

  // `first` is held until `second` has finished, so it completes last and must be dropped
  let release2!: () => void;
  const gate2 = new Promise<void>((r) => (release2 = r));
  const first = s.refresh('t', async () => (await gate2, mk('first')));
  await s.refresh('t', () => mk('second'));
  release2();
  expect(await first).toBeUndefined();
  expect(s.get('t')!.text).toContain('second');
});

test('reads are capped at `concurrency` in flight', async () => {
  let inFlight = 0;
  let peak = 0;
  const files = ['1', '2', '3', '4', '5'].map((id) => F(id, `f${id}`));
  const p: SourceProvider = {
    listFolder: async () => files,
    readFile: async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return doc('x');
    },
  };
  await buildPack(p, 'x', { concurrency: 2 });
  expect(peak).toBe(2);
});

test('bad options throw RangeError up front', async () => {
  const p = provider([F('1', 'A')], { '1': doc('x') });
  for (const o of [
    { concurrency: 0 },
    { concurrency: -1 },
    { concurrency: Number.NaN },
    { concurrency: 1.5 },
    { maxTokens: 0 },
    { maxTokens: Number.NaN },
    { warnRatio: -0.1 },
    { warnRatio: 1.1 },
    { warnRatio: Number.NaN },
    { maxHints: -1 },
  ])
    await expect(buildPack(p, 'x', o), JSON.stringify(o)).rejects.toBeInstanceOf(RangeError);
  await expect(buildPack(p, 'x', { warnRatio: 0, maxHints: 0 })).resolves.toBeDefined();
});

test('a readFile that rejects marks the file unreadable (fixed reason, no error text), pack still builds', async () => {
  const msgs: ServerMessage[] = [];
  const p: SourceProvider = {
    listFolder: async () => [F('1', 'Good'), F('2', 'Bad')],
    readFile: async (f) => {
      if (f.fileId === '2') throw new Error('secret-from-provider');
      return doc('ok');
    },
  };
  const pack = await buildPack(p, 'x', { onStatus: (m) => msgs.push(m) });
  expect(pack.unreadable).toEqual([{ file: 'Bad', fileId: '2', reason: 'read failed' }]);
  expect(pack.anchors).toEqual(['[Good › เอกสาร]']);
  const last = msgs.at(-1)!;
  expect(last.t === 'pack.status' && last.unreadable).toEqual([{ file: 'Bad', fileId: '2' }]);
  expect(JSON.stringify(pack)).not.toContain('secret-from-provider');
});

test('PACK_TOO_LARGE still thrown when a per-file count would fail (per-file uses the estimate)', async () => {
  const states: string[] = [];
  const reads = { '1': doc('x'), '2': doc('y') };
  const counted: string[] = [];
  const err = await buildPack(provider([F('1', 'A'), F('2', 'B')], reads), 'x', {
    maxTokens: 10,
    // only the full-pack call succeeds; any per-file call rejects
    countTokens: (t) => {
      counted.push(t);
      return t.includes('[A ') && t.includes('[B ')
        ? 1000
        : Promise.reject(new Error('count failed'));
    },
    onStatus: (m) => states.push(m.state),
  }).catch((e) => e);
  expect(err).toBeInstanceOf(PackTooLargeError);
  expect(err.files.map((f: { file: string }) => f.file)).toEqual(['A', 'B']);
  expect(counted).toHaveLength(1); // counter only sees the whole pack
  expect(counted[0]).toContain('[A ');
  expect(counted[0]).toContain('[B ');
  expect(states.at(-1)).toBe('error');
});

test('pack.too_large and pack.built log only numbers (no file names), incl. unreadable file', async () => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((l) => void lines.push(String(l)));
  try {
    const reads = { '1': doc('secretbody'), '2': { unreadable: 'empty' } } as const;
    const files = [F('1', 'SecretName'), F('2', 'HiddenScan')];
    await buildPack(provider(files, reads), 'x');
    await buildPack(provider(files, reads), 'x', { maxTokens: 1 }).catch(() => {});
  } finally {
    spy.mockRestore();
  }
  for (const msg of ['pack.built', 'pack.too_large']) {
    const rec = JSON.parse(lines.find((l) => l.includes(msg))!) as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) if (k !== 'msg') expect(typeof v, k).toBe('number');
    expect(rec).not.toHaveProperty('droppedCount');
  }
  expect(lines.join('\n')).not.toMatch(/SecretName|HiddenScan|secretbody/);
  const built = JSON.parse(lines.find((l) => l.includes('pack.built'))!);
  expect(built.unreadable).toBe(1);
  // 2 listed, 1 unreadable -> files counts only the readable one
  const tooLarge = JSON.parse(lines.find((l) => l.includes('pack.too_large'))!);
  expect(tooLarge).toMatchObject({ tokens: expect.any(Number), max: 1, files: 1 });
});
