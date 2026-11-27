import { getAuthToken, refreshAuthToken } from '../src/auth';
import { onMenuClick, registerMenu } from '../src/grant-menu';
import {
  type AuthTokenReply,
  type AuthTokenReq,
  ENSURE_OFFSCREEN,
  GET_AUTH_TOKEN,
  GET_TAB_STREAM_ID,
  OPEN_PERMISSION_PAGE,
  type TabStreamIdReply,
} from '../src/messages';

// The service worker only coordinates: it can die any time, so it holds no session state.
async function ensureOffscreen() {
  const existing = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await browser.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Holds the audio capture and the server connection for the whole session',
  });
}

// getMediaStreamId needs a per-tab activeTab grant, only an invocation gives one (see src/grant-menu.ts)

// The tab being captured = the active tab of the window where the user clicked the Rafael icon
// (that click grants activeTab, which getMediaStreamId needs). No id is kept here.
async function tabStreamId(): Promise<TabStreamIdReply> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) return { error: true };
  return { id: await browser.tabCapture.getMediaStreamId({ targetTabId: tab.id }) };
}

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  browser.runtime.onInstalled.addListener(() =>
    registerMenu({
      removeAll: () => browser.contextMenus.removeAll(),
      create: (p) => browser.contextMenus.create(p as never),
    }),
  );
  browser.contextMenus.onClicked.addListener((info, tab) =>
    onMenuClick(
      {
        openPanel: (o) => browser.sidePanel.open(o),
        send: (m) => browser.runtime.sendMessage(m),
      },
      info,
      tab,
    ),
  );

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.k === GET_AUTH_TOKEN) {
      const fresh = (msg as AuthTokenReq).fresh;
      (fresh ? refreshAuthToken() : getAuthToken(false)).then((token) =>
        sendResponse({ token } satisfies AuthTokenReply),
      );
      return true;
    }
    if (msg === GET_TAB_STREAM_ID) {
      tabStreamId().then(sendResponse, () =>
        sendResponse({ error: true } satisfies TabStreamIdReply),
      );
      return true;
    }
    if (msg === OPEN_PERMISSION_PAGE) {
      browser.tabs.create({ url: browser.runtime.getURL('/permission.html') });
      return false;
    }
    if (msg !== ENSURE_OFFSCREEN) return false;
    ensureOffscreen().then(
      () => sendResponse(true),
      () => sendResponse(false),
    );
    return true; // async response
  });
});
