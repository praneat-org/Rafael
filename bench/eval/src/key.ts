import { type KeyRow, NOT_IN_SOURCE } from './types.js';

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** CSV header: question,answer,anchor. anchor = "[file › page]" or "ไม่มีใน source". */
export function parseKey(csv: string): KeyRow[] {
  const [header, ...rows] = parseRows(csv.replace(/^﻿/, ''));
  const cols = (header ?? []).map((h) => h.trim().toLowerCase());
  const idx = (n: string) => {
    const i = cols.indexOf(n);
    if (i < 0) throw new Error(`answer key: missing column "${n}"`);
    return i;
  };
  const [q, a, n] = [idx('question'), idx('answer'), idx('anchor')];
  return rows.map((r, i) => {
    const question = r[q]?.trim() ?? '';
    const anchor = r[n]?.trim() ?? '';
    if (!question) throw new Error(`answer key: row ${i + 2} has empty question`);
    if (!anchor) throw new Error(`answer key: row ${i + 2} has empty anchor`);
    return {
      question,
      answer: r[a]?.trim() ?? '',
      anchor: anchor === NOT_IN_SOURCE ? null : anchor,
    };
  });
}
