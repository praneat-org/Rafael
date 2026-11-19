import type { LogEvent } from '@rafael/protocol';
import { useState } from 'react';
import { downloadLog } from '../../src/conversation-log';

export type GetLog = () => Promise<LogEvent[] | null>;

/** Conversation Log download (.md for people, .json for Eval). The file is built on click (D11). */
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
  const save = async (ext: 'md' | 'json') => {
    setBusy(true);
    setFailed(false);
    const events = await getLog();
    setBusy(false);
    if (!events) return setFailed(true);
    downloadLog(events, ext);
    onSaved?.();
  };
  return (
    <>
      <button
        type="button"
        className="ghost"
        aria-label="Download log .md"
        disabled={disabled || busy}
        onClick={() => save('md')}
      >
        log .md
      </button>
      <button
        type="button"
        className="ghost"
        aria-label="Download log .json"
        disabled={disabled || busy}
        onClick={() => save('json')}
      >
        .json
      </button>
      {failed && (
        <span role="alert" className="log-fail">
          โหลด log ไม่ได้ ลองใหม่
        </span>
      )}
    </>
  );
}
