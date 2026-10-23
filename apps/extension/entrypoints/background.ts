import { ENSURE_OFFSCREEN } from '../src/messages';

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

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg !== ENSURE_OFFSCREEN) return false;
    ensureOffscreen().then(
      () => sendResponse(true),
      () => sendResponse(false),
    );
    return true; // async response
  });
});
