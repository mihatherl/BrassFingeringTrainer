/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare global {
  /** Build stamp, injected by vite.config.ts and shown on the settings screen. */
  const __BUILD_TIME__: string;
  /** Version from package.json, likewise injected at build time. */
  const __APP_VERSION__: string;
}

// `moduleDetection: force` means the declaration above only reaches the rest of
// the project through an explicit global block, which in turn needs this file to
// be a module.
export {};
