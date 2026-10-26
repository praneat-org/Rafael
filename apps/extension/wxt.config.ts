import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // function: evaluated after WXT loads .env, so WXT_OAUTH_CLIENT_ID from .env files reaches oauth2
  manifest: () => ({
    name: 'Rafael',
    // dev public key -> fixed extension ID (D13). Replace with the OAuth-registered key when BE-71 lands.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqXMvFrH1GZ9Ci8L/GACJI21JjYkkzQ9d8GQmJvSBpaPWPMtzz+Ssh8zMUIgLWj12xNaqpFk/t00hr4v35GRcR7OtXC0qRTt9ymCj3XzDmB3JmgIbcuPmiqHydWZRaEKQD0cRby3gzFJQG2QauEPtljR7Byo6C5jtCA2JxcQhG/KAgohTasz+ZgoiAIlw98h0D/wrE9sM4fjbc3TlnaFgFwZt6PoYFS/qY6w94agMpYydJaCm/OMJkxVdYQPnGKNLLqdwT6k87fW56ZPExRbji36cpaLhstUuYpRK9TF8/UXj2d05RSddUqYB6+dvi9LP9474/Q+PAJVTp7QmQ0fXdQIDAQAB',
    action: { default_title: 'Rafael' },
    // storage = settings only (D11); tabCapture = tab audio (FE-36); identity = sign-in (FE-39)
    permissions: ['sidePanel', 'offscreen', 'storage', 'tabCapture', 'identity'],
    // read the Meet tab url for the default input (narrower than `tabs`)
    host_permissions: ['https://meet.google.com/*'],
    // D13. client id from build env; placeholder until BE-71 (UI shows "not configured")
    oauth2: {
      client_id: process.env.WXT_OAUTH_CLIENT_ID ?? 'UNSET.apps.googleusercontent.com',
      scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.readonly'],
    },
    side_panel: { default_path: 'sidepanel.html' },
  }),
});
