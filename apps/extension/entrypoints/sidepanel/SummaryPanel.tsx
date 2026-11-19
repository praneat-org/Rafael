import type { MeetingSummary } from '@rafael/protocol';
import { useState } from 'react';
import { saveFile } from '../../src/conversation-log';
import { summaryToMarkdown, UNSET, unsetCount } from '../../src/meeting-summary';
import type { SessionState } from '../../src/session';

/** End: meeting summary draft. Built on click, edited here, then copied / exported. Memory only (D11). */
export function SummaryPanel({
  meta,
  attendees: initialAttendees,
  getSummary,
}: {
  meta: NonNullable<SessionState['endMeta']>;
  attendees: string;
  getSummary: () => Promise<MeetingSummary | null>;
}) {
  const [subject, setSubject] = useState(meta.folderName);
  const [attendees, setAttendees] = useState(initialAttendees);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const make = async () => {
    setBusy(true);
    setFailed(false);
    const s = await getSummary();
    setBusy(false);
    if (!s) return setFailed(true);
    setDraft(summaryToMarkdown(s, { subject, attendees, ...meta }));
  };
  const blanks = draft ? unsetCount(draft) : 0;
  const file = `rafael_summary_${meta.startTs.slice(0, 10).replace(/-/g, '')}-${meta.startTs.slice(11, 16).replace(':', '')}_${(subject || 'meeting').replace(/[\\/:*?"<>|\s.]+/g, '_').slice(0, 60)}.md`;
  return (
    <section className="e-sec summary" aria-label="สรุปการประชุม">
      <h2>สรุปการประชุม</h2>
      {draft === null ? (
        <>
          <label className="field">
            <span className="sd">หัวข้อการประชุม</span>
            <input
              type="text"
              value={subject}
              disabled={busy}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="sd">ผู้เข้าร่วมประชุม (ไม่กรอก = "ยังไม่ระบุ")</span>
            <input
              type="text"
              value={attendees}
              disabled={busy} // the draft is built from the values at click time
              placeholder="เช่น คุณสมชาย (ACME), คุณวิภา"
              onChange={(e) => setAttendees(e.target.value)}
            />
          </label>
          <button type="button" className="primary" disabled={busy} onClick={make}>
            {busy ? 'กำลังสร้างสรุป… (ประมาณ 1 นาที)' : 'สร้างสรุป'}
          </button>
          {failed && (
            <p role="alert" className="note err">
              สร้างสรุปไม่ได้ ลองใหม่
            </p>
          )}
        </>
      ) : (
        <>
          {blanks > 0 && (
            <p role="status" className="note warn-blank">
              {UNSET} {blanks} จุด: ในห้องไม่มีใครพูดถึง กรอกเองก่อนส่ง
            </p>
          )}
          <textarea
            className={`draft${blanks ? ' has-blank' : ''}`}
            aria-label="ร่างสรุปการประชุม แก้ไขได้"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={16}
          />
          <div className="e-row">
            <button
              type="button"
              className="primary"
              onClick={() =>
                navigator.clipboard.writeText(draft).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  },
                  () => {},
                )
              }
            >
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกสรุป'}
            </button>
            <button type="button" onClick={() => saveFile(file, draft, 'text/markdown')}>
              .md
            </button>
          </div>
        </>
      )}
    </section>
  );
}
