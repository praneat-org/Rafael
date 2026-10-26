import { useEffect, useRef, useState } from 'react';
import type { PanelToOffscreen } from '../../src/messages';
import type { Cue, SessionState } from '../../src/session';

type Send = (cmd: PanelToOffscreen) => void;

const STATUS_TEXT = {
  idle: 'ยังไม่เริ่ม',
  connecting: 'กำลังเชื่อมต่อ',
  live: 'สด',
  reconnecting: 'กำลังเชื่อมต่อใหม่',
  closed: 'ปิดแล้ว',
} as const;

/** D10: anchors are shown exactly as the server sent them; notFound is never answered. */
function CueBody({ cue, big }: { cue: Cue; big: boolean }) {
  return (
    <>
      <p className="question">Q: {cue.question}</p>
      <div className="cuebody">
        {cue.notFound ? (
          <p className="notfound">ไม่พบใน pack</p>
        ) : (
          <ul className={big ? 'bullets big' : 'bullets'}>
            {cue.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </div>
      {/* always rendered (reserved row) so partial -> final does not move anything */}
      <p className="anchors">
        {cue.sources.map((x) => (
          <span key={`${x.fileId}${x.locator}`}>
            ↳ {x.file} › {x.locator}
          </span>
        ))}
      </p>
    </>
  );
}

function AskBox({ send }: { send: Send }) {
  const [text, setText] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    send({ k: 'ask', text: t });
    setText('');
  };
  return (
    <form className="ask" onSubmit={submit}>
      <input
        value={text}
        maxLength={2000}
        placeholder="ถามจาก pack แล้วกด Enter"
        aria-label="ถามจาก pack"
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  );
}

export function LiveView({ state, send }: { state: SessionState; send: Send }) {
  const latest = state.cues.at(-1);
  const previous = state.cues.slice(0, -1);
  const listEnd = useRef<HTMLLIElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a cue is added
  useEffect(() => {
    listEnd.current?.scrollIntoView?.({ block: 'nearest' });
  }, [previous.length]);
  return (
    <main className="liveview">
      <header className="bar">
        {/* connection problems win over paused: the rep must see a dropped link even while paused */}
        <span
          role="status"
          className={`status ${state.paused && state.status === 'live' ? 'paused' : state.status}`}
        >
          {state.paused
            ? `หยุดชั่วคราว (ไม่ส่งเสียง)${state.status === 'live' ? '' : ` · ${STATUS_TEXT[state.status]}`}`
            : STATUS_TEXT[state.status]}
        </span>
        <span className="actions">
          <button type="button" onClick={() => send({ k: state.paused ? 'resume' : 'pause' })}>
            {state.paused ? 'ต่อ' : 'หยุดชั่วคราว'}
          </button>
          <button type="button" onClick={() => send({ k: 'end' })}>
            จบ
          </button>
        </span>
      </header>
      {state.error && <p className="note">ผิดพลาด: {state.error}</p>}
      {/* fixed-height slot: any cue (partial or final) fits without moving the rest */}
      <section className={`latest${latest?.partial ? ' partial' : ''}`} aria-live="polite">
        {latest ? <CueBody cue={latest} big /> : <p className="note">รอคำถามจากลูกค้า…</p>}
      </section>
      <ul className="previous" aria-label="cue ก่อนหน้า">
        {previous.map((c) => (
          <li key={c.cueId} className="prev">
            <CueBody cue={c} big={false} />
          </li>
        ))}
        <li ref={listEnd} aria-hidden="true" />
      </ul>
      <details className="transcript">
        <summary>transcript ({state.segments.length})</summary>
        <ul>
          {state.segments.map((g) => (
            <li key={g.segId} className={g.final ? '' : 'partial'}>
              {g.text}
            </li>
          ))}
        </ul>
      </details>
      <AskBox send={send} />
    </main>
  );
}
