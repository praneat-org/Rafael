import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { initialState } from '../../src/session';
import { LiveView } from './LiveView';
import { PackBuildFailed } from './PackBuildFailed';

const failed = {
  ...initialState,
  phase: 'live' as const,
  status: 'live' as const,
  error: 'PACK_BUILD_FAILED' as const,
};

test('PACK_BUILD_FAILED shows the message + retry, not the raw code', () => {
  const html = renderToStaticMarkup(<LiveView state={failed} send={() => {}} />);
  expect(html).toContain('สร้าง pack ไม่สำเร็จ');
  expect(html).toContain('ลองใหม่');
  expect(html).not.toContain('ผิดพลาด');
});

test('retry button calls onRetry', () => {
  const onRetry = vi.fn();
  const el = PackBuildFailed({ onRetry });
  const btn = (el.props.children as { type: string; props: { onClick: () => void } }[]).find(
    (c) => c.type === 'button',
  );
  btn?.props.onClick();
  expect(onRetry).toHaveBeenCalledOnce();
});

test('retry is disabled while a refresh is in flight (FE-49)', () => {
  const busy = renderToStaticMarkup(
    <LiveView state={{ ...failed, refreshing: true }} send={() => {}} />,
  );
  expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>ลองใหม่/);
  const idle = renderToStaticMarkup(<LiveView state={failed} send={() => {}} />);
  expect(idle).not.toMatch(/<button[^>]*disabled[^>]*>ลองใหม่/);
});

const cue = (id: string, extra: Partial<(typeof initialState.cues)[number]> = {}) => ({
  cueId: id,
  question: `q-${id}`,
  bullets: [`a-${id} [f.pdf › หน้า 1]`],
  sources: [{ file: 'f.pdf', fileId: 'f1', locator: 'หน้า 1' }],
  partial: false,
  notFound: false,
  latencyMs: 1,
  at: 0,
  ...extra,
});

test('history: finals only, newest first, not-found tagged', () => {
  const state = {
    ...initialState,
    phase: 'live' as const,
    status: 'live' as const,
    cues: [
      cue('1'),
      cue('2', { notFound: true, bullets: [], sources: [] }),
      cue('3', { partial: true }),
    ],
  };
  const html = renderToStaticMarkup(<LiveView state={state} send={() => {}} />);
  const list = html.slice(html.indexOf('aria-label="ประวัติ cue"'));
  expect(list).not.toContain('q-3'); // partial stays out of history
  expect(list.indexOf('q-2')).toBeLessThan(list.indexOf('q-1'));
  expect(list).toMatch(/class="prev nf".*q-2.*ไม่มีในเอกสาร/);
});
