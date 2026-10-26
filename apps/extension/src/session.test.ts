import { exampleServerMessages } from '@rafael/protocol';
import { expect, test } from 'vitest';
import { buildMockScript } from './mock-transport';
import { type Action, initialState, reduce } from './session';

const run = (actions: Action[]) => actions.reduce(reduce, initialState);
const server = (): Action[] => buildMockScript().map((msg) => ({ k: 'server', msg }));

test('partial cue / transcript update in place, no duplicates', () => {
  const s = run([{ k: 'start' }, ...server()]);
  expect(s.segments).toHaveLength(1);
  expect(s.segments[0]?.final).toBe(true);
  expect(s.cues.map((c) => c.cueId)).toEqual(['cue-1', 'cue-2']);
  expect(s.cues[0]?.partial).toBe(false);
  expect(s.cues[1]?.notFound).toBe(true);
});

test('messages before start are ignored', () => {
  expect(run(server())).toEqual(initialState);
});

test('end drops transcript and cues (D11)', () => {
  const live = run([{ k: 'start' }, ...server()]);
  expect(live.cues.length).toBeGreaterThan(0);
  const ended = reduce(live, { k: 'end' });
  expect(ended.phase).toBe('end');
  expect(ended.cues).toEqual([]);
  expect(ended.segments).toEqual([]);
});

test('status only applies while live', () => {
  expect(reduce(initialState, { k: 'status', status: 'live' }).status).toBe('idle');
  expect(run([{ k: 'start' }, { k: 'status', status: 'live' }]).status).toBe('live');
});

test('fixtures contain a notFound cue', () => {
  expect(exampleServerMessages.some((m) => m.t === 'cue' && m.notFound)).toBe(true);
});

test('pause / resume toggle paused only while live; end clears it', () => {
  expect(reduce(initialState, { k: 'pause' }).paused).toBe(false);
  const live = run([{ k: 'start' }]);
  const paused = reduce(live, { k: 'pause' });
  expect(paused.paused).toBe(true);
  expect(reduce(paused, { k: 'resume' }).paused).toBe(false);
  expect(reduce(paused, { k: 'end' }).paused).toBe(false);
});

test('SESSION_NOT_FOUND (resume failed) returns to setup and keeps the error', () => {
  let s = reduce(initialState, { k: 'start' });
  s = reduce(s, { k: 'status', status: 'reconnecting' });
  s = reduce(s, { k: 'server', msg: { v: 1, t: 'error', code: 'SESSION_NOT_FOUND' } });
  expect(s.phase).toBe('setup');
  expect(s.error).toBe('SESSION_NOT_FOUND');
  expect(reduce(s, { k: 'start' }).error).toBeNull();
});
