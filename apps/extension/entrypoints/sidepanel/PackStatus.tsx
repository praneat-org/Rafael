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
