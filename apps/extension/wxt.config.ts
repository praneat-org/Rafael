import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Rafael',
    // dev public key -> fixed extension ID (D13). Replace with the OAuth-registered key when BE-71 lands.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqXMvFrH1GZ9Ci8L/GACJI21JjYkkzQ9d8GQmJvSBpaPWPMtzz+Ssh8zMUIgLWj12xNaqpFk/t00hr4v35GRcR7OtXC0qRTt9ymCj3XzDmB3JmgIbcuPmiqHydWZRaEKQD0cRby3gzFJQG2QauEPtljR7Byo6C5jtCA2JxcQhG/KAgohTasz+ZgoiAIlw98h0D/wrE9sM4fjbc3TlnaFgFwZt6PoYFS/qY6w94agMpYydJaCm/OMJkxVdYQPnGKNLLqdwT6k87fW56ZPExRbji36cpaLhstUuYpRK9TF8/UXj2d05RSddUqYB6+dvi9LP9474/Q+PAJVTp7QmQ0fXdQIDAQAB',
    action: { default_title: 'Rafael' },
    // storage = settings only (D11); tabCapture = tab audio (FE-36); FE-39 adds identity when they use them
    permissions: ['sidePanel', 'offscreen', 'storage', 'tabCapture'],
    side_panel: { default_path: 'sidepanel.html' },
  },
});
