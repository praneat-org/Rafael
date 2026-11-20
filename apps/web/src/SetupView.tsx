import { useEffect, useRef, useState } from 'react';
import { ErrorNote } from '../../extension/entrypoints/sidepanel/ErrorNote';
import icon from '../../extension/public/icon/96.png';
import type { AudioState } from '../../extension/src/audio/audio-state';
import type { CaptureOpts } from '../../extension/src/audio/capture';
import { loadNames, shortId } from '../../extension/src/folder-names';
import { parseFolderId } from '../../extension/src/folder-url';
import type { PanelToOffscreen } from '../../extension/src/messages';
import { pushRecent } from '../../extension/src/recent-folders';
import { startBlock } from '../../extension/src/setup-state';
import { SUPPORT_TEXT, type Unsupported } from './browser-support';
import { auth, configured, FAKE } from './identity';
import { loadRecent, saveRecent } from './storage';

type Send = (cmd: PanelToOffscreen) => void;

const BLOCK_HINT = {
  'not-signed-in': 'ลงชื่อเข้าใช้ด้วย Google ก่อน จึงจะเริ่มได้',
  'no-folder': 'วางลิงก์โฟลเดอร์ Drive ของ pack ก่อน จึงจะเริ่มได้',
  'no-input': 'ติ๊กอย่างน้อย 1 แหล่งเสียง (แท็บ Meet หรือไมค์) ก่อน จึงจะเริ่มได้',
} as const;

// the server turned the account down (4401 / UNAUTHORIZED): web wording, not "switch Chrome profile"
const DENIED = {
  what: 'บัญชีนี้ใช้ Rafael ไม่ได้',
  todo: 'ใช้ได้เฉพาะบัญชี @praneat.com — กด "เปลี่ยนบัญชี" แล้วเลือกบัญชี praneat.com',
};

