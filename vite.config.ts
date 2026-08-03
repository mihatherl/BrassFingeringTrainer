import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The app makes no network requests at runtime — the synth is generated, the
 * music glyphs are baked into the bundle and progress lives in localStorage — so
 * precaching the build outright makes it fully offline with no runtime caching
 * rules to reason about.
 */
/**
 * Vite rejects requests carrying an unrecognised Host header, which would
 * otherwise block serving the dev server over a Tailscale hostname. The leading
 * dot matches the tailnet domain and any machine on it.
 */
const TAILNET = '.tail5a7373.ts.net';

/**
 * Stamped into the build and shown on the settings screen, so there is never any
 * doubt about which version a device is actually running.
 */
const buildTime = new Date().toISOString().replace('T', ' ').slice(0, 16);

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Where the app will be served from.
 *
 * GitHub Pages puts a project site under `/<repo>/` rather than at the root, and
 * every asset URL has to agree. Taking it from the environment rather than
 * hard-coding it means the repository can be renamed — or the whole thing moved
 * to a host that serves from the root — without touching this file.
 */
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = repository ? `/${repository}/` : '/';

export default defineConfig({
  base,
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
    __APP_VERSION__: JSON.stringify(version),
  },
  server: { allowedHosts: [TAILNET] },
  preview: { allowedHosts: [TAILNET] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by src/update.ts instead, which also reloads the page when a
      // new worker takes over — the generated script does not.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      workbox: {
        // The sample set is precached rather than fetched on demand, so every
        // instrument works offline rather than only the ones already tried.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mp3}'],
      },
      manifest: {
        name: 'Brass Fingering Trainer',
        short_name: 'Brass Trainer',
        description:
          'Practise brass valve fingerings against scrolling notation, on any instrument in either clef.',
        theme_color: '#c48a2c',
        background_color: '#fbfaf7',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
