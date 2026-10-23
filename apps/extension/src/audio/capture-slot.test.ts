import { expect, test, vi } from 'vitest';
import type { CaptureHandle } from './capture';
import { CaptureSlot } from './capture-slot';

const handle = (): CaptureHandle => ({ pause: vi.fn(), resume: vi.fn(), stop: vi.fn() });
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

test('stale start that resolves after stop(): streams stopped, handle not adopted', async () => {
  const s = new CaptureSlot();
  const d = deferred<CaptureHandle>();
  const p = s.begin(() => d.promise, vi.fn());
  s.stop();
  const h = handle();
  d.resolve(h);
  await p;
  expect(h.stop).toHaveBeenCalledOnce();
  s.pause();
  expect(h.pause).not.toHaveBeenCalled();
});

test('stale start that fails is silent; isCurrent() turns false once superseded', async () => {
  const s = new CaptureSlot();
  const onErr = vi.fn();
  const d = deferred<CaptureHandle>();
  let cur: () => boolean = () => true;
  const p = s.begin((c) => {
    cur = c;
    return d.promise;
  }, onErr);
  expect(cur()).toBe(true);
  void s.begin(async () => handle(), vi.fn()); // newer session
  expect(cur()).toBe(false);
  d.reject(new Error('x'));
  await p;
  expect(onErr).not.toHaveBeenCalled();
});

test('current failure is reported', async () => {
  const onErr = vi.fn();
  await new CaptureSlot().begin(() => Promise.reject(new Error('x')), onErr);
  expect(onErr).toHaveBeenCalledOnce();
});

test('pause while starting is applied as soon as capture is up; resume cancels it', async () => {
  const s = new CaptureSlot();
  const d = deferred<CaptureHandle>();
  const p = s.begin(() => d.promise, vi.fn());
  s.pause();
  const h = handle();
  d.resolve(h);
  await p;
  expect(h.pause).toHaveBeenCalledOnce();

  const s2 = new CaptureSlot();
  const d2 = deferred<CaptureHandle>();
  const p2 = s2.begin(() => d2.promise, vi.fn());
  s2.pause();
  s2.resume();
  const h2 = handle();
  d2.resolve(h2);
  await p2;
  expect(h2.pause).not.toHaveBeenCalled();
});
