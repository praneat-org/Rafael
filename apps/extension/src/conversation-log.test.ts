import type { LogEvent } from '@rafael/protocol';
import { expect, test } from 'vitest';
import { logFileName, logToJson, logToMarkdown } from './conversation-log';

const base = (seq: number, hms: string) => ({
  sessionId: 's1',
  seq,
  ts: `2026-11-18T${hms}.000+07:00`,
  offsetMs: seq * 1000,
});
const log: LogEvent[] = [
  {
    ...base(0, '14:05:00'),
    type: 'session.start',
    user: 'a@praneat.com',
    folderId: 'F1',
    folderName: 'Deal / ACME: Q4',
    pack: { files: 3, tokens: 12000 },
  },
  {
    ...base(1, '14:05:10'),
    type: 'transcript',
    segId: '1-1',
    text: 'ราคา\nเท่าไร',
    speaker: 'ลูกค้า',
  },
  {
    ...base(2, '14:05:13'),
    type: 'cue',
    cueId: 'c1',
    question: 'ราคาเท่าไร',
    bullets: ['100 บาท [deck.pdf › หน้า 3]'],
    sources: [{ file: 'deck.pdf', fileId: 'f1', locator: 'หน้า 3' }],
    latencyMs: 2400,
  },
  { ...base(3, '14:06:00'), type: 'pause' },
  { ...base(4, '14:09:00'), type: 'resume' },
  { ...base(5, '14:10:00'), type: 'ask', text: 'มี SLA ไหม' },
  {
    ...base(6, '14:10:03'),
    type: 'not_found',
    cueId: 'c2',
    question: 'มี SLA ไหม',
    latencyMs: 2100,
  },
  { ...base(7, '14:12:00'), type: 'session.end' },
];

test('file name: rafael_<YYYYMMDD-HHmm>_<folder>, unsafe characters replaced', () => {
  expect(logFileName(log, 'md')).toBe('rafael_20261118-1405_Deal_ACME_Q4.md');
  expect(logFileName(log, 'json')).toBe('rafael_20261118-1405_Deal_ACME_Q4.json');
  const noName = [{ ...log[0], folderName: '' } as LogEvent];
  expect(logFileName(noName, 'md')).toBe('rafael_20261118-1405_F1.md');
});

test('md: header, timeline in order, pause marker only, not-found list at the end', () => {
  const md = logToMarkdown(log);
  expect(md).toContain('- ผู้ใช้: a@praneat.com');
  expect(md).toContain('- Pack: 3 ไฟล์ · 12,000 tokens');
  expect(md).toContain('- เริ่ม: 2026-11-18 14:05:00 (Asia/Bangkok)');
  expect(md).toContain('- จบ: 2026-11-18 14:12:00');
  expect(md).toContain('**14:05:10** ลูกค้า: ราคา เท่าไร'); // one line
  expect(md).toContain('> - 100 บาท'); // inline anchor stripped, listed as source instead
  expect(md).toContain('> ที่มา: deck.pdf › หน้า 3');
  expect(md).toContain('_paused 14:06–14:09_');
  expect(md).toContain('**14:10:00** พิมพ์ถาม: มี SLA ไหม');
  const order = [
    'ลูกค้า: ราคา',
    'Cue**',
    '_paused',
    'พิมพ์ถาม',
    'ไม่พบใน source** ·',
    '## ไม่พบใน source (1)',
  ];
  const at = order.map((x) => md.indexOf(x));
  expect(at.every((x) => x >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(md.trimEnd().endsWith('- 14:10 มี SLA ไหม')).toBe(true);
});

test('md mid-session: still paused -> open marker, no end line', () => {
  const live = log.slice(0, 4);
  const md = logToMarkdown(live);
  expect(md).toContain('- ยังไม่จบ: log ถึง 14:06:00');
  expect(md).toContain('_paused 14:06–ตอนนี้_');
  expect(md).toContain('## ไม่พบใน source (0)');
});

test('json: every field, round-trips', () => {
  expect(JSON.parse(logToJson(log))).toEqual({ events: log });
});

test('2 h session formats well under 3 s', () => {
  const big: LogEvent[] = [log[0] as LogEvent];
  for (let i = 1; i <= 3000; i++)
    big.push({
      ...base(i, '15:00:00'),
      type: 'transcript',
      segId: `1-${i}`,
      text: 'ข้อความ '.repeat(20),
    });
  const t0 = performance.now();
  const md = logToMarkdown(big);
  const json = logToJson(big);
  expect(performance.now() - t0).toBeLessThan(1000);
  expect(md.match(/^\*\*15:00:00\*\*/gm)).toHaveLength(3000);
  expect(JSON.parse(json).events).toHaveLength(big.length);
});

test('md: a model failure shows in the timeline but not in the "not found" list', () => {
  const failed: LogEvent = {
    ...base(7, '14:11:00'),
    type: 'not_found',
    cueId: 'c3',
    question: 'ส่วนลดเท่าไร',
    latencyMs: 900,
    failed: true,
  };
  const md = logToMarkdown([...log.slice(0, 7), failed, log[7] as LogEvent]);
  expect(md).toContain('ตอบไม่ได้ (ระบบขัดข้อง)** · ส่วนลดเท่าไร');
  expect(md).toContain('## ไม่พบใน source (1)');
  expect(md).not.toContain('- 14:11 ส่วนลดเท่าไร');
});

test('md: Markdown characters in spoken text are escaped', () => {
  const md = logToMarkdown([
    log[0] as LogEvent,
    { ...base(1, '14:05:10'), type: 'transcript', segId: '1-9', text: 'รหัส *A12* กับ [x]' },
  ]);
  expect(md).toContain('รหัส \\*A12\\* กับ \\[x\\]');
});
