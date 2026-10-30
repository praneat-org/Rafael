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
