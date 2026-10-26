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

/** PACK_TOO_LARGE: biggest files with approximate tokens. Display only: protocol has no "exclude" request yet (follow-up on BE-110). */
export function PackTooLarge({ files }: { files: { name: string; tokens: number }[] }) {
  return (
    <section className="note err" aria-label="pack ใหญ่เกินไป">
      <p>pack ใหญ่เกินไป — ย้ายหรือลบไฟล์ใหญ่ออกจากโฟลเดอร์ใน Drive แล้วจบ session เริ่มใหม่</p>
      <ul>
        {files.map((f) => (
          <li key={f.name}>
            {f.name} · ~{f.tokens.toLocaleString()} token
          </li>
        ))}
      </ul>
    </section>
  );
}
