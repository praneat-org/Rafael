import { useEffect, useState } from 'react';
import type { PanelToOffscreen } from '../../src/messages';
import type { Cue, SessionState } from '../../src/session';
import { defaultSettings, loadSettings, type Settings, saveSettings } from '../../src/settings';

type Send = (cmd: PanelToOffscreen) => void;

const STATUS_TEXT = {
  idle: 'ยังไม่เริ่ม',
  connecting: 'กำลังเชื่อมต่อ',
  live: 'สด',
  reconnecting: 'กำลังเชื่อมต่อใหม่',
  closed: 'ปิดแล้ว',
} as const;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function SetupView({ send }: { send: Send }) {
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

function CueCard({ cue }: { cue: Cue }) {
  return (
    <li className="cue">
      <p className="question">{cue.question}</p>
      {cue.notFound && !cue.partial ? (
        <p className="bullet">ไม่พบใน pack</p> // D10: no guessing
      ) : (
        <ul className="bullets">
          {cue.bullets.map((b) => (
            <li key={b} className="bullet">
              {b}
            </li>
          ))}
        </ul>
      )}
      {cue.sources.length > 0 && (
        <p className="anchors">{cue.sources.map((x) => `[${x.file} › ${x.locator}]`).join(' ')}</p>
      )}
      {cue.partial && <p className="note">กำลังสร้าง…</p>}
    </li>
  );
}

export function LiveView({ state, send }: { state: SessionState; send: Send }) {
  return (
    <main className="view">
      <header className="bar">
        <span className={`status ${state.status}`}>{STATUS_TEXT[state.status]}</span>
        <button type="button" onClick={() => send({ k: 'end' })}>
          จบ session
        </button>
      </header>
      {state.error && <p className="note">ผิดพลาด: {state.error}</p>}
      {/* reserved height: a new cue never pushes the layout (CLS) */}
      <ul className="cues" aria-live="polite">
        {state.cues.map((c) => (
          <CueCard key={c.cueId} cue={c} />
        ))}
      </ul>
      <details>
        <summary>transcript ({state.segments.length})</summary>
        <ul className="transcript">
          {state.segments.map((g) => (
            <li key={g.segId} className={g.final ? '' : 'partial'}>
              {g.text}
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}

export function EndView({ send }: { send: Send }) {
  return (
    <main className="view">
      <h1>จบ session แล้ว</h1>
      <p className="note">ข้อมูลของ session ถูกลบจากหน่วยความจำแล้ว</p>
      <button type="button" className="primary" onClick={() => send({ k: 'reset' })}>
        เริ่มใหม่
      </button>
    </main>
  );
}
