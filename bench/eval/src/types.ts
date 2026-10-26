export const NOT_IN_SOURCE = 'ไม่มีใน source';

/** One row of BE-68's answer sheet. anchor === null means "ไม่มีใน source". */
export interface KeyRow {
  question: string;
  answer: string;
  anchor: string | null;
}

export interface Cue {
  notFound: boolean;
  bullets: string[];
  sources: string[];
}

/** Protocol `Source` (structural, no dep) -> eval anchor, so BE-99 can feed cues directly. */
export const sourceAnchor = (s: { file: string; locator: string }) => `[${s.file} › ${s.locator}]`;

export const STAGES = ['stt', 'detector', 'answererFirstToken', 'total'] as const;
export type Stage = (typeof STAGES)[number];

export interface Usage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export interface RunResult {
  cue: Cue | null; // null = no cue appeared
  timings: Record<Stage, number>; // ms
  usage: Usage;
}

/** Runner seam: BE-99/BE-89 will provide a real one that replays audio. */
export type Runner = (inputs: { question: string }[]) => Promise<RunResult[]>;

export type Outcome = 'correct' | 'wrong' | 'out-of-source' | 'not-found-correct' | 'missed';
