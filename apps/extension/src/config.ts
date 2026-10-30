import { resolveServerUrl } from './server-url';

export { resolveServerUrl };

// dev points at the local server (BE-81); prod URL comes from build env
export const SERVER_URL: string = resolveServerUrl(
  import.meta.env.DEV,
  import.meta.env.WXT_SERVER_URL,
);
