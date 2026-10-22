import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';

const server = createApp().listen(Number(process.env.PORT ?? 8080), () => {
  const { port } = server.address() as AddressInfo;
  console.log(JSON.stringify({ msg: 'listening', port }));
});
