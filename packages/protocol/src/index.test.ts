import { describe, expect, test } from 'vitest';
import {
  AUDIO_FRAME_BYTES,
  decodeAudioFrame,
  encodeAudioFrame,
  exampleServerMessages,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
  SAMPLES_PER_FRAME,
} from './index.js';

const j = (o: unknown) => JSON.stringify(o);

describe('client messages', () => {
  const valid = [
    { v: 1, t: 'hello', accessToken: 'tok' },
    { v: 1, t: 'session.start', packId: 'p1' },
    { v: 1, t: 'session.start', packId: 'p1', resumeToken: 'r' },
    { v: 1, t: 'session.start', packId: 'p1', exclude: ['f1', 'f2'] }, // BE-112
    { v: 1, t: 'ask', text: 'hi' },
    { v: 1, t: 'pause' },
    { v: 1, t: 'resume' },
    { v: 1, t: 'session.end' },
  ];
  test.each(valid)('valid %o', (m) => {
    expect(parseClientMessage(j(m))).toEqual({ ok: true, data: m });
  });

  test.each([
    ['missing field', { v: 1, t: 'ask' }],
    ['wrong type', { v: 1, t: 'ask', text: 5 }],
    ['unknown t', { v: 1, t: 'nope' }],
    ['no v', { t: 'pause' }],
    ['hello without token', { v: 1, t: 'hello' }],
    ['hello empty token', { v: 1, t: 'hello', accessToken: '' }],
    ['hello oversized token', { v: 1, t: 'hello', accessToken: 'x'.repeat(4097) }],
    ['hello extra field', { v: 1, t: 'hello', accessToken: 'tok', email: 'a@praneat.com' }],
    ['client-sent server-owned field', { v: 1, t: 'session.start', packId: 'p', sessionId: 'x' }],
    ['extra field on pause', { v: 1, t: 'pause', email: 'a@praneat.com' }],
  ])('BAD_MESSAGE: %s', (_n, m) => {
    expect(parseClientMessage(j(m))).toEqual({ ok: false, error: { code: 'BAD_MESSAGE' } });
  });

  test('error result never contains the token', () => {
    const r = parseClientMessage(j({ v: 1, t: 'hello', accessToken: 'SECRET-TOK', extra: 1 }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('SECRET-TOK');
  });

  test('VERSION_MISMATCH', () => {
    expect(parseClientMessage(j({ v: PROTOCOL_VERSION + 1, t: 'pause' }))).toEqual({
      ok: false,
      error: { code: 'VERSION_MISMATCH' },
    });
  });

  test.each(['not json', '', 'null', '[]', '42'])('non-object raw %j does not throw', (raw) => {
    expect(parseClientMessage(raw)).toEqual({ ok: false, error: { code: 'BAD_MESSAGE' } });
  });
});

describe('server messages', () => {
  test('every example parses and round-trips; all types covered', () => {
    for (const m of exampleServerMessages) {
      expect(parseServerMessage(j(m))).toEqual({ ok: true, data: m });
    }
    expect(new Set(exampleServerMessages.map((m) => m.t))).toEqual(
      new Set(['session.ready', 'transcript', 'cue', 'pack.status', 'error']),
    );
  });

  test('unknown error code / missing field / wrong version rejected', () => {
    expect(parseServerMessage(j({ v: 1, t: 'error', code: 'WAT' })).ok).toBe(false);
    expect(parseServerMessage(j({ v: 1, t: 'transcript', segId: 's', final: true })).ok).toBe(
      false,
    );
    expect(parseServerMessage(j({ v: 2, t: 'error', code: 'BAD_MESSAGE' }))).toEqual({
      ok: false,
      error: { code: 'VERSION_MISMATCH' },
    });
  });

  test('BE-112: exclude max 200 non-empty ids; error.files[].id optional', () => {
    const start = { v: 1, t: 'session.start', packId: 'p' };
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
    expect(parseClientMessage(j({ ...start, exclude: ids(200) })).ok).toBe(true);
    expect(parseClientMessage(j({ ...start, exclude: ids(201) })).ok).toBe(false);
    expect(parseClientMessage(j({ ...start, exclude: [''] })).ok).toBe(false);
    const err = { v: 1, t: 'error', code: 'PACK_TOO_LARGE' };
    expect(parseServerMessage(j({ ...err, files: [{ id: 'f1', name: 'a', tokens: 1 }] })).ok).toBe(
      true,
    );
    expect(parseServerMessage(j({ ...err, files: [{ id: '', name: 'a', tokens: 1 }] })).ok).toBe(
      false,
    );
  });

  test('BE-110: error.files and pack.status read/total are optional in v1', () => {
    const files = [
      { name: 'big.pdf', tokens: 90000 },
      { name: 'small.pdf', tokens: 10 },
    ];
    const tooLarge = { v: 1, t: 'error', code: 'PACK_TOO_LARGE' };
    expect(parseServerMessage(j(tooLarge)).ok).toBe(true); // without
    expect(parseServerMessage(j({ ...tooLarge, files }))).toEqual({
      ok: true,
      data: { ...tooLarge, files },
    });
    expect(parseServerMessage(j({ v: 1, t: 'error', code: 'PACK_NOT_READY' })).ok).toBe(true);
    expect(parseServerMessage(j({ ...tooLarge, files: [{ name: 'a', tokens: -1 }] })).ok).toBe(
      false,
    );
    const status = {
      v: 1,
      t: 'pack.status',
      state: 'loading',
      files: [],
      tokens: 0,
      unreadable: [],
    };
    expect(parseServerMessage(j(status)).ok).toBe(true); // without
    expect(parseServerMessage(j({ ...status, read: 2, total: 5 })).ok).toBe(true);
    expect(parseServerMessage(j({ ...status, read: -1, total: 5 })).ok).toBe(false);
    expect(parseServerMessage(j({ ...status, read: 1.5 })).ok).toBe(false);
  });

  const src = [{ file: 'f', fileId: 'i', locator: 'หน้า 1' }];
  const cue = {
    v: 1,
    t: 'cue',
    cueId: 'c',
    question: 'q',
    bullets: ['b'],
    sources: [] as unknown[],
    latencyMs: 1,
    partial: false,
    notFound: false,
  };
  test('D10: notFound=false without sources is rejected', () => {
    expect(parseServerMessage(j(cue)).ok).toBe(false);
  });
  test('D10: notFound=false with a source is accepted', () => {
    expect(parseServerMessage(j({ ...cue, sources: src })).ok).toBe(true);
  });
  test('D10: notFound=true with no sources is accepted', () => {
    expect(parseServerMessage(j({ ...cue, bullets: [], notFound: true })).ok).toBe(true);
  });
  test('more than 3 bullets rejected', () => {
    expect(parseServerMessage(j({ ...cue, sources: src, bullets: ['a', 'b', 'c', 'd'] })).ok).toBe(
      false,
    );
  });
});

describe('audio frame', () => {
  const pcm = Int16Array.from({ length: SAMPLES_PER_FRAME }, (_, i) => ((i * 37) % 65536) - 32768);

  test('encode -> decode returns the original, incl. max seq', () => {
    const f = decodeAudioFrame(encodeAudioFrame(0xffffffff, pcm));
    expect(f?.seq).toBe(0xffffffff);
    expect(f?.pcm).toEqual(pcm);
  });

  test('wire layout is little-endian', () => {
    const bytes = encodeAudioFrame(1, pcm);
    expect(bytes.length).toBe(AUDIO_FRAME_BYTES);
    expect([...bytes.slice(0, 4)]).toEqual([1, 0, 0, 0]);
    expect(bytes[4]).toBe((pcm[0] ?? 0) & 0xff);
    expect(bytes[5]).toBe(((pcm[0] ?? 0) >> 8) & 0xff);
  });

  test('wrong-size frames rejected', () => {
    expect(decodeAudioFrame(new Uint8Array(AUDIO_FRAME_BYTES - 1))).toBeNull();
    expect(decodeAudioFrame(new Uint8Array(AUDIO_FRAME_BYTES + 1))).toBeNull();
    expect(decodeAudioFrame(new ArrayBuffer(0))).toBeNull();
  });

  test('encode rejects bad pcm length / seq', () => {
    expect(() => encodeAudioFrame(0, new Int16Array(10))).toThrow(RangeError);
    expect(() => encodeAudioFrame(-1, pcm)).toThrow(RangeError);
    expect(() => encodeAudioFrame(2 ** 32, pcm)).toThrow(RangeError);
  });

  test('decode works on a view with byteOffset', () => {
    const bytes = encodeAudioFrame(7, pcm);
    const host = new Uint8Array(AUDIO_FRAME_BYTES + 8);
    host.set(bytes, 8);
    expect(decodeAudioFrame(host.subarray(8))?.seq).toBe(7);
  });
});
