import { expect, it, vi } from 'vitest';
import { MENU_ID, onMenuClick, registerMenu } from './grant-menu';
import { TAB_GRANTED } from './messages';

const mk = () => ({
  openPanel: vi.fn(() => Promise.resolve()),
  send: vi.fn(() => Promise.resolve()),
});

it('ignores other menu ids and tabs without id', () => {
  const api = mk();
  onMenuClick(api, { menuItemId: 'other' }, { id: 1 });
  onMenuClick(api, { menuItemId: MENU_ID }, {});
  onMenuClick(api, { menuItemId: MENU_ID });
  expect(api.openPanel).not.toHaveBeenCalled();
  expect(api.send).not.toHaveBeenCalled();
});

it('opens the panel synchronously and sends TAB_GRANTED', () => {
  const api = mk();
  onMenuClick(api, { menuItemId: MENU_ID }, { id: 7 });
  // no await between the click and these calls
  expect(api.openPanel).toHaveBeenCalledWith({ tabId: 7 });
  expect(api.send).toHaveBeenCalledWith(TAB_GRANTED);
});

it('swallows rejections (no listener / panel refused)', async () => {
  const api = {
    openPanel: vi.fn(() => Promise.reject(new Error('x'))),
    send: vi.fn(() => Promise.reject(new Error('y'))),
  };
  expect(() => onMenuClick(api, { menuItemId: MENU_ID }, { id: 1 })).not.toThrow();
  await Promise.resolve();
});

it('registerMenu removes old menus before creating', async () => {
  const order: string[] = [];
  await registerMenu({
    removeAll: () => (order.push('remove'), Promise.resolve()),
    create: () => order.push('create'),
  });
  expect(order).toEqual(['remove', 'create']);
});
