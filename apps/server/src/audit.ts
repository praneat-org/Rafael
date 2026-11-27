import { z } from 'zod';
import { log } from './log.js';

// BE-97 / CAR-3824 AC5: who opened which folder, and when. Separate from the app log: one JSON line
// on stdout with `log: "rafael-audit"` (Cloud Logging sink/filter on jsonPayload.log, set up in BE-71).
// D11: strict allowlist per event. Never file names, content, transcript, questions or tokens.
// Only the folder name (AC) is user-supplied text; it is length-capped.
export const AUDIT_LOG_NAME = 'rafael-audit';

// email / sessionId are format-checked, not just strings: free text (e.g. Thai) cannot ride in them (D11)
const base = { email: z.email().max(320), sessionId: z.uuid() };
// Drive ids only (same shape parseFolderId accepts); client-supplied, so never free text
export const driveId = z
  .string()
  .regex(/^[\w-]+$/)
  .max(128);
const folder = {
  folderId: driveId,
  folderName: z.string().max(200),
  files: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
};
const ev = <T extends string, S extends z.ZodRawShape>(event: T, shape: S) =>
  z.strictObject({ event: z.literal(event), ...shape });

export const auditSchema = z.discriminatedUnion('event', [
  ev('session.start', { ...base, resumed: z.boolean(), folderId: driveId.optional() }),
  ev('pack.build', { ...base, ...folder }),
  ev('pack.refresh', { ...base, ...folder }),
  ev('session.end', base),
  ev('session.expired', base),
  // token never verified, so no email: only where it was denied
  ev('auth.denied', { source: z.enum(['ws', 'http']) }),
]);
export type AuditEvent = z.input<typeof auditSchema>;

export function audit(e: AuditEvent, now: () => Date = () => new Date()) {
  const r = auditSchema.safeParse(e);
  // invalid event is dropped, not logged: its values could be exactly what must not leak
  if (!r.success) return void log('audit.invalid', { code: 'AUDIT_INVALID' });
  console.log(
    JSON.stringify({
      severity: 'NOTICE',
      log: AUDIT_LOG_NAME,
      time: now().toISOString(),
      ...r.data,
    }),
  );
}