export function SetupView({
  send,
  error,
  audio,
  support,
}: {
  send: Send;
  error?: string | null;
  audio: AudioState | null;
  support: { reasons: Unsupported[]; blocked: boolean };
}) {
  const [signedIn, setSignedIn] = useState(FAKE || !!auth?.cached());
  const [signInFailed, setSignInFailed] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [folderUrl, setFolderUrl] = useState('');
  const [attendees, setAttendees] = useState(''); // meeting summary only; memory only (D11)
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [names, setNames] = useState<Record<string, string>>({}); // memory only, never stored (D11)
  const tried = useRef(new Set<string>());
  const [inputs, setInputs] = useState<CaptureOpts>({ tab: true, mic: true });
  const folderId = parseFolderId(folderUrl);
  const denied = error === 'UNAUTHORIZED' || error === 'CONNECTION_CLOSED';

  // biome-ignore lint/correctness/useExhaustiveDependencies: signedIn re-runs the silent name fetch after sign-in
  useEffect(() => {
    const a = auth;
    if (!a) return;
    let cancelled = false;
    loadNames({
      ids: recent,
      tried: tried.current,
      getToken: async () => a.cached(),
      refresh: () => a.getToken(false, { fresh: true }),
      cancelled: () => cancelled,
      onName: (id, name) => setNames((n) => ({ ...n, [id]: name })),
    });
    return () => {
      cancelled = true;
    };
  }, [recent, signedIn]);

  const signIn = async (select = false) => {
    if (!auth) return;
    setSigningIn(true);
    if (select) auth.clear();
    const ok = (await auth.getToken(true, { select })) !== null; // token is not kept here (D11)
    setSigningIn(false);
    setSignedIn(ok);
    setSignInFailed(!ok);
  };

  const block = startBlock({ mock: false, signedIn, folderId, ...inputs });
  const start = () => {
    if (folderId) {
      const next = pushRecent(recent, folderId);
      setRecent(next);
      saveRecent(next);
    }
    // must stay synchronous up to getDisplayMedia: it needs this click's user activation
    send({
      k: 'start',
      mock: false,
      latencyMs: 0,
      packId: folderId ?? undefined,
      capture: inputs,
      attendees: attendees.trim() || undefined,
    });
  };
  const remaining = [!signedIn, !folderId, !inputs.tab && !inputs.mic].filter(Boolean).length;
  const stepClass = (done: boolean, now: boolean) => `step${done ? ' done' : now ? ' now' : ''}`;
  const folderDone = !!folderId;
  const inputDone = inputs.tab || inputs.mic;
  const cantStart = block !== null || !configured || support.blocked;
  return (
    <main className="view setup">
      <header className="brand">
        <h1>
          <img className="mark" src={icon} alt="" width={28} height={28} />
          Rafael
        </h1>
        <p className="tagline">ตอบคำถามลูกค้าจากเอกสาร deal ระหว่างประชุม</p>
        <p className="note">
          รองรับ <b>Chrome บนคอมพิวเตอร์</b> · <a href="#/onboarding">คู่มือใช้งาน (1 หน้า)</a>
        </p>
      </header>
      {support.reasons.map((r) => (
        <p key={r} className="note warn" role="alert">
          {SUPPORT_TEXT[r]}
        </p>
      ))}
      {denied && <ErrorNote text={DENIED} />}
      {error === 'SESSION_NOT_FOUND' && (
        <ErrorNote
          text={{ what: 'session เดิมหายไปแล้ว (server เริ่มใหม่)', todo: 'กดเริ่ม session ใหม่อีกครั้ง' }}
        />
      )}
      {!configured ? (
        <p className="note">ยังไม่ได้ตั้งค่า OAuth client (VITE_OAUTH_CLIENT_ID) — ลงชื่อเข้าใช้ไม่ได้</p>
      ) : (
        <ol className="checklist">
          <li className={stepClass(signedIn, !signedIn)}>
            <span className="dotn" aria-hidden="true">
              {signedIn ? '✓' : '1'}
            </span>
            <div>
              <p className="st">ลงชื่อเข้าใช้</p>
              {signedIn ? (
                <p className="sd">
                  ลงชื่อเข้าใช้แล้ว
                  {auth && (
                    <>
                      {' · '}
                      <button type="button" className="link inline" onClick={() => signIn(true)}>
                        เปลี่ยนบัญชี
                      </button>
                    </>
                  )}
                </p>
              ) : (
                <button
                  type="button"
                  className="step-btn"
                  onClick={() => signIn(denied)}
                  disabled={signingIn}
                >
                  {signingIn ? 'กำลังลงชื่อเข้าใช้…' : 'ลงชื่อเข้าใช้ด้วย Google'}
                </button>
              )}
              {signedIn && denied && (
                <button type="button" className="step-btn" onClick={() => signIn(true)}>
                  เปลี่ยนบัญชี
                </button>
              )}
              {signInFailed && (
                <p className="note err" role="alert">
                  ลงชื่อเข้าใช้ไม่สำเร็จ — ตรวจว่าเบราว์เซอร์ไม่ได้บล็อกป๊อปอัป แล้วลองใหม่
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
                เสียงจากแท็บ Meet
              </label>
              {inputs.tab && (
                <p className="sd">
                  กดเริ่มแล้ว Chrome จะให้เลือกแท็บ: เลือกแท็บ Meet และติ๊ก{' '}
                  <b>"แชร์เสียงแท็บ" (Also share tab audio)</b>
                </p>
              )}
              <label className="src">
                <input
                  type="checkbox"
                  checked={inputs.mic}
                  onChange={(e) => setInputs({ ...inputs, mic: e.target.checked })}
                />
                ไมค์ในห้องประชุม
              </label>
              {audio?.error === 'mic-permission' && (
                <ErrorNote
                  text={{
                    what: 'ใช้ไมค์ไม่ได้ เพราะยังไม่ได้อนุญาตไมค์ให้ Rafael',
                    todo: 'กดไอคอนตั้งค่าหน้าเว็บข้างช่อง URL แล้วอนุญาตไมค์ หรือเอาติ๊ก "ไมค์" ออก',
                  }}
                />
              )}
            </div>
          </li>
        </ol>
      )}
      <p className="note">
        ก่อนเริ่มทุกครั้ง แจ้งลูกค้าว่าทีมใช้ระบบช่วยฟัง (ดู <a href="#/onboarding">คู่มือ</a> ข้อ "แจ้งลูกค้า")
      </p>
      <footer className="s-foot">
        <button type="button" className="primary" disabled={cantStart} onClick={start}>
          เริ่ม session
          {block && configured && !support.blocked ? ` · เหลืออีก ${remaining} ขั้น` : ''}
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
