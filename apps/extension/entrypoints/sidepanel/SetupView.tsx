import { useEffect, useRef, useState } from 'react';
import type { AudioState } from '../../src/audio/audio-state';
import type { CaptureOpts } from '../../src/audio/capture';
import { getAuthToken, isAuthConfigured, refreshAuthToken } from '../../src/auth';
import { errorText, MIC_DENIED } from '../../src/error-text';
import { loadNames, shortId } from '../../src/folder-names';
import { parseFolderId } from '../../src/folder-url';
import { type PanelToOffscreen, TAB_GRANTED } from '../../src/messages';
import { pushRecent } from '../../src/recent-folders';
import { loadRecent, saveRecent } from '../../src/recent-storage';
import { defaultSettings, loadSettings, type Settings, saveSettings } from '../../src/settings';
import { defaultInputs, startBlock } from '../../src/setup-state';

import { ErrorNote } from './ErrorNote';

type Send = (cmd: PanelToOffscreen) => void;

const BLOCK_HINT = {
  'not-signed-in': 'ลงชื่อเข้าใช้ด้วย Google ก่อน จึงจะเริ่มได้',
  'no-folder': 'วางลิงก์โฟลเดอร์ Drive ของ pack ก่อน จึงจะเริ่มได้',
  'no-input': 'ติ๊กอย่างน้อย 1 แหล่งเสียง (แท็บ Meet หรือไมค์) ก่อน จึงจะเริ่มได้',
} as const;

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
  const [signingIn, setSigningIn] = useState(false);
  const [folderUrl, setFolderUrl] = useState('');
  const [attendees, setAttendees] = useState(''); // meeting summary only; memory only (D11)
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
    setSigningIn(true);
    const ok = (await getAuthToken(true)) !== null; // token is not kept here (D11)
    setSigningIn(false);
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
      attendees: attendees.trim() || undefined,
    });
  };
  const remaining = [!signedIn, !folderId, !inputs.tab && !inputs.mic].filter(Boolean).length;
  const stepClass = (done: boolean, now: boolean) => `step${done ? ' done' : now ? ' now' : ''}`;
  const folderDone = !!folderId;
  const inputDone = inputs.tab || inputs.mic;
  const meter = (
    <div className="meter-row">
      <button
        type="button"
        disabled={!testing && s.mock && !wav}
        onClick={() => setTesting(!testing)}
      >
        {testing ? 'หยุดทดสอบเสียง' : 'ทดสอบเสียง'}
      </button>
      <meter className="meter" aria-label="ระดับเสียง" min={0} max={1} value={testing ? level : 0} />
    </div>
  );
  return (
    <main className="view setup">
      <header className="brand">
        <h1>
          <img className="mark" src="/icon/96.png" alt="" width={28} height={28} />
          Rafael
        </h1>
        <p className="tagline">ตอบคำถามลูกค้าจากเอกสาร deal ระหว่างประชุม</p>
      </header>
      {(error === 'SESSION_NOT_FOUND' || error === 'CONNECTION_CLOSED') && (
        <ErrorNote text={errorText(error)} />
      )}
      {import.meta.env.DEV && (
        <div className="devbox">
          <label className="row">
            <input
              type="checkbox"
              checked={s.mock}
              onChange={(e) => update({ ...s, mock: e.target.checked })}
            />
            โหมดจำลอง (mock)
          </label>
          {s.mock && (
            <label className="row">
              latency จำลอง (ms)
              <input
                type="number"
                min={0}
                step={100}
                value={s.latencyMs}
                onChange={(e) =>
                  update({ ...s, latencyMs: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </label>
          )}
          <label className="row">
            ไฟล์เสียงทดสอบ (.wav 16 kHz mono)
            <input
              type="file"
              accept=".wav"
              onChange={(e) => setWav(e.target.files?.[0] ?? null)}
            />
          </label>
          {s.mock && meter}
        </div>
      )}
      {s.mock ? null : !configured ? (
        <p className="note">
          ยังไม่ได้ตั้งค่า OAuth client (WXT_OAUTH_CLIENT_ID) — ลงชื่อเข้าใช้จริงยังไม่ได้
          {import.meta.env.DEV && ' ใช้โหมดจำลองไปก่อน'}
        </p>
      ) : (
        <ol className="checklist">
          <li className={stepClass(signedIn, !signedIn)}>
            <span className="dotn" aria-hidden="true">
              {signedIn ? '✓' : '1'}
            </span>
            <div>
              <p className="st">ลงชื่อเข้าใช้</p>
              {signedIn ? (
                <p className="sd">ลงชื่อเข้าใช้แล้ว</p>
              ) : (
                <button type="button" className="step-btn" onClick={signIn} disabled={signingIn}>
                  {signingIn ? 'กำลังลงชื่อเข้าใช้…' : 'ลงชื่อเข้าใช้ด้วย Google'}
                </button>
              )}
              {signInFailed && (
                <p className="note err" role="alert">
                  ลงชื่อเข้าใช้ไม่สำเร็จ — ลองสลับ Chrome profile
                </p>
              )}
            </div>
          </li>
          <li className={stepClass(folderDone, signedIn && !folderDone)}>
            <span className="dotn" aria-hidden="true">
              {folderDone ? '✓' : '2'}
            </span>
            <div>
              <label className="field">
                <span className="st">โฟลเดอร์เอกสารของ deal</span>
                <span className="sd">วางลิงก์ Google Drive หรือเลือกจากล่าสุด</span>
                <input
                  type="text"
                  value={folderUrl}
                  aria-invalid={!!folderUrl && !folderId}
                  placeholder="https://drive.google.com/drive/folders/..."
                  onChange={(e) => setFolderUrl(e.target.value)}
                />
              </label>
              {recent.length > 0 && (
                <fieldset className="recent" aria-label="โฟลเดอร์ล่าสุด">
                  {recent.map((id) => (
                    <button
                      type="button"
                      key={id}
                      aria-pressed={folderId === id}
                      onClick={() => setFolderUrl(`https://drive.google.com/drive/folders/${id}`)}
                    >
                      {names[id] ?? shortId(id)}
                    </button>
                  ))}
                </fieldset>
              )}
              {folderUrl && !folderId && (
                <p className="note err" role="alert">
                  ต้องเป็นลิงก์โฟลเดอร์ Drive (…/drive/folders/…) ไม่ใช่ไฟล์
                </p>
              )}
              {/* ponytail: search by folder name needs a server API (BE-87); paste URL only for now */}
              <label className="field">
                <span className="sd">ผู้เข้าร่วมประชุม (ไม่บังคับ ใช้ในสรุปการประชุม)</span>
                <input
                  type="text"
                  value={attendees}
                  placeholder="เช่น คุณสมชาย (ACME), คุณวิภา"
                  onChange={(e) => setAttendees(e.target.value)}
                />
              </label>
            </div>
          </li>
          <li className={stepClass(inputDone, signedIn && folderDone && !inputDone)}>
            <span className="dotn" aria-hidden="true">
              {inputDone ? '✓' : '3'}
            </span>
            <div>
              <p className="st">แหล่งเสียง</p>
              <label className="src">
                <input
                  type="checkbox"
                  checked={inputs.tab}
                  onChange={(e) => setInputs({ ...inputs, tab: e.target.checked })}
                />
                เสียงจากแท็บนี้ (Meet)
              </label>
              <label className="src">
                <input
                  type="checkbox"
                  checked={inputs.mic}
                  onChange={(e) => setInputs({ ...inputs, mic: e.target.checked })}
                />
                ไมค์ในห้องประชุม
              </label>
              {meter}
              {testing && audio?.error === 'tab-capture' && (
                <div className="note err" role="alert">
                  <p className="err-what">จับเสียงแท็บไม่ได้</p>
                  <ol className="steps">
                    <li>สลับไปที่แท็บ Meet</li>
                    <li>
                      กดไอคอน Rafael บนแถบเครื่องมือ หรือกด <kbd>Alt+Shift+R</kbd>
                    </li>
                    <li>กลับมาที่ panel — แถบเสียงจะขยับเมื่อจับได้</li>
                  </ol>
                  <p className="err-code">หรือคลิกขวาในหน้า Meet › Rafael: จับเสียงแท็บนี้</p>
                </div>
              )}
              {testing && audio?.error === 'mic-permission' && <ErrorNote text={MIC_DENIED} />}
            </div>
          </li>
        </ol>
      )}
      <footer className="s-foot">
        <button
          type="button"
          className="primary"
          disabled={block !== null || (!s.mock && !configured)}
          aria-describedby={block && configured ? 'start-hint' : undefined}
          onClick={start}
        >
          เริ่ม session
          {block && configured && !s.mock ? ` · เหลืออีก ${remaining} ขั้น` : ''}
        </button>
        {block && configured && (
          <p id="start-hint" className="note hint">
            {BLOCK_HINT[block]}
          </p>
        )}
      </footer>
    </main>
  );
}
