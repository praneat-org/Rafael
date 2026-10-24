import { expect, test, vi } from 'vitest';

// spy on every pdf.js document so tests can assert it is released; failExtract forces the parse-error path
const pdfSpy = vi.hoisted(() => ({
  destroys: [] as ReturnType<typeof vi.fn>[],
  failExtract: false,
}));
vi.mock('unpdf', async (orig) => {
  const real = await orig<typeof import('unpdf')>();
  return {
    ...real,
    getDocumentProxy: async (...a: Parameters<typeof real.getDocumentProxy>) => {
      const doc = await real.getDocumentProxy(...a);
      const destroy = vi.fn(doc.loadingTask.destroy.bind(doc.loadingTask));
      doc.loadingTask.destroy = destroy;
      pdfSpy.destroys.push(destroy);
      return doc;
    },
    extractText: (...a: Parameters<typeof real.extractText>) =>
      pdfSpy.failExtract ? Promise.reject(new Error('boom')) : real.extractText(...a),
  };
});

import { createDriveProvider, type DriveFile, parseFolderId } from './drive.js';

// Synthetic fixtures in the shape of the real API responses — no customer data.
const j = (o: unknown) =>
  new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });

function fakeFetch(routes: Record<string, (u: URL) => Response>) {
  const calls: URL[] = [];
  const headers: (string | null)[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push(u);
    headers.push(new Headers(init?.headers).get('authorization'));
    const h = Object.entries(routes).find(([k]) => u.href.includes(k));
    return h ? h[1](u) : new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { fn, calls, headers };
}
const file = (mimeType: string, size?: number): DriveFile => ({
  fileId: 'f1',
  name: 'n',
  mimeType,
  size,
});

// minimal valid PDF; each page string is drawn as text ('' = blank page, like a scan)
function pdf(pages: string[]): Uint8Array<ArrayBuffer> {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push(
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  );
  pages.forEach((t, i) => {
    const body = t ? `BT /F1 12 Tf 20 100 Td (${t}) Tj ET` : '';
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objs.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const off: number[] = [];
  objs.forEach((o, i) => {
    off.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new TextEncoder().encode(out);
}

test('parseFolderId accepts id, folder url, open?id url; rejects injection', () => {
  expect(parseFolderId('abc_123-X')).toBe('abc_123-X');
  expect(parseFolderId('https://drive.google.com/drive/folders/abc123?usp=sharing')).toBe('abc123');
  expect(parseFolderId('https://drive.google.com/open?id=abc123')).toBe('abc123');
  expect(() => parseFolderId("x' or '1'='1")).toThrow();
});

test('listFolder paginates, sends Shared Drive params and the user token', async () => {
  const { fn, calls, headers } = fakeFetch({
    '/drive/v3/files': (u) =>
      u.searchParams.get('pageToken')
        ? j({ files: [{ id: 'b', name: 'B', mimeType: 'application/pdf', size: '10' }] })
        : j({
            nextPageToken: 'p2',
            files: [{ id: 'a', name: 'A', mimeType: 'x', modifiedTime: 't' }],
          }),
  });
  const files = await createDriveProvider({ accessToken: 'tok', fetch: fn }).listFolder(
    'https://drive.google.com/drive/folders/F1',
  );
  expect(files.map((x) => x.fileId)).toEqual(['a', 'b']);
  expect(files[1]!.size).toBe(10);
  expect(calls).toHaveLength(2);
  for (const u of calls) {
    expect(u.searchParams.get('supportsAllDrives')).toBe('true');
    expect(u.searchParams.get('includeItemsFromAllDrives')).toBe('true');
    expect(u.searchParams.get('q')).toContain("'F1' in parents and trashed=false");
  }
  expect(headers).toEqual(['Bearer tok', 'Bearer tok']);
});

test('Docs export as markdown', async () => {
  const { fn, calls } = fakeFetch({ '/export': () => new Response('# Title\nbody') });
  const r = await createDriveProvider({ accessToken: 't', fetch: fn }).readFile(
    file('application/vnd.google-apps.document'),
  );
  expect(r).toEqual({ chunks: [{ locator: 'เอกสาร', text: '# Title\nbody' }] });
  expect(calls[0]!.searchParams.get('mimeType')).toBe('text/markdown');
  expect(calls[0]!.searchParams.get('supportsAllDrives')).toBe('true');
});

test('Sheets -> one CSV chunk per tab, quoting handled, empty tab skipped', async () => {
  const { fn, calls } = fakeFetch({
    batchGet: () =>
      j({
        valueRanges: [
          {
            values: [
              ['a', 'b,c'],
              ['1', 'say "hi"'],
            ],
          },
          {},
          { values: [['x']] },
        ],
      }),
    '/spreadsheets/f1': () =>
      j({
        sheets: [
          { properties: { title: 'Price', sheetType: 'GRID' } },
          { properties: { title: 'Chart', sheetType: 'OBJECT' } },
          { properties: { title: 'Empty', sheetType: 'GRID' } },
          { properties: { title: "Bob's", sheetType: 'GRID' } },
        ],
      }),
  });
  const r = await createDriveProvider({ accessToken: 't', fetch: fn }).readFile(
    file('application/vnd.google-apps.spreadsheet'),
  );
  expect(r).toEqual({
    chunks: [
      { locator: 'tab Price', text: 'a,"b,c"\n1,"say ""hi"""' },
      { locator: "tab Bob's", text: 'x' },
    ],
  });
  expect(calls.at(-1)!.searchParams.getAll('ranges')).toEqual(["'Price'", "'Empty'", "'Bob''s'"]);
});

test('Slides -> one chunk per slide (shapes, tables, groups); blank slide skipped but numbering kept', async () => {
  const t = (s: string) => ({ text: { textElements: [{ textRun: { content: s } }] } });
  const { fn } = fakeFetch({
    '/presentations/f1': () =>
      j({
        slides: [
          {
            pageElements: [
              { shape: t('Hello\n') },
              { elementGroup: { children: [{ shape: t('Grouped') }] } },
            ],
          },
          { pageElements: [] },
          { pageElements: [{ table: { tableRows: [{ tableCells: [t('A'), t('B')] }] } }] },
        ],
      }),
  });
  const r = await createDriveProvider({ accessToken: 't', fetch: fn }).readFile(
    file('application/vnd.google-apps.presentation'),
  );
  expect(r).toEqual({
    chunks: [
      { locator: 'slide 1', text: 'Hello\n\nGrouped' },
      { locator: 'slide 3', text: 'A | B' },
    ],
  });
});

test('PDF -> text per page; blank pages skipped', async () => {
  const { fn, calls } = fakeFetch({
    'alt=media': () => new Response(pdf(['Alpha page', '', 'Gamma page'])),
  });
  const r = await createDriveProvider({ accessToken: 't', fetch: fn }).readFile(
    file('application/pdf', 100),
  );
  expect(r).toEqual({
    chunks: [
      { locator: 'หน้า 1', text: 'Alpha page' },
      { locator: 'หน้า 3', text: 'Gamma page' },
    ],
  });
  expect(calls[0]!.searchParams.get('supportsAllDrives')).toBe('true');
});

test('scanned PDF (no text layer) -> unreadable', async () => {
  const { fn } = fakeFetch({ 'alt=media': () => new Response(pdf(['', ''])) });
  const r = await createDriveProvider({ accessToken: 't', fetch: fn }).readFile(
    file('application/pdf'),
  );
  expect(r).toEqual({ unreadable: 'no text layer (scanned?)' });
});

test('too large, unsupported mime, http error, corrupt pdf -> unreadable with reason, no throw', async () => {
  const { fn } = fakeFetch({
    '/export': () => new Response('secret body', { status: 403 }),
    'alt=media': () => new Response('not a pdf'),
  });
  const p = createDriveProvider({ accessToken: 't', fetch: fn, maxFileBytes: 50 });
  expect(await p.readFile(file('application/pdf', 51))).toEqual({ unreadable: 'too large' });
  expect(await p.readFile(file('image/png'))).toEqual({ unreadable: 'unsupported mime image/png' });
  expect(await p.readFile(file('application/vnd.google-apps.document'))).toEqual({
    unreadable: 'google api 403',
  });
  expect(await p.readFile(file('application/pdf', 9))).toEqual({ unreadable: 'read failed' });
});

test('PDF with no size in listing is capped while downloading', async () => {
  const { fn } = fakeFetch({ 'alt=media': () => new Response(pdf(['Alpha page'])) });
  const p = createDriveProvider({ accessToken: 't', fetch: fn, maxFileBytes: 100 });
  expect(await p.readFile(file('application/pdf'))).toEqual({ unreadable: 'too large' });
});

test('pdf.js document is destroyed on success, parse error, and too-many-pages', async () => {
  const { fn } = fakeFetch({ 'alt=media': () => new Response(pdf(['A', 'B'])) });
  const read = (maxPdfPages?: number) =>
    createDriveProvider({ accessToken: 't', fetch: fn, maxPdfPages }).readFile(
      file('application/pdf'),
    );
  pdfSpy.destroys.length = 0;
  expect(await read()).toHaveProperty('chunks');
  expect(await read(1)).toEqual({ unreadable: 'too many pages' });
  pdfSpy.failExtract = true;
  expect(await read()).toEqual({ unreadable: 'read failed' });
  pdfSpy.failExtract = false;
  expect(pdfSpy.destroys).toHaveLength(3);
  for (const d of pdfSpy.destroys) expect(d).toHaveBeenCalledTimes(1);
});

test('Docs / Sheets / Slides bodies are capped too (no size in Drive listing)', async () => {
  const big = 'x'.repeat(200);
  const { fn } = fakeFetch({
    '/export': () => new Response(big),
    '/spreadsheets/f1': () => j({ sheets: [{ properties: { title: big, sheetType: 'GRID' } }] }),
    '/presentations/f1': () =>
      j({
        slides: [
          {
            pageElements: [{ shape: { text: { textElements: [{ textRun: { content: big } }] } } }],
          },
        ],
      }),
  });
  const p = createDriveProvider({ accessToken: 't', fetch: fn, maxFileBytes: 100 });
  for (const m of ['document', 'spreadsheet', 'presentation'])
    expect(await p.readFile(file(`application/vnd.google-apps.${m}`))).toEqual({
      unreadable: 'too large',
    });
});
