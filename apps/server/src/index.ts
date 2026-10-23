import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import { denyAll, devFake, type TokenVerifier } from './auth/verifier.js';
import { log } from './log.js';

const prod = process.env.NODE_ENV === 'production';
const dev = process.env.DEV_FAKE_AUTH === '1' && !prod;
// real verifier comes with BE-87; until then everything but dev-fake is rejected
const verifier: TokenVerifier = dev ? devFake : denyAll;

const server = createApp({
  verifier,
  allowedOrigins: (process.env.EXTENSION_IDS ?? '')
    .split(',')
    .filter(Boolean)
    .map((id) => `chrome-extension://${id.trim()}`),
  allowLocalhost: !prod,
}).listen(Number(process.env.PORT ?? 8080), () => {
  const { port } = server.address() as AddressInfo;
  log('listening', { port });
});

// Cloud Run SIGTERM: tell clients to reconnect, exit within 10 s
process.on('SIGTERM', () => {
  server.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
});
