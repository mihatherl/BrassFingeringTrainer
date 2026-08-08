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
 *
 * ## Why the verdict is cached rather than recomputed
 *
 * Everything that decides this today is instant — a build flag, a query
 * parameter, a `localStorage` read. A real purchase check is not: a store
 * receipt is verified over the network, and the answer arrives some time after
 * the app has already rendered.
 *
 * So the answer is held rather than derived on demand, and `refreshEntitlements`
 * is where a slow check will eventually go. Callers keep asking a synchronous
 * question and get the best answer known so far; when a slower answer arrives
 * it replaces the held one and anything watching is told. Without that seam,
 * making the check asynchronous later would mean reworking the render path of
 * whatever happened to be asking — which is one `useMemo` today and would not
 * stay that way.
 *
 * The held object's identity is part of the contract: it changes only when the
 * entitlements themselves change, so a subscriber can compare by reference and
 * React's `useSyncExternalStore` will not loop.
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

/** The verdict as things stand, before anything slow has been consulted. */
function decide(): Entitlements {
  if (forcedFree()) return FREE;
  if (!isGatedBuild()) return entitlementsFor(true);
  return entitlementsFor(isUnlocked());
}

let held: Entitlements | null = null;
const watchers = new Set<() => void>();

function same(a: Entitlements | null, b: Entitlements): boolean {
  if (a === null) return false;
  return (Object.keys(b) as Array<keyof Entitlements>).every((key) => a[key] === b[key]);
}

/**
 * What this copy may do, as currently known.
 *
 * Synchronous on purpose, and stays that way however the check is eventually
 * made — see the note at the top of this file.
 */
export function currentEntitlements(): Entitlements {
  held ??= decide();
  return held;
}

/**
 * Watches for the verdict changing, which it does when a purchase is recorded
 * or a slower check finishes. Returns the function that stops watching.
 */
export function watchEntitlements(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
}

/**
 * Asks again, and tells anything watching if the answer moved.
 *
 * Where a store receipt check belongs. It re-reads what is cheap to read today,
 * so calling it costs nothing and the seam stays exercised rather than
 * theoretical.
 */
export async function refreshEntitlements(): Promise<void> {
  // Establishes the held value first, so that refreshing before anything has
  // asked is not reported as a change. There was no previous answer to differ
  // from, and a watcher told of a change would find the same verdict it would
  // have read anyway.
  const before = currentEntitlements();
  const next = decide();
  // Identity only changes when the answer does, so a subscriber comparing by
  // reference sees a change exactly when there is one.
  if (same(before, next)) return;
  held = next;
  for (const watcher of watchers) watcher();
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
  void refreshEntitlements();
}
