import { useState } from 'react';
import { errorText } from '../../src/error-text';
import { formatTime } from '../../src/export';
import type { PanelToOffscreen } from '../../src/messages';
import type { Cue, SessionState } from '../../src/session';
import { stripInlineAnchor } from '../../src/strip-anchor';
import { ErrorNote } from './ErrorNote';
import { type GetLog, LogButtons } from './LogButtons';
import { PackBuildFailed } from './PackBuildFailed';
import { PackStatus, PackTooLarge } from './PackStatus';

type Send = (cmd: PanelToOffscreen) => void;

const STATUS_TEXT = {
  idle: 'ยังไม่เริ่ม',
  connecting: 'กำลังเชื่อมต่อ',
  live: 'สด',
  reconnecting: 'กำลังเชื่อมต่อใหม่',
  closed: 'ปิดแล้ว',
} as const;

/** footnote numbers of the sources this bullet cites inline (1-based) */
const cites = (b: string, cue: Cue) =>
  cue.sources.flatMap((x, i) => (b.includes(`[${x.file} › ${x.locator}]`) ? [i + 1] : []));

/** D10: anchors are shown exactly as the server sent them; notFound is never answered. */
function LatestCue({ cue, followUps }: { cue: Cue; followUps: number }) {
  return (
    <>
      <p className="q-meta">
        <span className="num">{formatTime(cue.at)}</span> ลูกค้าถาม
      </p>
      <p className="question">{cue.question}</p>
      {cue.notFound ? (
        <div className="nf-box">
          <p className="nf-title">ไม่พบใน pack</p>
          <p className="nf-sub">
            อย่าเดาคำตอบ · เก็บไว้ในรายการตามต่อแล้ว <b className="num">({followUps})</b>
          </p>
        </div>
      ) : (
        <ul className="bullets">
          {cue.bullets.map((b) => (
            <li key={b}>
              <span>
                {stripInlineAnchor(b, cue.sources)}
                {cites(b, cue).map((n) => (
                  <sup key={n} className="fn">
                    {n}
                  </sup>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {cue.sources.length > 0 && (
        <ol className="anchors">
          {cue.sources.map((x, i) => (
            <li key={`${x.fileId}${x.locator}`}>
              <b className="num">{i + 1}</b>
              <span className="hl">{x.file}</span> · {x.locator}
            </li>
          ))}
        </ol>
      )}
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
        placeholder="พิมพ์ถามจากเอกสาร แล้วกด Enter"
        aria-label="ถามจาก pack"
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  );
}

export function LiveView({
  state,
  send,
  getLog,
}: {
  state: SessionState;
  send: Send;
  /** Conversation Log so far; omitted in tests */
  getLog?: GetLog;
}) {
  const [confirming, setConfirming] = useState(false);
  // history cue open in the slot; liveKey = latest cue when it was opened, to spot a new one
  const [open, setOpen] = useState<{ id: string; liveKey?: string } | null>(null);
  const latest = state.cues.at(-1);
  // a cue still streaming when history opened counts as new once it turns final
  const liveKey = latest && `${latest.cueId}${latest.partial ? '~' : ''}`;
  const viewing = open ? state.cues.find((c) => c.cueId === open.id) : undefined;
  const shown = viewing ?? latest;
  const newCue = viewing !== undefined && liveKey !== open?.liveKey;
  const history = state.cues.filter((c) => !c.partial).reverse(); // finals only, newest first
  const followUps = state.cues.filter((c) => c.notFound && !c.partial).length;
  const heard = state.segments.at(-1)?.text;
  return (
    <main className="liveview">
      <header className="bar">
        {/* connection problems win over paused: the rep must see a dropped link even while paused */}
        <span
          role="status"
          className={`status ${state.paused && state.status === 'live' ? 'paused' : state.status}`}
        >
          <span className="dot" aria-hidden="true" />
          {state.paused
            ? `หยุดชั่วคราว (ไม่ส่งเสียง)${state.status === 'live' ? '' : ` · ${STATUS_TEXT[state.status]}`}`
            : STATUS_TEXT[state.status]}
        </span>
        <span className="actions">
          {getLog && <LogButtons getLog={getLog} />}
          <button
            type="button"
            className="ghost"
            onClick={() => send({ k: state.paused ? 'resume' : 'pause' })}
          >
            {state.paused ? 'ต่อ' : 'พัก'}
          </button>
          {/* leaving Live needs one confirm; End is the only way out */}
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (!confirming) return setConfirming(true);
              send({ k: 'end' });
            }}
            onBlur={() => setConfirming(false)}
          >
            {confirming ? 'กดอีกครั้งเพื่อจบ' : 'จบ'}
          </button>
        </span>
      </header>
      <PackStatus state={state.pack} info={state.packInfo} />
      {state.error === 'PACK_TOO_LARGE' && state.tooLarge && state.tooLarge.length > 0 ? (
        <PackTooLarge
          files={state.tooLarge}
          busy={state.refreshing}
          onRebuild={(exclude) => send({ k: 'rebuild', exclude })}
        />
      ) : state.error === 'PACK_BUILD_FAILED' ? (
        // [] = add nothing; WsTransport resends everything already excluded
        <PackBuildFailed
          busy={state.refreshing}
          onRetry={() => send({ k: 'rebuild', exclude: [] })}
        />
      ) : state.error === 'PACK_NOT_READY' && state.pack === 'loading' ? (
        <ErrorNote text={errorText('PACK_NOT_READY')} />
      ) : (
        state.error && <ErrorNote code={state.error} />
      )}
      {/* fixed-height slot: any cue (partial or final) fits without moving the rest (CLS) */}
      <section className="latestwrap" aria-live={viewing ? 'off' : 'polite'}>
        <div
          key={shown?.cueId}
          className={`latest${shown?.partial ? ' partial' : ''}${shown?.notFound ? ' nf' : ''}${shown && !viewing ? ' arrive' : ''}`}
        >
          {viewing && (
            // a new cue never pulls the rep out of history; one tap goes back to Live
            <button
              type="button"
              className={`back${newCue ? ' new' : ''}`}
              // the cue slot is aria-live=off while viewing history: announce the new cue here
              aria-live="polite"
              onClick={() => setOpen(null)}
            >
              {newCue ? (
                // the new question in one line, so the rep can decide whether to go back now
                <>
                  <span className="back-q">cue ใหม่: {latest?.question}</span>
                  <span className="back-go">· กลับไป Live</span>
                </>
              ) : (
                '← กลับไป Live'
              )}
            </button>
          )}
          {shown ? (
            <LatestCue cue={shown} followUps={followUps} />
          ) : (
            <p className="note waiting">รอคำถามจากลูกค้า…</p>
          )}
        </div>
      </section>
      <section className="previous">
        {history.length > 0 && <h2 className="hist-h">ประวัติ</h2>}
        <ul aria-label="ประวัติ cue">
          {history.map((c) => (
            <li key={c.cueId}>
              <button
                type="button"
                className={`prev${c.notFound ? ' nf' : ''}`}
                aria-current={c.cueId === viewing?.cueId || undefined}
                onClick={() => setOpen(c.cueId === latest?.cueId ? null : { id: c.cueId, liveKey })}
              >
                <span className="h-time num">{formatTime(c.at)}</span>
                <span className="h-q">{c.question}</span>
                {c.notFound && <span className="h-nf">ไม่พบใน pack</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <details className="transcript">
        <summary>
          <span className="listen">กำลังฟัง</span>
          <span className="heard">{heard ? `…${heard}` : '…'}</span>
        </summary>
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
