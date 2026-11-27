import type { MeetingSummary } from '@rafael/protocol';
import { expect, test } from 'vitest';
import { summaryToMarkdown, UNSET, unsetCount } from './meeting-summary';

const s: MeetingSummary = {
  tldr: 'คุย package Pro\nตกลงใช้ Pro',
  topics: [
    {
      title: 'ราคา',
      discussed: ['ราคา package Pro'],
      decisions: [{ text: 'ใช้ package Pro', reason: 'งบพอ', at: '00:32:15' }],
      parking: [{ text: 'ส่วนลดปีที่ 2', at: '00:40:00' }],
    },
  ],
  notFound: [{ text: 'มี SLA 99.99 ไหม', at: '00:33:20' }],
  actions: [
    { what: 'ส่ง quotation', who: 'คุณสมชาย', when: 'วันศุกร์', at: '00:32:30' },
    { what: 'นัด demo | onsite', who: null, when: null, at: '00:45:00' },
  ],
};
const meta = {
  subject: 'ACME',
  attendees: '',
  startTs: '2026-11-18T14:05:00.000+07:00',
  endTs: '2026-11-18T15:10:00.000+07:00',
};

test('template: metadata, TL;DR, decisions with timestamps, parking lot, 3W table', () => {
  const md = summaryToMarkdown(s, meta);
  expect(md).toContain('- วันที่ / เวลา: 2026-11-18 14:05–15:10 (Asia/Bangkok)');
  expect(md).toContain('- ผู้เข้าร่วมประชุม: ยังไม่ระบุ'); // never guessed
  expect(md).toContain('- ใช้ package Pro (เหตุผล: งบพอ) [00:32:15]');
  expect(md).toContain('- ส่วนลดปีที่ 2 [00:40:00]');
  expect(md).toContain('- มี SLA 99.99 ไหม [00:33:20]');
  expect(md).toContain('| ส่ง quotation | คุณสมชาย | วันศุกร์ | [00:32:30] |');
  expect(md).toContain(`| นัด demo / onsite | ${UNSET} | ${UNSET} | [00:45:00] |`);
  expect(unsetCount(md)).toBe(2);
});

test('attendees and subject as typed', () => {
  const md = summaryToMarkdown(s, {
    ...meta,
    subject: 'Pitch ACME Q4',
    attendees: 'คุณสมชาย, คุณวิภา',
  });
  expect(md.startsWith('# Pitch ACME Q4\n')).toBe(true);
  expect(md).toContain('- ผู้เข้าร่วมประชุม: คุณสมชาย, คุณวิภา');
});
