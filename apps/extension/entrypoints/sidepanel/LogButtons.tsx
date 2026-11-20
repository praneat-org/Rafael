import type { LogEvent } from '@rafael/protocol';
import { useState } from 'react';
import { downloadLog, logFileName, logToMarkdown } from '../../src/conversation-log';
import { savePdf } from '../../src/pdf';
import { DownloadMenu } from './DownloadMenu';

export type GetLog = () => Promise<LogEvent[] | null>;

/** Conversation Log download (.md / PDF for people, .json for Eval). The file is built on click (D11). */
export function LogButtons({
  getLog,
  disabled,
  onSaved,
}: {
  getLog: GetLog;
  disabled?: boolean;
  onSaved?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = async (ext: 'md' | 'pdf' | 'json') => {
    setBusy(true);
    setFailed(false);
    const events = await getLog();
    setBusy(false);
    if (!events) return setFailed(true);
    // PDF only opens the print dialog; the user may cancel, so it does not count as saved
    if (ext === 'pdf') return savePdf(logFileName(events, 'md'), logToMarkdown(events));
    downloadLog(events, ext);
    onSaved?.();
  };
  return (
    <>
      <DownloadMenu
        label="Download log"
        formats={{ md: 'Markdown (.md)', pdf: 'PDF', json: 'JSON (สำหรับ Eval)' }}
        disabled={disabled || busy}
        onPick={save}
      />
      {failed && (
        <span role="alert" className="log-fail">
          โหลด log ไม่ได้ ลองใหม่
        </span>
      )}
    </>
  );
}
