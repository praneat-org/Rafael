// PDF = our Markdown -> printable HTML -> Chrome "Save as PDF". Thai renders with system fonts;
// no PDF library, nothing leaves the browser (D11).
// ponytail: handles only the Markdown we write (headings, lists, quotes, tables, **b**, _i_, \-escapes).

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(t: string): string {
  const keep: string[] = [];
  // escaped chars (\* \_ ...) are literal: park them before bold / italic run
  const s = esc(t.replace(/\\([\\`*_[\]<>#|~&])/g, (_, c) => `\uE000${keep.push(c) - 1}\uE000`))
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_(.+?)_(?=$|[\s).,])/g, '$1<i>$2</i>');
  return s.replace(/\uE000(\d+)\uE000/g, (_, i) => esc(keep[Number(i)] ?? ''));
}

export function mdToHtml(md: string): string {
  const out: string[] = [];
  let list = false;
  let quote = false;
  let table = false;
  const close = () => {
    if (list) out.push('</ul>');
    if (table) out.push('</table>');
    list = table = false;
  };
  for (const raw of md.split('\n')) {
    const q = raw.startsWith('>');
    if (q !== quote) {
      close();
      out.push(q ? '<blockquote>' : '</blockquote>');
      quote = q;
    }
    const line = q ? raw.replace(/^>\s?/, '') : raw;
    const [, hashes, heading] = /^(#{1,3}) (.*)$/.exec(line) ?? [];
    if (line.startsWith('- ')) {
      if (!list) {
        close();
        out.push('<ul>');
        list = true;
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (line.startsWith('|')) {
      if (/^\|(\s*--+\s*\|)+$/.test(line)) continue; // header separator row (not the "| - |" placeholder)
      const cells = line.replace(/^\||\|$/g, '').split('|');
      const tag = table ? 'td' : 'th';
      if (!table) {
        close();
        out.push('<table>');
        table = true;
      }
      out.push(`<tr>${cells.map((c) => `<${tag}>${inline(c.trim())}</${tag}>`).join('')}</tr>`);
    } else {
      close();
      if (hashes && heading) out.push(`<h${hashes.length}>${inline(heading)}</h${hashes.length}>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  if (quote) out.push('</blockquote>');
  return out.join('\n');
}

const CSS = `body{font:14px/1.6 "Sarabun","Noto Sans Thai","Leelawadee UI",Tahoma,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:22px;margin:0 0 12px}h2{font-size:17px;margin:20px 0 6px;border-bottom:1px solid #ccc}h3{font-size:15px;margin:14px 0 4px}
p,ul{margin:4px 0}blockquote{margin:6px 0;padding:4px 12px;border-left:3px solid #888;background:#f4f4f4;break-inside:avoid}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#eee}@page{margin:14mm}`;

export const pdfHtml = (title: string, md: string) =>
  `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${mdToHtml(md)}</body></html>`;

/** Opens the document in a new tab and shows the print dialog ("Save as PDF"); tab closes after. */
export function savePdf(name: string, md: string) {
  const url = URL.createObjectURL(
    new Blob([pdfHtml(name.replace(/\.\w+$/, ''), md)], { type: 'text/html;charset=utf-8' }),
  );
  // a blob: page has the extension's CSP (no inline script), so the panel drives print()
  const w = window.open(url);
  if (!w) return URL.revokeObjectURL(url);
  w.addEventListener('load', () => {
    URL.revokeObjectURL(url);
    w.addEventListener('afterprint', () => w.close());
    w.print();
  });
}
