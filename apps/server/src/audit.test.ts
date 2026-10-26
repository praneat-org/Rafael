import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from './app.js';
import { AUDIT_LOG_NAME, type AuditEvent, audit } from './audit.js';
import { MemorySessionStore } from './session/store.js';

const F = { folderId: 'fld1', folderName: 'Acme pitch', files: 3, tokens: 1200 };
const P = { email: 'a@praneat.com', sessionId: '11111111-1111-4111-8111-111111111111' };
// one valid sample per event: every event must carry exactly these fields
const samples: [AuditEvent, string[]][] = [
  [
    { event: 'session.start', ...P, resumed: false, folderId: 'fld1' },
    ['email', 'sessionId', 'resumed', 'folderId'],
  ],
  [
    { event: 'pack.build', ...P, ...F },
    ['email', 'sessionId', 'folderId', 'folderName', 'files', 'tokens'],
  ],
  [
    { event: 'pack.refresh', ...P, ...F },
    ['email', 'sessionId', 'folderId', 'folderName', 'files', 'tokens'],
  ],
  [{ event: 'session.end', ...P }, ['email', 'sessionId']],
  [{ event: 'session.expired', ...P }, ['email', 'sessionId']],
  [{ event: 'auth.denied', source: 'ws' }, ['source']],
];

let out: string[] = [];
const spy = () => vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
afterEach(() => {
  vi.restoreAllMocks();
  out = [];
});

test.each(samples)('%j has exactly its fields', (e, fields) => {
  spy();
  audit(e, () => new Date('2026-10-26T00:00:00Z'));
  const line = JSON.parse(out[0]!);
  expect(line).toMatchObject({
    log: AUDIT_LOG_NAME,
    severity: 'NOTICE',
    time: '2026-10-26T00:00:00.000Z',
  });
  expect(Object.keys(line).sort()).toEqual(['event', 'log', 'severity', 'time', ...fields].sort());
});

test('forbidden fields (file names, content, transcript, token) are never emitted', () => {
  spy();
  const bad = {
    ...samples[1]?.[0],
    fileNames: ['secret.pdf'],
    text: 'transcript words',
    question: 'how much?',
    accessToken: 'ya29.x',
  } as unknown as AuditEvent;
  audit(bad);
  expect(out).toHaveLength(1);
  const line = out[0]!;
  expect(JSON.parse(line)).toEqual({ msg: 'audit.invalid', code: 'AUDIT_INVALID' });
  expect(line).not.toMatch(/secret\.pdf|transcript words|how much|ya29|Acme/);
});

test('real session: start, end, expiry and denied auth are audited, no token in output', async () => {
  spy();
  const store = new MemorySessionStore(60_000, 30);
  const app = createApp({
    store,
    verifier: async (t) => (t === 'good' ? { email: 'a@praneat.com' } : null),
    allowedOrigins: ['chrome-extension://x'],
  });
  app.listen(0);
  const url = `ws://127.0.0.1:${(app.address() as AddressInfo).port}/ws`;
  const open = async (token: string, then?: (ws: WebSocket) => void) => {
    const ws = new WebSocket(url, { origin: 'chrome-extension://x' });
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ v: 1, t: 'hello', accessToken: token }));
    then?.(ws);
    await new Promise((r) => ws.once('close', r));
  };
  await open('bad');
  await open('good', (ws) => {
    ws.send(JSON.stringify({ v: 1, t: 'session.start', packId: 'p' }));
    setTimeout(() => ws.send(JSON.stringify({ v: 1, t: 'session.end' })), 50);
  });
  // second session: drop the socket, grace (30 ms) expires it
  await open('good', (ws) => {
    ws.send(JSON.stringify({ v: 1, t: 'session.start', packId: 'ราคา ลูกค้า' }));
    setTimeout(() => ws.close(), 50);
  });
  await vi.waitFor(() => expect(out.join('\n')).toContain('session.expired'));
  const events = out
    .map((l) => JSON.parse(l))
    .filter((l) => l.log === AUDIT_LOG_NAME)
    .map((l) => l.event);
  expect(events).toEqual([
    'auth.denied',
    'session.start',
    'session.end',
    'session.start',
    'session.expired',
  ]);
  expect(out.join('\n')).not.toMatch(/ya29|good|bad|ราคา/);
  // packId = Drive folder id: logged when Drive-id-shaped, omitted (event still fires) otherwise
  const starts = out.map((l) => JSON.parse(l)).filter((l) => l.event === 'session.start');
  expect(starts[0].folderId).toBe('p');
  expect(starts[1]).not.toHaveProperty('folderId');
  app.shutdown();
  await new Promise((r) => app.close(r));
});

test('free text in email / sessionId / folderId is dropped, not logged (D11)', () => {
  spy();
  const ok = { event: 'session.start', ...P, resumed: false } as const;
  for (const bad of [
    { ...ok, email: 'ลูกค้าถามราคาเท่าไหร่' },
    { ...ok, sessionId: 'คำถามของลูกค้า' },
    { ...ok, folderId: 'ราคา พิเศษ' },
  ])
    audit(bad);
  expect(out.map((l) => JSON.parse(l))).toEqual(
    Array(3).fill({ msg: 'audit.invalid', code: 'AUDIT_INVALID' }),
  );
  expect(out.join('')).not.toMatch(/ลูกค้า|ราคา/);
});
