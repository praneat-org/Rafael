import { PROTOCOL_VERSION, type ServerMessage } from '@rafael/protocol';
import { audit } from '../audit.js';
import { log } from '../log.js';
import type { Session, SessionStore } from '../session/store.js';
import { parseFolderId, type SourceProvider } from './drive.js';
import { type BuildOptions, buildPack, type Pack, PackStore, PackTooLargeError } from './pack.js';

export type PackServiceOptions = {
  /** SourceProvider bound to one user's Drive token (D13) */
  provider: (accessToken: string) => SourceProvider;
  build?: BuildOptions;
};
export type RefreshResult = 'ready' | 'superseded' | 'too-large' | 'error';

/** Session <-> pack glue (BE-108): build on start, refresh on demand, clear on end (D11). */
export function createPackService(
  opts: PackServiceOptions,
  store: Pick<SessionStore, 'onEnd' | 'get'>,
  onPack: (s: Session, pack: Pack) => void,
) {
  const packs = new PackStore();
  const senders = new Map<string, (m: ServerMessage) => void>();
  const running = new Set<string>();
  const tooLarge = new Map<string, { name: string; tokens: number }[]>(); // last PACK_TOO_LARGE list per session
  const gen = new Map<string, number>(); // latest build per session: older builds stay silent
  store.onEnd((s) => {
    packs.clear(s.id); // also cancels an in-flight build
    senders.delete(s.id);
    running.delete(s.id);
    gen.delete(s.id);
    tooLarge.delete(s.id);
  });

  const status = (s: Session, state: 'loading' | 'ready' | 'error', pack?: Pack) =>
    senders.get(s.id)?.({
      v: PROTOCOL_VERSION,
      t: 'pack.status',
      state,
      files: pack?.files ?? [],
      tokens: pack?.tokens ?? 0,
      unreadable: pack?.unreadable ?? [],
      ...(pack && {
        read: pack.files.length + pack.unreadable.length,
        total: pack.files.length + pack.unreadable.length,
      }),
    });

  async function refresh(
    s: Session,
    accessToken = s.accessToken,
    event: 'pack.build' | 'pack.refresh' = 'pack.build',
  ): Promise<RefreshResult> {
    if (!accessToken) return 'error';
    running.add(s.id);
    const my = (gen.get(s.id) ?? 0) + 1;
    gen.set(s.id, my);
    const current = () => gen.get(s.id) === my;
    status(s, 'loading');
    try {
      const pack = await packs.refresh(s.id, () =>
        buildPack(opts.provider(accessToken), s.packId, {
          ...opts.build,
          onStatus: (m) => current() && senders.get(s.id)?.(m),
        }),
      );
      if (!pack || store.get(s.id) !== s) return 'superseded';
      onPack(s, pack);
      try {
        // BE-97 AC5: who read which folder. ponytail: SourceProvider has no folder-name call, so
        // folderName stays '' until it does (schema caps it at 200)
        audit({
          event,
          email: s.email,
          sessionId: s.id,
          folderId: parseFolderId(s.packId),
          folderName: '',
          files: pack.files.length,
          tokens: pack.tokens,
        });
      } catch {} // an unparseable folder id: build already succeeded, audit line is just dropped
      return 'ready';
    } catch (e) {
      // codes only: provider errors may carry content (D11). buildPack already emitted status for too-large
      const big = e instanceof PackTooLargeError;
      if (!big && current()) status(s, 'error');
      if (big && current()) {
        // names + token counts only (D11); the pack.status error was already emitted by buildPack
        const files = e.files.map((f) => ({ name: f.file, tokens: f.tokens }));
        tooLarge.set(s.id, files);
        senders.get(s.id)?.({ v: PROTOCOL_VERSION, t: 'error', code: 'PACK_TOO_LARGE', files });
      }
      log('pack.failed', {
        sessionId: s.id,
        code: big ? 'PACK_TOO_LARGE' : 'PACK_BUILD_FAILED',
      });
      return big ? 'too-large' : 'error';
    } finally {
      if (current()) running.delete(s.id);
    }
  }

  return {
    get: (id: string) => packs.get(id),
    /** files of the last PACK_TOO_LARGE for this session (HTTP refresh body) */
    tooLargeFiles: (id: string) => tooLarge.get(id),
    refresh,
    /** socket attached: route pack.status to it (undefined on detach) */
    setSender(id: string, send: ((m: ServerMessage) => void) | undefined) {
      if (send) senders.set(id, send);
      else senders.delete(id);
    },
    /** session.start / resume: build once; a resumed session with a pack just re-announces it */
    async start(s: Session): Promise<RefreshResult | undefined> {
      const have = packs.get(s.id);
      if (have) return void status(s, 'ready', have);
      if (running.has(s.id)) return undefined;
      return refresh(s);
    },
  };
}
