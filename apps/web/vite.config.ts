import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Output apps/web/dist: the Cloud Run server serves it as static files at the same origin.
// The extension's chrome-free modules, sidepanel views and docs/onboarding.md are imported by relative
// path, not copied: one session core, one UI.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // files under apps/extension must resolve these from web's install (apps/extension may not be installed)
    alias: { '@rafael/protocol': at('../../packages/protocol/src/index.ts') },
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5173 },
  // 0: the AudioWorklet module must stay a real file, not a data: URL
  build: { outDir: 'dist', target: 'es2022', assetsInlineLimit: 0 },
});
