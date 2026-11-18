import type { MeetingSummary } from '@rafael/protocol';

// Meeting summary -> Markdown draft the user edits before copy / export (template from the card).
export const UNSET = '⚠ ยังไม่ระบุ';

const dt = (ts: string) => `${ts.slice(0, 10)} ${ts.slice(11, 16)}`;

export function summaryToMarkdown(
  s: MeetingSummary,
  meta: { subject: string; attendees: string; startTs: string; endTs: string },
): string {
  const out: string[] = [
    `# ${meta.subject.trim() || 'สรุปการประชุม'}`,
    '',
    '## 1. ข้อมูลพื้นฐาน',
    `- หัวข้อการประชุม: ${meta.subject.trim() || UNSET}`,
    `- วันที่ / เวลา: ${dt(meta.startTs)}–${meta.endTs.slice(11, 16)} (Asia/Bangkok)`,
    // never guessed from the transcript
    `- ผู้เข้าร่วมประชุม: ${meta.attendees.trim() || 'ยังไม่ระบุ'}`,
    '',
    '## 2. บทสรุปผู้บริหาร',
    s.tldr.trim() || '-',
    '',
    '## 3. ข้อสรุปและการตัดสินใจสำคัญ',
  ];
  if (!s.topics.length) out.push('', '-');
  for (const t of s.topics) {
    out.push('', `### ${t.title}`);
    if (t.discussed.length) out.push('ประเด็นที่หารือ', ...t.discussed.map((d) => `- ${d}`));
    if (t.decisions.length)
      out.push(
        'มติที่ประชุม',
        ...t.decisions.map(
          (d) => `- ${d.text}${d.reason ? ` (เหตุผล: ${d.reason})` : ''} [${d.at}]`,
        ),
      );
    if (t.parking.length) out.push('ยังไม่ได้ข้อสรุป', ...t.parking.map((p) => `- ${p.text} [${p.at}]`));
  }
  out.push('', '### Parking Lot: ต้อง follow-up (ไม่พบใน source)');
  if (!s.notFound.length) out.push('- ไม่มี');
  for (const n of s.notFound) out.push(`- ${n.text} [${n.at}]`);
  out.push(
    '',
    '## 4. แผนการดำเนินงานต่อ',
    '',
    '| What | Who | When | อ้างอิง |',
    '| -- | -- | -- | -- |',
  );
  if (!s.actions.length) out.push('| - | - | - | - |');
  const cell = (t: string) => t.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');
  for (const a of s.actions)
    out.push(
      `| ${cell(a.what)} | ${cell(a.who ?? UNSET)} | ${cell(a.when ?? UNSET)} | [${a.at}] |`,
    );
  return `${out.join('\n')}\n`;
}

/** how many blanks the user still has to fill */
export const unsetCount = (md: string) => md.split(UNSET).length - 1;
