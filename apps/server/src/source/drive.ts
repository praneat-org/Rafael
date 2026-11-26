import { unzipSync } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';
import { log } from '../log.js';

// D11: file content is held in memory only and never logged — log() gets ids / counts / status codes.
export interface DriveFile {
  fileId: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
}
export interface Chunk {
  locator: string; // anchor page part of `[file › page]`, e.g. `slide 3`, `หน้า 2`, `tab Pricing`
  text: string;
}
export type ReadResult = { chunks: Chunk[] } | { unreadable: string };

export interface SourceProvider {
  listFolder(folderIdOrUrl: string): Promise<DriveFile[]>;
  readFile(file: DriveFile): Promise<ReadResult>;
  /** folder display name for the audit line (BE-111); rejects on any failure */
  folderName?(folderIdOrUrl: string): Promise<string>;
}

export interface DriveOptions {
  accessToken: string; // user's drive.readonly token from the session (D13)
  fetch?: typeof fetch; // injectable for tests
  maxFileBytes?: number; // cap on every response body (list, export, API JSON, PDF); larger => unreadable
  requestTimeoutMs?: number; // deadline per request, covering fetch + body read (default 30s)
  maxPdfPages?: number; // bounds pdf.js parse work; more pages => unreadable
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const SLIDES = 'https://slides.googleapis.com/v1/presentations';
const M = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
// plain uploads read as-is; legacy binary .doc/.xls/.ppt stay unsupported (open in Google format instead)
const PLAIN = new Set(['text/plain', 'text/markdown', 'text/x-markdown', 'text/csv']);

export function parseFolderId(input: string): string {
  const s = input.trim();
  const id = /\/folders\/([\w-]+)/.exec(s)?.[1] ?? /[?&]id=([\w-]+)/.exec(s)?.[1] ?? s;
  if (!/^[\w-]+$/.test(id)) throw new Error('invalid folder id or url');
  return id;
}

const csv = (rows: unknown[][]) =>
  rows
    .map((r) =>
      r
        .map((c) =>
          /[",\n\r]/.test(String(c)) ? `"${String(c).replaceAll('"', '""')}"` : String(c),
        )
        .join(','),
    )
    .join('\n');

type TextBox = { textElements?: { textRun?: { content?: string } }[] };
type SlideEl = {
  shape?: { text?: TextBox };
  table?: { tableRows?: { tableCells?: { text?: TextBox }[] }[] };
  elementGroup?: { children?: SlideEl[] };
};
const runs = (t?: TextBox) => (t?.textElements ?? []).map((x) => x.textRun?.content ?? '').join('');
const slideText = (els: SlideEl[] = []): string =>
  els
    .map((e) =>
      e.shape
        ? runs(e.shape.text)
        : e.table
          ? (e.table.tableRows ?? [])
              .map((r) => (r.tableCells ?? []).map((c) => runs(c.text).trim()).join(' | '))
              .join('\n')
          : slideText(e.elementGroup?.children),
    )
    .join('\n')
    .trim();

// --- OOXML (.docx/.xlsx/.pptx): a zip of XML parts. Regex over the few tags we need, no XML lib.
type Zip = Record<string, Uint8Array>;
const ENT: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};
const unxml = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENT[e] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
    return n <= 0x10ffff ? String.fromCodePoint(n) : m; // out-of-range ref: keep as-is, don't throw
  });
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const part = (z: Zip, path: string) => (z[path] ? new TextDecoder().decode(z[path]) : '');
// text of every <tag>…</tag> run inside `xml` (w:t / a:t / t); <w:tab/> = tab, <w:br/> / <a:br/> = newline
const runsOf = (xml: string, tag: string) =>
  [
    ...xml.matchAll(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>|<\\w+:(tab|br)(?:\\s[^>]*)?/>`, 'g'),
    ),
  ]
    .map((m) => (m[2] === 'tab' ? '\t' : m[2] === 'br' ? '\n' : unxml(m[1]!)))
    .join('');
// one line per paragraph element (w:p / a:p); empty paragraphs dropped
const paras = (xml: string, p: string, t: string) =>
  [...xml.matchAll(new RegExp(`<${p}[\\s>][\\s\\S]*?</${p}>`, 'g'))]
    .map((m) => runsOf(m[0], t).trim())
    .filter(Boolean)
    .join('\n');
// relationship id -> zip path, resolved against the part's folder (Target may be relative or /absolute)
function rels(z: Zip, partPath: string): Map<string, string> {
  const dir = partPath.slice(0, partPath.lastIndexOf('/') + 1);
  const xml = part(z, `${dir}_rels/${partPath.slice(dir.length)}.rels`);
  const out = new Map<string, string>();
  for (const [tag] of xml.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(tag, 'Id');
    const target = attr(tag, 'Target');
    if (id && target) out.set(id, new URL(target, `file:///${dir}`).pathname.slice(1));
  }
  return out;
}
const colIndex = (ref: string) =>
  [...(/^[A-Z]+/.exec(ref)?.[0] ?? 'A')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function docxChunks(z: Zip): Chunk[] {
  // ponytail: one chunk like Google Docs; tables flatten to one line per cell paragraph
  const text = paras(part(z, 'word/document.xml'), 'w:p', 'w:t');
  return text ? [{ locator: 'เอกสาร', text }] : [];
}

function pptxChunks(z: Zip): Chunk[] {
  // slide order comes from presentation.xml (file names keep their original number after reordering)
  const r = rels(z, 'ppt/presentation.xml');
  const ids = [...part(z, 'ppt/presentation.xml').matchAll(/<p:sldId\s[^>]*>/g)].map(
    ([tag]) => attr(tag, 'r:id') ?? '',
  );
  return ids.flatMap((id, i) => {
    const text = paras(part(z, r.get(id) ?? ''), 'a:p', 'a:t');
    return text ? [{ locator: `slide ${i + 1}`, text }] : [];
  });
}

function xlsxChunks(z: Zip): Chunk[] {
  const shared = [...part(z, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    runsOf(m[1]!, 't'),
  );
  const r = rels(z, 'xl/workbook.xml');
  return [...part(z, 'xl/workbook.xml').matchAll(/<sheet\s[^>]*>/g)].flatMap(([tag]) => {
    const name = unxml(attr(tag, 'name') ?? '');
    const xml = part(z, r.get(attr(tag, 'r:id') ?? '') ?? '');
    const rows: string[][] = [];
    for (const [row] of xml.matchAll(/<row[\s>][\s\S]*?<\/row>/g)) {
      const cells: string[] = [];
      let col = -1;
      for (const m of row.matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const [, a = '', body = ''] = m;
        const t = attr(a, 't');
        const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        // ponytail: dates stay as serial numbers (needs styles.xml numFmt lookup to render)
        const val =
          t === 's'
            ? (shared[Number(v)] ?? '')
            : t === 'inlineStr'
              ? runsOf(body, 't')
              : unxml(v ?? '');
        const r = attr(a, 'r');
        col = r ? colIndex(r) : col + 1; // `r` is optional: no ref = the next column
        if (val) cells[col] = val;
      }
      if (cells.length) rows.push(Array.from(cells, (c) => c ?? ''));
    }
    return rows.length ? [{ locator: `tab ${name}`, text: csv(rows) }] : [];
  });
}

// stream the body and stop at the cap, so a file with no `size` can't be fully buffered first
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const parts: Uint8Array[] = [];
  let n = 0;
  for await (const c of res.body ?? []) {
    n += c.length;
    if (n > max) return null; // leaving the loop cancels the stream
    parts.push(c);
  }
  return new Uint8Array(Buffer.concat(parts)); // pdf.js rejects Buffer subclass
}

export function createDriveProvider(opts: DriveOptions): SourceProvider {
  const f = opts.fetch ?? fetch;
  const maxBytes = opts.maxFileBytes ?? 20 * 1024 * 1024;
  const maxPages = opts.maxPdfPages ?? 500;
  const timeoutMs = opts.requestTimeoutMs ?? 30_000;

  // errors carry only the status — never the response body (may echo content / token)
  async function get(url: string, signal: AbortSignal): Promise<Response> {
    const res = await f(url, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
      signal,
    });
    if (!res.ok) throw new Error(`google api ${res.status}`);
    return res;
  }
  // every body is read through the byte cap (Docs/Sheets/Slides have no `size` to pre-check)
  // and under one deadline: the race also fires for a fetch / stream that ignores the signal
  const read = async (url: string, max: number) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const timedOut = new Promise<never>((_, rej) =>
      signal.addEventListener('abort', () => rej(new Error('timeout')), {
        once: true,
      }),
    );
    const b = await Promise.race([get(url, signal).then((r) => readCapped(r, max)), timedOut]);
    if (!b) throw new Error('too large');
    return b;
  };
  const text = async (url: string, max = maxBytes) =>
    new TextDecoder().decode(await read(url, max));
  const json = async <T>(url: string, max = maxBytes) => JSON.parse(await text(url, max)) as T;

  async function listFolder(folderIdOrUrl: string): Promise<DriveFile[]> {
    const id = parseFolderId(folderIdOrUrl);
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const p = new URLSearchParams({
        q: `'${id}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
        pageSize: '1000',
        orderBy: 'name',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) p.set('pageToken', pageToken);
      const r = await json<{
        nextPageToken?: string;
        files?: Record<string, string>[];
      }>(`${DRIVE}/files?${p}`);
      for (const x of r.files ?? [])
        out.push({
          fileId: x.id!,
          name: x.name!,
          mimeType: x.mimeType!,
          size: x.size ? Number(x.size) : undefined,
          modifiedTime: x.modifiedTime,
        });
      pageToken = r.nextPageToken;
    } while (pageToken);
    log('source.list', { count: out.length });
    return out;
  }

  async function folderName(folderIdOrUrl: string): Promise<string> {
    const p = new URLSearchParams({
      fields: 'name',
      supportsAllDrives: 'true',
    });
    const r = await json<{ name?: string }>(
      `${DRIVE}/files/${parseFolderId(folderIdOrUrl)}?${p}`,
      64 * 1024,
    );
    return r.name ?? '';
  }

  async function convert(file: DriveFile): Promise<ReadResult> {
    const id = encodeURIComponent(file.fileId);
    // raw upload bytes; null when the listing already says it is over the cap
    const media = async () =>
      file.size !== undefined && file.size > maxBytes
        ? null
        : read(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, maxBytes);
    switch (file.mimeType) {
      case M.doc: {
        const p = new URLSearchParams({
          mimeType: 'text/markdown',
          supportsAllDrives: 'true',
        });
        // ponytail: Docs have no pages — one chunk; split by heading when packs need finer anchors
        const md = await text(`${DRIVE}/files/${id}/export?${p}`);
        return md.trim() ? { chunks: [{ locator: 'เอกสาร', text: md }] } : { unreadable: 'empty' };
      }
      case M.sheet: {
        const meta = await json<{
          sheets?: { properties: { title: string; sheetType?: string } }[];
        }>(`${SHEETS}/${id}?fields=sheets.properties(title,sheetType)`);
        // chart-only (OBJECT) sheets make batchGet 400 for the whole file — ask for GRID tabs only
        const titles = (meta.sheets ?? [])
          .filter((s) => (s.properties.sheetType ?? 'GRID') === 'GRID')
          .map((s) => s.properties.title);
        if (!titles.length) return { unreadable: 'empty' };
        const p = new URLSearchParams();
        for (const t of titles) p.append('ranges', `'${t.replaceAll("'", "''")}'`);
        const r = await json<{ valueRanges?: { values?: unknown[][] }[] }>(
          `${SHEETS}/${id}/values:batchGet?${p}`,
        );
        const chunks = titles.flatMap((t, i) => {
          const rows = r.valueRanges?.[i]?.values ?? [];
          return rows.length ? [{ locator: `tab ${t}`, text: csv(rows) }] : [];
        });
        return chunks.length ? { chunks } : { unreadable: 'empty' };
      }
      case M.slides: {
        // Drive export has no slide boundaries, so use Slides API (accepts drive.readonly)
        const r = await json<{ slides?: { pageElements?: SlideEl[] }[] }>(`${SLIDES}/${id}`);
        const chunks = (r.slides ?? []).flatMap((s, i) => {
          const text = slideText(s.pageElements);
          return text ? [{ locator: `slide ${i + 1}`, text }] : [];
        });
        return chunks.length ? { chunks } : { unreadable: 'empty' };
      }
      case M.pdf: {
        const buf = await media();
        if (!buf) return { unreadable: 'too large' };
        const doc = await getDocumentProxy(buf);
        let text: string[];
        try {
          if (doc.numPages > maxPages) return { unreadable: 'too many pages' };
          ({ text } = await extractText(doc, { mergePages: false }));
        } finally {
          await doc.loadingTask.destroy(); // release pdf.js worker / page memory on every path
        }
        const chunks = text.flatMap((t, i) =>
          t.trim() ? [{ locator: `หน้า ${i + 1}`, text: t.trim() }] : [],
        );
        return chunks.length ? { chunks } : { unreadable: 'no text layer (scanned?)' };
      }
      case M.docx:
      case M.xlsx:
      case M.pptx: {
        const buf = await media();
        if (!buf) return { unreadable: 'too large' };
        // zip bomb guard: inflate only the XML parts we parse, capped by their declared unpacked
        // size (fflate checks entries one by one, so nothing past the cap gets inflated)
        let unpacked = 0;
        const z = unzipSync(buf, {
          filter: (e) => {
            if (!/\.(xml|rels)$/.test(e.name) || /\/(media|embeddings)\//.test(e.name))
              return false;
            unpacked += e.originalSize;
            return unpacked <= maxBytes * 5;
          },
        });
        if (unpacked > maxBytes * 5) return { unreadable: 'too large' };
        const chunks =
          file.mimeType === M.docx
            ? docxChunks(z)
            : file.mimeType === M.pptx
              ? pptxChunks(z)
              : xlsxChunks(z);
        return chunks.length ? { chunks } : { unreadable: 'empty' };
      }
      default: {
        if (!PLAIN.has(file.mimeType)) return { unreadable: 'unsupported mime' };
        const buf = await media();
        if (!buf) return { unreadable: 'too large' };
        const t = new TextDecoder().decode(buf).trim();
        return t ? { chunks: [{ locator: 'เอกสาร', text: t }] } : { unreadable: 'empty' };
      }
    }
  }

  async function readFile(file: DriveFile): Promise<ReadResult> {
    let res: ReadResult;
    try {
      res = await convert(file);
    } catch (e) {
      // message is our own `google api <status>` or a parser error — never file text
      res = {
        unreadable:
          e instanceof Error &&
          (e.message.startsWith('google api') ||
            e.message === 'too large' ||
            e.message === 'timeout')
            ? e.message
            : 'read failed',
      };
    }
    log('source.read', {
      fileId: file.fileId,
      count: 'chunks' in res ? res.chunks.length : 0,
      ...('unreadable' in res ? { reason: res.unreadable } : {}), // our own constants / "google api <status>"
    });
    return res;
  }

  return { listFolder, readFile, folderName };
}
