import { useEffect, useState } from 'react';
import { formatTime, formatUnanswered } from '../../src/export';
import type { PanelToOffscreen } from '../../src/messages';
import type { Unanswered } from '../../src/session';

type Send = (cmd: PanelToOffscreen) => void;

export function EndView({ send, unanswered }: { send: Send; unanswered: Unanswered[] }) {
  const text = formatUnanswered(unanswered);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t); // also clears on unmount
  }, [copied]);
  // export is built here in the browser from memory; nothing is stored or sent (D11)
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rafael-follow-up.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
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
          <p className="note">ไม่มีคำถามที่ต้องตามต่อ — ทุกคำถามมีคำตอบในเอกสาร</p>
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
          <button
            type="button"
            aria-label="Download .txt"
            disabled={!unanswered.length}
            onClick={download}
          >
            .txt
          </button>
        </div>
        <button type="button" className="link" onClick={() => send({ k: 'reset' })}>
          ลบ session แล้วเริ่มใหม่
        </button>
      </footer>
    </main>
  );
}
