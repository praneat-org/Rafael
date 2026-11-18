import type { LogEvent } from '@rafael/protocol';
import { stripInlineAnchor } from './strip-anchor';

// Conversation Log -> file, built in the panel when the user clicks download.
// Nothing is stored; the server sent the events (D11).

type Of<T extends LogEvent['type']> = Extract<LogEvent, { type: T }>;

const hms = (ts: string) => ts.slice(11, 19); // ts is already Asia/Bangkok
const hm = (ts: string) => ts.slice(11, 16);
const day = (ts: string) => ts.slice(0, 10);
const oneLine = (t: string) => t.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/** rafael_<YYYYMMDD-HHmm>_<folder>.<ext>, start time in Asia/Bangkok */
export function logFileName(events: LogEvent[], ext: 'md' | 'json'): string {
  const s = events[0]?.type === 'session.start' ? (events[0] as Of<'session.start'>) : undefined;
  const ts = s?.ts ?? '0000-00-00T00:00';
  const stamp = `${ts.slice(0, 4)}${ts.slice(5, 7)}${ts.slice(8, 10)}-${ts.slice(11, 13)}${ts.slice(14, 16)}`;
  const folder = (s?.folderName || s?.folderId || 'session')
    .replace(/[\\/:*?"<>|\s.]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `rafael_${stamp}_${folder || 'session'}.${ext}`;
}

/** .json for Eval: every field, as the server sent it */
export const logToJson = (events: LogEvent[]) => `${JSON.stringify({ events }, null, 2)}\n`;

/** .md for people: header -> timeline (transcript and cues by time) -> "not found" list */
export function logToMarkdown(events: LogEvent[]): string {
  const start = events.find((e): e is Of<'session.start'> => e.type === 'session.start');
  const end = events.find((e): e is Of<'session.end'> => e.type === 'session.end');
  const last = events.at(-1);
  const out: string[] = ['# Rafael · Conversation Log', ''];
  if (start) {
    out.push(
      `- Session: ${start.sessionId}`,
      `- ผู้ใช้: ${start.user}`,
      `- Drive folder: ${start.folderName ? `${start.folderName} (${start.folderId})` : start.folderId}`,
      `- Pack: ${start.pack ? `${start.pack.files} ไฟล์ · ${start.pack.tokens.toLocaleString('en-US')} tokens` : 'ยังไม่พร้อม'}`,
      `- เริ่ม: ${day(start.ts)} ${hms(start.ts)} (Asia/Bangkok)`,
      end ? `- จบ: ${day(end.ts)} ${hms(end.ts)}` : `- ยังไม่จบ: log ถึง ${last ? hms(last.ts) : '-'}`,
    );
  }
  out.push('', '## Timeline', '');
  let pausedAt: string | undefined;
  for (const e of events) {
    switch (e.type) {
      case 'transcript':
        out.push(`**${hms(e.ts)}**${e.speaker ? ` ${e.speaker}:` : ''} ${oneLine(e.text)}`, '');
        break;
      case 'ask':
        out.push(`**${hms(e.ts)}** พิมพ์ถาม: ${oneLine(e.text)}`, '');
        break;
      case 'cue':
        out.push(
          `> **${hms(e.ts)} Cue** · ${oneLine(e.question)} _(${(e.latencyMs / 1000).toFixed(1)} วิ)_`,
        );
        for (const b of e.bullets) out.push(`> - ${oneLine(stripInlineAnchor(b, e.sources))}`);
        if (e.sources.length)
          out.push(`> ที่มา: ${e.sources.map((x) => `${x.file} › ${x.locator}`).join(', ')}`);
        out.push('');
        break;
      case 'not_found':
        out.push(
          `> **${hms(e.ts)} ${e.failed ? 'ตอบไม่ได้ (ระบบขัดข้อง)' : 'ไม่พบใน source'}** · ${oneLine(e.question)}`,
          '',
        );
        break;
      case 'pause':
        pausedAt = e.ts;
        break;
      case 'resume':
        if (pausedAt) out.push(`_paused ${hm(pausedAt)}–${hm(e.ts)}_`, '');
        pausedAt = undefined;
        break;
    }
  }
  // still paused when the log was taken: close the marker at the end / last event
  if (pausedAt) out.push(`_paused ${hm(pausedAt)}–${end ? hm(end.ts) : 'ตอนนี้'}_`, '');
  // a model failure is not a gap in the pack: timeline only
  const nf = events.filter((e): e is Of<'not_found'> => e.type === 'not_found' && !e.failed);
  out.push(`## ไม่พบใน source (${nf.length})`, '');
  if (!nf.length) out.push('ไม่มี', '');
  for (const e of nf) out.push(`- ${hm(e.ts)} ${oneLine(e.question)}`);
  return `${out.join('\n').trimEnd()}\n`;
}

/** Save as a file from memory (Blob URL); nothing is written anywhere else. */
export function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadLog(events: LogEvent[], ext: 'md' | 'json') {
  saveFile(
    logFileName(events, ext),
    ext === 'md' ? logToMarkdown(events) : logToJson(events),
    ext === 'md' ? 'text/markdown' : 'application/json',
  );
}
