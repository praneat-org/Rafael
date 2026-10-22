import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Rafael',
    action: { default_title: 'Rafael' },
    permissions: ['sidePanel'],
    side_panel: { default_path: 'sidepanel.html' },
  },
});
