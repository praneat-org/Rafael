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

test('stop() after a handle was accepted stops its streams and drops it', async () => {
  const s = new CaptureSlot();
  const h = handle();
  await s.begin(async () => h, vi.fn());
  s.stop();
  expect(h.stop).toHaveBeenCalledOnce();
  s.pause();
  s.resume();
  expect(h.pause).not.toHaveBeenCalled();
  expect(h.resume).not.toHaveBeenCalled();
});

test('a new begin() after an accepted handle stops the old one and makes its isCurrent() false', async () => {
  const s = new CaptureSlot();
  const h1 = handle();
  let cur1: () => boolean = () => false;
  await s.begin(async (c) => {
    cur1 = c;
    return h1;
  }, vi.fn());
  expect(cur1()).toBe(true);
  const h2 = handle();
  await s.begin(async () => h2, vi.fn());
  expect(h1.stop).toHaveBeenCalledOnce();
  expect(cur1()).toBe(false);
  expect(h2.stop).not.toHaveBeenCalled();
  s.pause();
  expect(h1.pause).not.toHaveBeenCalled();
  expect(h2.pause).toHaveBeenCalledOnce();
});

test('pause before the handle exists: guarded callbacks send nothing, and again after resume they do', async () => {
  const s = new CaptureSlot();
  const sent = vi.fn();
  const d = deferred<CaptureHandle>();
  let send: (n: number) => void = () => {};
  const p = s.begin(() => {
    send = s.guard(sent); // frames can flow while the mic getUserMedia is still pending
    return d.promise;
  }, vi.fn());
  s.pause();
  send(1);
  expect(sent).not.toHaveBeenCalled();
  d.resolve(handle());
  await p;
  send(2);
  expect(sent).not.toHaveBeenCalled();
  s.resume();
  send(3);
  expect(sent).toHaveBeenCalledExactlyOnceWith(3);
});

test('frame from the old generation after stop() never reaches the transport', async () => {
  const s = new CaptureSlot();
  const spy = vi.fn();
  let send: (n: number) => void = () => {};
  await s.begin(async () => {
    send = s.guard(spy);
    return handle();
  }, vi.fn());
  send(1);
  expect(spy).toHaveBeenCalledOnce();
  s.stop();
  send(2);
  expect(spy).toHaveBeenCalledOnce();
});

test('after a new begin(), only the new generation reaches the transport', async () => {
  const s = new CaptureSlot();
  const oldSpy = vi.fn();
  const newSpy = vi.fn();
  let oldSend: (n: number) => void = () => {};
  let newSend: (n: number) => void = () => {};
  await s.begin(async () => {
    oldSend = s.guard(oldSpy);
    return handle();
  }, vi.fn());
  await s.begin(async () => {
    newSend = s.guard(newSpy);
    return handle();
  }, vi.fn());
  oldSend(1);
  newSend(2);
  expect(oldSpy).not.toHaveBeenCalled();
  expect(newSpy).toHaveBeenCalledExactlyOnceWith(2);
});
