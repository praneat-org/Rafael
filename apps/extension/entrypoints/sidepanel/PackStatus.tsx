import { useState } from 'react';
import type { PackInfo, PackState } from '../../src/session';

const TEXT = { loading: 'กำลังอ่าน pack', ready: 'pack พร้อม', error: 'สร้าง pack ไม่สำเร็จ' } as const;

/** Pack summary from `pack.status`. Names only, never content (D11). Collapsed <details>: fixed height (CLS). */
export function PackStatus({ state, info }: { state: PackState | null; info: PackInfo | null }) {
  if (!state) return null;
  const bad = info?.unreadable ?? [];
  return (
    <details className="pack">
      <summary>
        {TEXT[state]}
        {state === 'loading' && info?.total != null && ` · อ่านแล้ว ${info.read ?? 0}/${info.total}`}
        {info && ` · ${info.files.length} ไฟล์ · ${info.tokens.toLocaleString()} token`}
        {bad.length > 0 && ` · อ่านไม่ได้ ${bad.length}`}
      </summary>
      {bad.length > 0 && (
        <ul aria-label="ไฟล์ที่อ่านไม่ได้">
          {bad.map((f) => (
            <li key={f.fileId}>{f.file} (อ่านไม่ได้ — ตรวจสิทธิ์หรือชนิดไฟล์)</li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** PACK_TOO_LARGE: tick files (by Drive id from the server) to leave out, then rebuild. Ticks live in this component only (D11). */
export function PackTooLarge({
  files,
  onRebuild,
}: {
  files: { id?: string; name: string; tokens: number }[];
  onRebuild: (exclude: string[]) => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setTicked((t) => {
      const n = new Set(t);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  return (
    <section className="note err" aria-label="pack ใหญ่เกินไป">
      <p>pack ใหญ่เกินไป — ติ๊กไฟล์ที่จะตัดออก แล้วสร้าง pack ใหม่</p>
      <ul>
        {files.map((f, i) => (
          <li key={f.id ?? `${f.name}-${i}`}>
            <label>
              <input
                type="checkbox"
                disabled={!f.id}
                checked={!!f.id && ticked.has(f.id)}
                onChange={() => f.id && toggle(f.id)}
              />{' '}
              {f.name} · ~{f.tokens.toLocaleString()} token
            </label>
          </li>
        ))}
      </ul>
      <button type="button" disabled={ticked.size === 0} onClick={() => onRebuild([...ticked])}>
        สร้างใหม่โดยไม่เอาไฟล์ที่ติ๊ก ({ticked.size})
      </button>
    </section>
  );
}
