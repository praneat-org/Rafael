import { ServerMessage } from '@rafael/protocol';
import { expect, test } from 'vitest';
import type { DriveFile, ReadResult, SourceProvider } from './drive.js';
import { buildPack, estimateTokens, PackStore, PackTooLargeError } from './pack.js';

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
  // exactly at the limit is fine
  const ok = await buildPack(provider([F('1', 'S')], { '1': doc('x') }), 'x', {
    countTokens: () => 100,
    maxTokens: 100,
  });
  expect(ok.tokens).toBe(100);
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

  const slow2 = s.refresh('t', async () => (await gate, mk('first')));
  await s.refresh('t', () => mk('second'));
  await slow2;
  expect(s.get('t')!.text).toContain('second');
});
