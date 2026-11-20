import { useEffect, useState } from 'react';
import { LiveView } from '../../extension/entrypoints/sidepanel/LiveView';
import { EndView } from '../../extension/entrypoints/sidepanel/views';
import { checkSupport } from './browser-support';
import { FEEDBACK_URL, VERSION } from './config';
import { getToken } from './identity';
import { Onboarding } from './Onboarding';
import { SetupView } from './SetupView';
import { useWebSession } from './useWebSession';

const support = checkSupport(navigator);

const LOST_TEXT = {
  'tab-capture': 'การแชร์แท็บหยุดแล้ว — จะไม่มี cue จากเสียงลูกค้า กดจบ session แล้วเริ่มใหม่',
  'tab-no-audio':
    'ไม่ได้แชร์เสียงแท็บ — ตอนเลือกแท็บต้องติ๊ก "แชร์เสียงแท็บ" และเลือกแท็บ (ไม่ใช่หน้าต่างหรือทั้งจอ) กดจบ session แล้วเริ่มใหม่',
  'mic-permission': 'ใช้ไมค์ไม่ได้ — ตรวจสิทธิ์ไมค์ของเว็บนี้ใน Chrome แล้วเริ่มใหม่',
} as const;

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const { state, audio, send, getLog, getSummary } = useWebSession(getToken);
  const live = state.phase === 'live';
  // closing the tab ends the session and loses the log (D11: it exists nowhere else)
  useEffect(() => {
    if (!live) return;
    const on = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [live]);

  let body: React.ReactNode;
  if (hash === '#/onboarding') body = <Onboarding />;
  else if (live)
    body = (
      <>
        <LiveView state={state} send={send} getLog={getLog} />
        {audio?.error && (
          <p className="note err web-alert" role="alert">
            {LOST_TEXT[audio.error]}
          </p>
        )}
      </>
    );
  else if (state.phase === 'end')
    body = (
      <EndView
        send={send}
        unanswered={state.unanswered}
        endLog={state.endLog}
        getLog={getLog}
        endMeta={state.endMeta}
        attendees={state.attendees}
        getSummary={getSummary}
        feedbackUrl={FEEDBACK_URL}
      />
    );
  else body = <SetupView send={send} error={state.error} audio={audio} support={support} />;
  return (
    <div className="web-shell">
      {body}
      <span className="web-ver" title="เวอร์ชันของ Rafael web">
        {VERSION}
      </span>
    </div>
  );
}
