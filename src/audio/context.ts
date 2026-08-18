/**
 * The shared AudioContext.
 *
 * Every musical position in the app is derived from `currentTime`, which makes
 * the context's state load-bearing in a way that is easy to miss: a context that
 * is not running has a clock that does not advance, so the count-in sticks on
 * its first number, the scheduler's horizon never moves and no metronome click
 * is ever scheduled. Nothing errors. It simply stops, silently.
 *
 * Browsers only allow a context to be started from a user gesture, and they
 * suspend it again readily — on losing focus, on an interruption such as a
 * phone call, or on being restored from the back/forward cache. So resuming it
 * once at the tap is not enough: it has to be verified immediately before the
 * clock is relied upon, and watched while it is running.
 */

let context: AudioContext | null = null;

/**
 * Whether the context in hand is known to be dead: running by its own
 * account, or resumable by nobody, with a clock that does not move.
 *
 * iOS does this after the app has been away — a call, another app, the
 * screen locked. The context comes back reporting `running`, or `interrupted`
 * for good, and `resume()` changes nothing; every note scheduled against it
 * lands on a clock that never arrives. Nothing revives it. What works is a
 * fresh context, which is what `getAudioContext` hands out once this is set,
 * and what "Try again" on the play screen used to promise and never did — it
 * asked the dead one to resume, was told no, and left the screen where it
 * was. Reported by the player on 2026-08-16: only a browser refresh helped.
 */
let stuck = false;

/**
 * Safari reports `interrupted` as well as the states the spec defines, and a
 * context in that state is every bit as stopped as a suspended one.
 */
function isRunning(ctx: AudioContext): boolean {
  return (ctx.state as string) === 'running';
}

export function getAudioContext(): AudioContext {
  if (context && stuck) {
    // Let the dead one go. Nothing awaits its closing, and a close that fails
    // is a context that was already gone.
    void context.close().catch(() => undefined);
    context = null;
    stuck = false;
  }
  if (!context) {
    context = new AudioContext({ latencyHint: 'interactive' });

    // Suspension can happen at any point — a call arriving, the screen locking,
    // switching apps. Asking for it back immediately means an exercise usually
    // survives the interruption instead of freezing at whatever beat it reached.
    context.addEventListener('statechange', () => {
      if (context && !isRunning(context)) void context.resume().catch(() => undefined);
    });
  }
  return context;
}

/**
 * Marks the context in hand as dead, so the next `getAudioContext` replaces
 * it. Called by whoever has watched its clock stand still — the play screen's
 * stall check — and by `ensureRunning` when it finds the same.
 *
 * `target` is the context the caller was actually watching, and passing it is
 * what makes the verdict *about* something. A report on a context that has
 * already been replaced says nothing about the one in hand, and discarding
 * the live one on its word would throw away a good context — on iOS, one
 * brought up inside a user gesture, which cannot be brought up again without
 * another. Omitting it is a verdict on whatever is current, which is what
 * `ensureRunning` means, since it has just tested that one itself.
 */
export function markStuck(target?: AudioContext): void {
  if (target && target !== context) return;
  stuck = true;
}

/**
 * Brings the context up, and confirms it.
 *
 * `resume()` resolves without promising the context is actually running, so the
 * state is polled briefly rather than trusted. Returns whether it succeeded so
 * the caller can say something useful instead of starting a run against a clock
 * that will never move.
 */
export async function ensureRunning(timeoutMs = 1500): Promise<boolean> {
  const ctx = getAudioContext();

  if (!isRunning(ctx)) {
    try {
      await ctx.resume();
    } catch {
      // Called outside a gesture, most likely; the poll below still gives it a
      // chance in case something else resumes it.
    }
    const deadline = Date.now() + timeoutMs;
    while (!isRunning(ctx) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!isRunning(ctx)) {
      // Resumable by nobody: dead, and the next asker gets a fresh one.
      markStuck(ctx);
      return false;
    }
  }

  /*
   * Running by its own account is not the same as running. After an
   * interruption iOS can report `running` over a clock that never advances,
   * and everything scheduled against it waits for ever. So the clock is
   * watched for a moment before it is trusted; one that does not move is a
   * dead context, and is marked so.
   */
  const before = ctx.currentTime;
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (ctx.currentTime === before) {
    markStuck(ctx);
    return false;
  }
  return true;
}

/**
 * Starts audio from within a user gesture handler.
 *
 * Must be called synchronously enough from the gesture that the browser still
 * associates the two — anything awaited beforehand may forfeit the permission.
 */
export async function unlockAudio(): Promise<AudioContext> {
  let ctx = getAudioContext();
  // A dead context is replaced and the fresh one brought up in its place —
  // still inside the gesture that called this, since nothing was awaited
  // before the first attempt found it dead.
  if (!(await ensureRunning())) {
    ctx = getAudioContext();
    await ensureRunning();
  }

  // Safari sometimes reports "running" while still refusing to emit sound until
  // something has actually been played; a silent buffer settles it.
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();

  return ctx;
}
