import { expect, test } from 'vitest';
import type { Session } from '../session/store.js';
import { FakeSttProvider } from './fake.js';
import { createSttService } from './service.js';

const frame = (id: number) => {
  const f = new Int16Array(1600);
  f[0] = id;
  return f;
};

test('sttFinalMs is measured from the end of the speech run the final belongs to', () => {
  let clock = 0;
  const p = new FakeSttProvider({ finalEvery: 99 });
  const metas: (number | undefined)[] = [];
  const s = { id: 's1' } as Session;
  const svc = createSttService(
    {
      provider: p,
      voiced: (f) => f[0] !== 0,
      now: () => clock,
      onFinal: (_s, _g, _send, m) => void metas.push(m.sttFinalMs),
    },
    { onEnd() {}, get: () => s },
  );
  const push = (t: number, id: number) => {
    clock = t;
    svc.push(s, frame(id), () => {});
  };
  push(0, 1);
  push(100, 1); // utterance 1 ends here (last voiced frame at 100)
  push(200, 0);
  push(300, 0);
  push(400, 0); // 300 ms of silence: run 1 is over
  push(500, 2); // utterance 2 keeps going while the provider is still finalizing utterance 1
  clock = 700;
  p.handlers[0]?.onFinal('first');
  clock = 900;
  p.handlers[0]?.onFinal('second');
  // 'first': 700 - 100 = 600 (not 200 from the newer speech) · 'second': no finished run left -> last voiced frame 500
  expect(metas).toEqual([600, 400]);
});

test('speech with pauses inside a sentence: sttFinalMs stays small, no backlog drift', () => {
  let clock = 0;
  const p = new FakeSttProvider({ finalEvery: 99 });
  const metas: number[] = [];
  const s = { id: 's1' } as Session;
  const svc = createSttService(
    {
      provider: p,
      voiced: (f) => f[0] !== 0,
      now: () => clock,
      onFinal: (_s, _g, _send, m) => void metas.push(m.sttFinalMs ?? -1),
    },
    { onEnd() {}, get: () => s },
  );
  const push = (id: number) => {
    svc.push(s, frame(id), () => {});
    clock += 100;
  };
  for (let u = 0; u < 20; u++) {
    // "word, 300 ms pause, word, 300 ms pause, word", then the provider finalizes at once
    for (let w = 0; w < 3; w++) {
      push(1);
      for (let i = 0; i < 3; i++) push(0);
    }
    p.handlers[0]?.onFinal('sentence');
    for (let i = 0; i < 7; i++) push(0); // rest of a 1 s silence
  }
  expect(metas).toHaveLength(20);
  expect(Math.max(...metas)).toBeLessThan(800);
});
