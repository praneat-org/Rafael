import { useEffect, useState } from 'react';
import type { CaptureOpts } from '../../src/audio/capture';
import { getAuthToken, isAuthConfigured } from '../../src/auth';
import { parseFolderId } from '../../src/folder-url';
import type { PanelToOffscreen } from '../../src/messages';
import { defaultSettings, loadSettings, type Settings, saveSettings } from '../../src/settings';
import { defaultInputs, startBlock } from '../../src/setup-state';

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
  const [signedIn, setSignedIn] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const [folderUrl, setFolderUrl] = useState('');
  const [inputs, setInputs] = useState<CaptureOpts>({ tab: false, mic: true });
  const configured = isAuthConfigured(import.meta.env.WXT_OAUTH_CLIENT_ID);
  const folderId = parseFolderId(folderUrl);
  useEffect(() => {
    loadSettings().then(setS, () => {});
    // default input: this tab when it is Meet, else mic
    browser.tabs.query({ active: true, lastFocusedWindow: true }).then(
      ([t]) => setInputs(defaultInputs(t?.url)),
      () => {},
    );
  }, []);
  const update = (next: Settings) => {
    setS(next);
    saveSettings(next).catch(() => {});
  };
  const signIn = async () => {
    const ok = (await getAuthToken(true)) !== null; // token is not kept here (D11)
    setSignedIn(ok);
    setSignInFailed(!ok);
  };
  const block = startBlock({ mock: s.mock, signedIn, folderId, ...inputs });
  const start = async () => {
    const wavBase64 = wav ? await readBase64(wav) : undefined;
    send({
      k: 'start',
      mock: s.mock,
      latencyMs: s.latencyMs,
      wavBase64,
      packId: s.mock ? undefined : (folderId ?? undefined),
      capture: s.mock ? undefined : inputs,
    });
  };
  return (
    <main className="view">
      <h1>Rafael</h1>
      {error === 'SESSION_NOT_FOUND' && (
        <p className="note">session เดิมหายไปแล้ว (server เริ่มใหม่) — กดเริ่มใหม่อีกครั้ง</p>
      )}
      {error === 'CONNECTION_CLOSED' && (
        <p className="note">
          การเชื่อมต่อถูกปิด (ยืนยันตัวตนไม่ผ่านหรือ server ปฏิเสธ) — ใช้ได้เฉพาะบัญชี @praneat.com ลองสลับ Chrome
          profile แล้วลงชื่อเข้าใช้ใหม่
        </p>
      )}
      <label className="row">
        <input
          type="checkbox"
          checked={s.mock}
          onChange={(e) => update({ ...s, mock: e.target.checked })}
        />
        โหมดจำลอง (mock)
      </label>
      {s.mock ? (
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
      ) : !configured ? (
        <p className="note">
          ยังไม่ได้ตั้งค่า OAuth client (WXT_OAUTH_CLIENT_ID — รอ BE-71) — ลงชื่อเข้าใช้จริงยังไม่ได้
          ใช้โหมดจำลองไปก่อน
        </p>
      ) : (
        <>
          <button type="button" onClick={signIn} disabled={signedIn}>
            {signedIn ? 'ลงชื่อเข้าใช้แล้ว' : 'ลงชื่อเข้าใช้ด้วย Google'}
          </button>
          {signInFailed && <p className="note err">ลงชื่อเข้าใช้ไม่สำเร็จ — ลองสลับ Chrome profile</p>}
          <label className="field">
            ลิงก์โฟลเดอร์ Drive (pack)
            <input
              type="text"
              value={folderUrl}
              placeholder="https://drive.google.com/drive/folders/..."
              onChange={(e) => setFolderUrl(e.target.value)}
            />
          </label>
          {folderUrl && !folderId && (
            <p className="note err">ต้องเป็นลิงก์โฟลเดอร์ Drive (…/drive/folders/…) ไม่ใช่ไฟล์</p>
          )}
          {/* ponytail: search by folder name needs a server API (BE-87); paste URL only for now */}
          <label className="row">
            <input
              type="checkbox"
              checked={inputs.tab}
              onChange={(e) => setInputs({ ...inputs, tab: e.target.checked })}
            />
            เสียงจากแท็บนี้ (Meet)
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={inputs.mic}
              onChange={(e) => setInputs({ ...inputs, mic: e.target.checked })}
            />
            ไมค์ (ห้องประชุม)
          </label>
        </>
      )}
      {import.meta.env.DEV && (
        <label className="row">
          ไฟล์เสียงทดสอบ (.wav 16 kHz mono)
          <input type="file" accept=".wav" onChange={(e) => setWav(e.target.files?.[0] ?? null)} />
        </label>
      )}
      <button
        type="button"
        className="primary"
        disabled={block !== null || (!s.mock && !configured)}
        onClick={start}
      >
        เริ่ม session
      </button>
    </main>
  );
}
