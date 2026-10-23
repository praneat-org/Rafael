// Protocol v1 — single source of truth for client <-> server messages.
// Only zod + local files: no React / chrome.* / DOM / Node imports.
import { z } from 'zod';

export * from './audio';

export const PROTOCOL_VERSION = 1;

export const ErrorCode = z.enum([
  'BAD_MESSAGE',
  'VERSION_MISMATCH',
  'UNAUTHORIZED',
  'PACK_TOO_LARGE',
  'SESSION_NOT_FOUND',
  'STT_UNAVAILABLE',
  'LLM_UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

const v = z.literal(PROTOCOL_VERSION);

// ---- Client -> Server: strict objects. Server-owned values (sessionId, cueId,
// latency, email, ...) are never accepted from the client.
export const ClientMessage = z.discriminatedUnion('t', [
  /**
   * Must be the first message on a connection (D19). The token never goes in the
   * URL (request logs, D11). Ordering is enforced by the server (BE-85/BE-87).
   */
  z.strictObject({ v, t: z.literal('hello'), accessToken: z.string().min(1).max(4096) }),
  z.strictObject({
    v,
    t: z.literal('session.start'),
    packId: z.string().min(1).max(256),
    resumeToken: z.string().min(1).max(256).optional(),
  }),
  z.strictObject({ v, t: z.literal('ask'), text: z.string().min(1).max(2000) }),
  z.strictObject({ v, t: z.literal('pause') }),
  z.strictObject({ v, t: z.literal('resume') }),
  z.strictObject({ v, t: z.literal('session.end') }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---- Server -> Client
export const Source = z.object({
  file: z.string().min(1),
  fileId: z.string().min(1),
  locator: z.string().min(1), // e.g. "หน้า 14", "slide 3", "tab Pricing"
});
export type Source = z.infer<typeof Source>;

const PackFile = z.object({ file: z.string().min(1), fileId: z.string().min(1) });

export const ServerMessage = z.discriminatedUnion('t', [
  z.object({
    v,
    t: z.literal('session.ready'),
    sessionId: z.string().min(1),
    resumeToken: z.string().min(1),
  }),
  z.object({
    v,
    t: z.literal('transcript'),
    segId: z.string().min(1),
    text: z.string(),
    final: z.boolean(),
    speaker: z.string().optional(),
  }),
  z
    .object({
      v,
      t: z.literal('cue'),
      cueId: z.string().min(1),
      question: z.string(),
      bullets: z.array(z.string()).max(3),
      sources: z.array(Source),
      latencyMs: z.number().int().nonnegative(),
      partial: z.boolean(),
      notFound: z.boolean(),
    })
    // D10: a cue that claims an answer must cite at least one source.
    .refine((c) => c.notFound || c.sources.length >= 1, {
      message: 'cue with notFound=false requires sources',
      path: ['sources'],
    }),
  z.object({
    v,
    t: z.literal('pack.status'),
    state: z.enum(['loading', 'ready', 'error']),
    files: z.array(PackFile),
    tokens: z.number().int().nonnegative(),
    unreadable: z.array(PackFile),
  }),
  z.object({ v, t: z.literal('error'), code: ErrorCode }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

// ---- Parse helpers: take raw text, never throw, never echo the payload (D11).
export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode } };

function parse<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: { code: 'BAD_MESSAGE' } };
  }
  if (typeof json === 'object' && json !== null && 'v' in json && json.v !== PROTOCOL_VERSION) {
    return { ok: false, error: { code: 'VERSION_MISMATCH' } };
  }
  const r = schema.safeParse(json);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: { code: 'BAD_MESSAGE' } };
}

export const parseClientMessage = (raw: string): ParseResult<ClientMessage> =>
  parse(ClientMessage, raw);
export const parseServerMessage = (raw: string): ParseResult<ServerMessage> =>
  parse(ServerMessage, raw);

// Fixtures for MockTransport (placeholder text only, not real deal content).
export const exampleServerMessages: ServerMessage[] = [
  { v: 1, t: 'session.ready', sessionId: 'example-session', resumeToken: 'example-resume-token' },
  {
    v: 1,
    t: 'pack.status',
    state: 'ready',
    files: [{ file: 'example.pdf', fileId: 'file-1' }],
    tokens: 1200,
    unreadable: [],
  },
  {
    v: 1,
    t: 'transcript',
    segId: 'seg-1',
    text: 'example question?',
    final: true,
    speaker: 'customer',
  },
  {
    v: 1,
    t: 'cue',
    cueId: 'cue-1',
    question: 'example question?',
    bullets: ['example answer [example.pdf › หน้า 1]'],
    sources: [{ file: 'example.pdf', fileId: 'file-1', locator: 'หน้า 1' }],
    latencyMs: 2400,
    partial: false,
    notFound: false,
  },
  {
    v: 1,
    t: 'cue',
    cueId: 'cue-2',
    question: 'out of pack question?',
    bullets: [],
    sources: [],
    latencyMs: 2100,
    partial: false,
    notFound: true,
  },
  { v: 1, t: 'error', code: 'SESSION_NOT_FOUND' },
];
