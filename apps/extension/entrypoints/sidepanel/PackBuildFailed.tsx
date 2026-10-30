/** PACK_BUILD_FAILED: code-only error from the server (D11). Retry resends the exclude the transport already holds. */
export function PackBuildFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="note err" aria-label="สร้าง pack ไม่สำเร็จ">
      <p>สร้าง pack ไม่สำเร็จ</p>
      <button type="button" onClick={onRetry}>
        ลองใหม่
      </button>
    </section>
  );
}
