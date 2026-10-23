// Hook for BE-87 (real Google tokeninfo check: aud + email_verified + @praneat.com).
// BE-85 only defines the interface and two stand-ins.
export type TokenVerifier = (accessToken: string) => Promise<{ email: string } | null>;

export const denyAll: TokenVerifier = async () => null;

/** Dev only: accepts any non-empty token. index.ts exits unless NODE_ENV === 'development' and K_SERVICE is unset. */
export const devFake: TokenVerifier = async () => ({ email: 'dev@localhost' });
