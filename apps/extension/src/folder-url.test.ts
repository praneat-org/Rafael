import { expect, test } from 'vitest';
import { parseFolderId } from './folder-url';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWx';

test('accepts folder urls (plain, /u/N/, query, trailing slash)', () => {
  for (const u of [
    `https://drive.google.com/drive/folders/${ID}`,
    `https://drive.google.com/drive/u/1/folders/${ID}?usp=sharing`,
    `  https://drive.google.com/drive/folders/${ID}/ `,
  ])
    expect(parseFolderId(u)).toBe(ID);
});

test('rejects files, docs, other hosts, bare ids, junk', () => {
  for (const u of [
    `https://drive.google.com/file/d/${ID}/view`,
    `https://docs.google.com/document/d/${ID}/edit`,
    `https://drive.google.com/open?id=${ID}`,
    `https://evil.com/drive/folders/${ID}`,
    `http://drive.google.com/drive/folders/${ID}`,
    `https://drive.google.com/drive/folders/short`,
    ID,
    '',
  ])
    expect(parseFolderId(u), u).toBeNull();
});

test('path is anchored at both ends and the segment is literally "folders"', () => {
  for (const p of [
    `/x/drive/folders/${ID}`, // no ^
    `/drive/folders/${ID}/extra`, // no $
    `/drive/folders/${ID}x/y`,
    `/drive/files/${ID}`, // [a-z]+ widening
    `/drive/shared/${ID}`,
    `/drive/u/1/files/${ID}`,
  ])
    expect(parseFolderId(`https://drive.google.com${p}`), p).toBeNull();
});
