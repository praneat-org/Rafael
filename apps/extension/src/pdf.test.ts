import { describe, expect, it } from 'vitest';
import { logToMarkdown } from './conversation-log';
import { mdToHtml, pdfHtml } from './pdf';

describe('mdToHtml', () => {
  it('renders the Markdown we write', () => {
    const html = mdToHtml(
      [
        '# หัวข้อ <x>',
        '- a **b**',
        '- \\*A12\\* _(1.2 วิ)_',
        '',
        '> **10:00 Cue** · q',
        '> - bullet',
        '',
        '| What | Who |',
        '| -- | -- |',
        '| ส่งราคา | ⚠ ยังไม่ระบุ |',
      ].join('\n'),
    );
    expect(html).toContain('<h1>หัวข้อ &lt;x&gt;</h1>');
    expect(html).toContain('<ul>\n<li>a <b>b</b></li>\n<li>*A12* <i>(1.2 วิ)</i></li>\n</ul>');
    expect(html).toContain(
      '<blockquote>\n<p><b>10:00 Cue</b> · q</p>\n<ul>\n<li>bullet</li>\n</ul>\n</blockquote>',
    );
    expect(html).toContain(
      '<tr><th>What</th><th>Who</th></tr>\n<tr><td>ส่งราคา</td><td>⚠ ยังไม่ระบุ</td></tr>\n</table>',
    );
    expect(html).not.toContain('--');
  });

  it('escapes the title and log content', () => {
    const md = logToMarkdown([
      { type: 'transcript', ts: '2026-11-20T10:00:01', text: '<script>alert(1)</script>' } as never,
    ]);
    const html = pdfHtml('a"<b>', md);
    expect(html).toContain('<title>a&quot;&lt;b&gt;</title>');
    expect(html).not.toContain('<script>');
  });
});
