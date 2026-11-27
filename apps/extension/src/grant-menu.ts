import { TAB_GRANTED } from './messages';

export const MENU_ID = 'rafael-grant-tab';

type Api = {
  removeAll: () => Promise<void>;
  create: (p: Record<string, unknown>) => unknown;
  openPanel: (o: { tabId: number }) => Promise<unknown>;
  send: (m: string) => Promise<unknown>;
};

// onInstalled also fires on chrome_update / shared_module_update: the old menu must go first
export async function registerMenu(api: Pick<Api, 'removeAll' | 'create'>) {
  await api.removeAll();
  api.create({
    id: MENU_ID,
    title: 'Rafael: จับเสียงแท็บนี้',
    contexts: ['page'],
    documentUrlPatterns: ['https://meet.google.com/*'],
  });
}

// not async: sidePanel.open must run inside the user gesture, before any await
export function onMenuClick(
  api: Pick<Api, 'openPanel' | 'send'>,
  info: { menuItemId: string | number },
  tab?: { id?: number },
) {
  if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
  api.openPanel({ tabId: tab.id }).catch(() => {});
  api.send(TAB_GRANTED).catch(() => {}); // panel retries; no listener = fine
}
