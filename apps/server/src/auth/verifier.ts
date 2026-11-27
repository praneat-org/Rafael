// Real check lives in google.ts (BE-87); this file has the interface and two stand-ins.
export type TokenVerifier = (accessToken: string) => Promise<{ email: string } | null>;

export const denyAll: TokenVerifier = async () => null;

/** Dev only: accepts any non-empty token. index.ts exits unless NODE_ENV === 'development' and K_SERVICE is unset. */
export const devFake: TokenVerifier = async () => ({ email: 'dev@localhost' });
