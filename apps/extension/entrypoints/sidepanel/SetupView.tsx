import { useEffect, useRef, useState } from 'react';
import type { AudioState } from '../../src/audio/audio-state';
import type { CaptureOpts } from '../../src/audio/capture';
import { getAuthToken, isAuthConfigured, refreshAuthToken } from '../../src/auth';
import { loadNames, shortId } from '../../src/folder-names';
import { parseFolderId } from '../../src/folder-url';
import { type PanelToOffscreen, TAB_GRANTED } from '../../src/messages';
import { loadRecent, pushRecent, saveRecent } from '../../src/recent-folders';
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

export function SetupView({
  send,
  error,
  audio,
}: {
  send: Send;
  error?: string | null;
  audio: AudioState | null;
}) {
  const [testing, setTesting] = useState(false);
  const [grants, setGrants] = useState(0); // bumps when the context menu grants the tab: re-run the preview
  const [s, setS] = useState<Settings>(defaultSettings);
  const [wav, setWav] = useState<File | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const [folderUrl, setFolderUrl] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({}); // memory only, never stored (D11)
  const tried = useRef(new Set<string>());
  const recentWritten = useRef(false); // a stale loadRecent() must not clobber a newer save
  const [inputs, setInputs] = useState<CaptureOpts>({ tab: false, mic: true });
  const configured = isAuthConfigured(import.meta.env.WXT_OAUTH_CLIENT_ID);
  const folderId = parseFolderId(folderUrl);
  useEffect(() => {
    loadSettings().then(setS, () => {});
    loadRecent().then(
      (loaded) => {
        if (!recentWritten.current) setRecent(loaded);
      },
      () => {},
    );
    // default input: this tab when it is Meet, else mic
    browser.tabs.query({ active: true, lastFocusedWindow: true }).then(
      ([t]) => setInputs(defaultInputs(t?.url)),
      () => {},
    );
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: signedIn re-runs the silent token fetch after sign-in
  useEffect(() => {
    if (s.mock || !configured) return;
    let cancelled = false;
    loadNames({
      ids: recent,
      tried: tried.current,
      getToken: () => getAuthToken(false),
      refresh: refreshAuthToken,
      cancelled: () => cancelled,
      onName: (id, name) => setNames((n) => ({ ...n, [id]: name })),
    });
    return () => {
      cancelled = true;
    };
  }, [recent, s.mock, configured, signedIn]);
  useEffect(() => {
    const on = (m: unknown) => m === TAB_GRANTED && setGrants((g) => g + 1);
    browser.runtime.onMessage.addListener(on);
    return () => browser.runtime.onMessage.removeListener(on);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: `grants` is a retrigger counter
  useEffect(() => {
    if (!testing) return;
    let cancelled = false; // a slow wav read must not send a stale preview after cleanup
    // ponytail: restart on input change; wav read is skipped for real capture
    (async () => {
      const wavBase64 = s.mock && wav ? await readBase64(wav) : undefined;
      if (!cancelled) send({ k: 'preview', capture: s.mock ? undefined : inputs, wavBase64 });
    })();
    return () => {
      cancelled = true;
      send({ k: 'preview-stop' });
    };
  }, [testing, s.mock, wav, inputs, grants, send]);
  const level = Math.min(1, Math.sqrt(audio?.level ?? 0) * 1.5); // RMS is small for speech: sqrt for a readable bar
  const block = startBlock({ mock: s.mock, signedIn, folderId, ...inputs });
  const start = async () => {
    setTesting(false);
    if (!s.mock && folderId) {
      const next = pushRecent(recent, folderId);
      recentWritten.current = true;
      setRecent(next);
      saveRecent(next).catch(() => {});
    }
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
          {recent.length > 0 && (
            <select
              aria-label="โฟลเดอร์ล่าสุด"
              value=""
              onChange={(e) =>
                e.target.value &&
                setFolderUrl(`https://drive.google.com/drive/folders/${e.target.value}`)
              }
            >
              <option value="">โฟลเดอร์ล่าสุด…</option>
              {recent.map((id) => (
                <option key={id} value={id}>
                  {names[id] ?? shortId(id)}
                </option>
              ))}
            </select>
          )}
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
      <div className="meter-row">
        <button
          type="button"
          disabled={!testing && s.mock && !wav}
          onClick={() => setTesting(!testing)}
        >
          {testing ? 'หยุดทดสอบเสียง' : 'ทดสอบเสียง'}
        </button>
        <meter
          className="meter"
          aria-label="ระดับเสียง"
          min={0}
          max={1}
          value={testing ? level : 0}
        />
      </div>
      {testing && audio?.error && (
        <p className="note err">
          {audio.error === 'tab-capture'
            ? 'จับเสียงแท็บไม่ได้ — กดไอคอน extension (หรือ Alt+Shift+R / คลิกขวาในหน้า Meet › Rafael: จับเสียงแท็บนี้) บนแท็บ Meet ก่อน แล้วลองใหม่'
            : `เปิดเสียงไม่ได้ (${audio.error})`}
        </p>
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
