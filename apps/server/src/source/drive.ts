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
};

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
    const res = await f(url, { headers: { Authorization: `Bearer ${opts.accessToken}` }, signal });
    if (!res.ok) throw new Error(`google api ${res.status}`);
    return res;
  }
  // every body is read through the byte cap (Docs/Sheets/Slides have no `size` to pre-check)
  // and under one deadline: the race also fires for a fetch / stream that ignores the signal
  const read = async (url: string, max: number) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const timedOut = new Promise<never>((_, rej) =>
      signal.addEventListener('abort', () => rej(new Error('timeout')), { once: true }),
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
      const r = await json<{ nextPageToken?: string; files?: Record<string, string>[] }>(
        `${DRIVE}/files?${p}`,
      );
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

  async function convert(file: DriveFile): Promise<ReadResult> {
    const id = encodeURIComponent(file.fileId);
    switch (file.mimeType) {
      case M.doc: {
        const p = new URLSearchParams({ mimeType: 'text/markdown', supportsAllDrives: 'true' });
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
        if (file.size !== undefined && file.size > maxBytes) return { unreadable: 'too large' };
        const buf = await read(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, maxBytes);
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
      default:
        return { unreadable: 'unsupported mime' };
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

  return { listFolder, readFile };
}
