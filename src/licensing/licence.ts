/**
 * Whether this copy is unlocked.
 *
 * Deliberately the only place that knows how that is decided, so the mechanism
 * can change — a store purchase, a typed-in key, a receipt check — without
 * touching anything else.
 *
 * Gating is **off** unless the build asks for it. The app as normally built is
 * fully unlocked, which is what a free release wants; a paid build sets
 * `VITE_GATED=true` and the free tier applies until something unlocks it.
 *
 * `?tier=free` forces the free tier in any build, so the limited experience can
 * be looked at without producing a separate one.
 */

import { entitlementsFor, FREE, type Entitlements } from './entitlements';

const UNLOCK_KEY = 'brass-trainer:unlocked';

/** Whether this build withholds anything at all. */
export function isGatedBuild(): boolean {
  return import.meta.env.VITE_GATED === 'true';
}

function forcedFree(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('tier') === 'free';
  } catch {
    return false;
  }
}

export function isUnlocked(): boolean {
  try {
    return localStorage.getItem(UNLOCK_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Records a purchase.
 *
 * A local flag is not a serious defence, and is not meant to be: anyone willing
 * to open developer tools can set it. Store receipts are the real check when
 * there is a store; this keeps the rest of the app honest in the meantime.
 */
export function setUnlocked(unlocked: boolean): void {
  try {
    localStorage.setItem(UNLOCK_KEY, String(unlocked));
  } catch {
    // Private browsing; the purchase will have to be restored again later.
  }
}

export function currentEntitlements(): Entitlements {
  if (forcedFree()) return FREE;
  if (!isGatedBuild()) return entitlementsFor(true);
  return entitlementsFor(isUnlocked());
}
