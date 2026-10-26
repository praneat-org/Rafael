import { useEffect, useState } from 'react';
import { formatTime, formatUnanswered } from '../../src/export';
import type { PanelToOffscreen } from '../../src/messages';
import type { Unanswered } from '../../src/session';
import { defaultSettings, loadSettings, type Settings, saveSettings } from '../../src/settings';

type Send = (cmd: PanelToOffscreen) => void;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function SetupView({ send, error }: { send: Send; error?: string | null }) {
  const [s, setS] = useState<Settings>(defaultSettings);
  const [wav, setWav] = useState<File | null>(null);
  useEffect(() => {
    loadSettings().then(setS, () => {});
  }, []);
  const update = (next: Settings) => {
    setS(next);
    saveSettings(next).catch(() => {});
  };
  const start = async () => {
    const wavBase64 = wav ? await readBase64(wav) : undefined;
    send({ k: 'start', mock: s.mock, latencyMs: s.latencyMs, wavBase64 });
  };
  return (
    <main className="view">
      <h1>Rafael</h1>
      {error === 'SESSION_NOT_FOUND' && (
        <p className="note">session เดิมหายไปแล้ว (server เริ่มใหม่) — กดเริ่มใหม่อีกครั้ง</p>
      )}
      {error === 'CONNECTION_CLOSED' && (
        <p className="note">การเชื่อมต่อถูกปิด (ยืนยันตัวตนไม่ผ่านหรือ server ปฏิเสธ) — กดเริ่มใหม่อีกครั้ง</p>
      )}
      <label className="row">
        <input
          type="checkbox"
          checked={s.mock}
          onChange={(e) => update({ ...s, mock: e.target.checked })}
        />
        โหมดจำลอง (mock)
      </label>
      <label className="row">
        latency จำลอง (ms)
        <input
          type="number"
          min={0}
          step={100}
          value={s.latencyMs}
          onChange={(e) => update({ ...s, latencyMs: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      {import.meta.env.DEV && (
        <label className="row">
          ไฟล์เสียงทดสอบ (.wav 16 kHz mono)
          <input type="file" accept=".wav" onChange={(e) => setWav(e.target.files?.[0] ?? null)} />
        </label>
      )}
      {!s.mock && !import.meta.env.DEV && (
        <p className="note">ล็อกอินจริงยังไม่พร้อม (รอ FE-39) — เปิดโหมดจำลองก่อน</p>
      )}
      <button
        type="button"
        className="primary"
        disabled={!s.mock && !import.meta.env.DEV}
        onClick={start}
      >
        เริ่ม session
      </button>
    </main>
  );
}

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
        <p className="note"></p>
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
