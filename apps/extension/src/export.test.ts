import { expect, test } from 'vitest';
import { formatUnanswered } from './export';
import { type Action, initialState, reduce } from './session';

const t = (h: number, m: number) => new Date(2026, 9, 26, h, m).getTime();
const cue = (cueId: string, question: string, notFound: boolean, partial = false): Action => ({
  k: 'server',
  at: t(14, 5),
  msg: {
    v: 1,
    t: 'cue',
    cueId,
    question,
    bullets: notFound ? [] : ['x'],
    sources: notFound ? [] : [{ file: 'f', fileId: '1', locator: 'p1' }],
    latencyMs: 1,
    notFound,
    partial,
  },
});
const run = (a: Action[]) => a.reduce(reduce, initialState);

test('end keeps only final notFound questions; export is one line each', () => {
  const s = run([
    { k: 'start' },
    cue('a', 'ราคาเท่าไหร่', false),
    cue('b', 'มี SLA ไหม', true),
    cue('c', 'รองรับ SAP ไหม', true),
    cue('d', 'ยัง stream', true, true),
    { k: 'end' },
  ]);
  expect(s.cues).toEqual([]);
  expect(s.unanswered.map((u) => u.question)).toEqual(['มี SLA ไหม', 'รองรับ SAP ไหม']);
  expect(formatUnanswered(s.unanswered)).toBe('14:05 มี SLA ไหม\n14:05 รองรับ SAP ไหม');
});

test('no notFound cue -> empty export', () => {
  expect(
    formatUnanswered(run([{ k: 'start' }, cue('a', 'q', false), { k: 'end' }]).unanswered),
  ).toBe('');
});

test('delete (reset) clears everything', () => {
  const ended = run([{ k: 'start' }, cue('b', 'q', true), { k: 'end' }]);
  expect(reduce(ended, { k: 'reset' })).toEqual(initialState);
});

test('repeated end keeps the list; newline in a question stays one export line', () => {
  const live = run([{ k: 'start' }, cue('c1', 'a\nb\r\nc', true)]);
  const ended = reduce(live, { k: 'end' });
  expect(reduce(ended, { k: 'end' })).toEqual(ended);
  expect(formatUnanswered(ended.unanswered)).toMatch(/^\d\d:\d\d a b c$/);
});
