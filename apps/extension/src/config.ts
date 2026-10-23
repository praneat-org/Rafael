// dev points at the local server (BE-81); prod URL comes from build env
export const SERVER_URL: string = import.meta.env.DEV
  ? 'http://localhost:8080'
  : (import.meta.env.WXT_SERVER_URL ?? '');
