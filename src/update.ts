/**
 * Keeping the installed app up to date.
 *
 * The service worker precaches the whole build, which is what makes the app work
 * offline — and also what makes a new build easy to miss. The default
 * registration installs a new worker and lets it take over, but says nothing to
 * the page already on screen: that page keeps the assets it started with. The
 * result is that a refresh appears to change nothing, and only a *second*
 * refresh shows the new version. Anyone testing a change would reasonably
 * conclude it had not been deployed.
 *
 * So the page reloads itself the moment a new worker takes control, and checks
 * for one periodically rather than only at startup — an installed app on a phone
 * may go days without a cold start.
 */

import { registerSW } from 'virtual:pwa-register';

/** How often to ask the server whether there is a new build. */
const UPDATE_CHECK_MS = 60_000;

export function keepUpToDate(): void {
  if (!('serviceWorker' in navigator)) return;

  // Whether a worker was already in charge when this page loaded. On a first
  // ever visit the worker takes control immediately, and reloading for that
  // would be a pointless flash.
  const wasControlled = navigator.serviceWorker.controller !== null;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlled || reloading) return;
    reloading = true;
    window.location.reload();
  });

  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      window.setInterval(() => {
        void registration.update();
      }, UPDATE_CHECK_MS);
    },
  });
}
