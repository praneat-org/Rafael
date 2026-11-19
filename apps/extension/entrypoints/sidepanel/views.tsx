import type { MeetingSummary } from '@rafael/protocol';
import { useEffect, useState } from 'react';
import { formatTime, formatUnanswered } from '../../src/export';
import type { PanelToOffscreen } from '../../src/messages';
import type { SessionState, Unanswered } from '../../src/session';
import { type GetLog, LogButtons } from './LogButtons';
import { SummaryPanel } from './SummaryPanel';

type Send = (cmd: PanelToOffscreen) => void;

export function EndView({
  send,
  unanswered,
  endLog,
  getLog,
  endMeta,
  attendees,
  getSummary,
}: {
  send: Send;
  unanswered: Unanswered[];
  endLog: SessionState['endLog'];
  getLog: GetLog;
  endMeta: SessionState['endMeta'];
  attendees: string;
  getSummary: () => Promise<MeetingSummary | null>;
}) {
  const text = formatUnanswered(unanswered);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  // deleting before any download warns once: the log exists nowhere else (D11)
  const [warned, setWarned] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t); // also clears on unmount
  }, [copied]);
  return (
    <main className="view end">
      <header>
        <h1>จบ session</h1>
      </header>
      <section className="e-sec">
        <h2>
          ต้องตามต่อ <span className="num">{unanswered.length}</span> ข้อ
        </h2>
        {unanswered.length === 0 ? (
          <p className="note">ไม่มีรายการคำถามที่ต้องตามต่อ</p>
        ) : (
          <ul className="fu" aria-label="คำถามที่ไม่พบใน pack">
            {unanswered.map((u) => (
              <li key={`${u.at}${u.question}`}>
                <span className="h-time num">{formatTime(u.at)}</span>
                <span>{u.question}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {endLog === 'ready' && endMeta && (
        <SummaryPanel meta={endMeta} attendees={attendees} getSummary={getSummary} />
      )}
      <footer className="s-foot">
        <div className="e-row">
          <button
            type="button"
            className="primary"
            disabled={!unanswered.length}
            onClick={() =>
              navigator.clipboard.writeText(text).then(
                () => setCopied(true),
                () => {},
              )
            }
          >
            {copied ? 'คัดลอกแล้ว' : 'คัดลอกรายการ'}
          </button>
        </div>
        <div className="e-row log-row">
          <span className="log-h">
            {endLog === 'waiting'
              ? 'กำลังรับ Conversation Log…'
              : endLog === 'ready'
                ? 'Conversation Log'
                : 'ไม่ได้รับ Conversation Log (การเชื่อมต่อหลุดตอนจบ)'}
          </span>
          <LogButtons
            getLog={getLog}
            disabled={endLog !== 'ready'}
            onSaved={() => setSaved(true)}
          />
        </div>
        {warned && (
          <p role="alert" className="note warn-del">
            ยังไม่ได้ download log ลบแล้วจะกู้คืนไม่ได้
          </p>
        )}
        <button
          type="button"
          className="link"
          onClick={() => {
            // also while the last copy is still on its way: deleting now would drop it
            if (!saved && endLog !== 'none' && !warned) return setWarned(true);
            send({ k: 'reset' });
          }}
        >
          {warned && !saved ? 'ลบเลย ไม่ต้อง download' : 'ลบ session แล้วเริ่มใหม่'}
        </button>
      </footer>
    </main>
  );
}
