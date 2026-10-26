import { useEffect, useState } from 'react';
import type { PanelToOffscreen } from '../../src/messages';
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
      {!s.mock && <p className="note">เชื่อม server จริงยังไม่พร้อม (รอ FE-35) — เปิดโหมดจำลองก่อน</p>}
      <button type="button" className="primary" disabled={!s.mock} onClick={start}>
        เริ่ม session
      </button>
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
