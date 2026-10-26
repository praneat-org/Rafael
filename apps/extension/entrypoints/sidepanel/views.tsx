import { formatTime, formatUnanswered } from '../../src/export';
import type { PanelToOffscreen } from '../../src/messages';
import type { Unanswered } from '../../src/session';

type Send = (cmd: PanelToOffscreen) => void;

export function EndView({ send, unanswered }: { send: Send; unanswered: Unanswered[] }) {
  const text = formatUnanswered(unanswered);
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
    <main className="view">
      <h1>จบ session แล้ว</h1>
      <h2>คำถามที่ไม่พบใน pack ({unanswered.length})</h2>
      {unanswered.length === 0 ? (
        <p className="note">ไม่มีคำถามที่ไม่พบใน pack</p>
      ) : (
        <ul aria-label="คำถามที่ไม่พบใน pack">
          {unanswered.map((u) => (
            <li key={`${u.at}${u.question}`}>
              {formatTime(u.at)} {u.question}
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button
          type="button"
          disabled={!unanswered.length}
          onClick={() => navigator.clipboard.writeText(text).catch(() => {})}
        >
          Copy
        </button>
        <button type="button" disabled={!unanswered.length} onClick={download}>
          Download .txt
        </button>
      </div>
      <button type="button" className="primary" onClick={() => send({ k: 'reset' })}>
        ลบ session
      </button>
    </main>
  );
}
