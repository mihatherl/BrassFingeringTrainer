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
 * Safari reports `interrupted` as well as the states the spec defines, and a
 * context in that state is every bit as stopped as a suspended one.
 */
function isRunning(ctx: AudioContext): boolean {
  return (ctx.state as string) === 'running';
}

export function getAudioContext(): AudioContext {
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
 * Brings the context up, and confirms it.
 *
 * `resume()` resolves without promising the context is actually running, so the
 * state is polled briefly rather than trusted. Returns whether it succeeded so
 * the caller can say something useful instead of starting a run against a clock
 * that will never move.
 */
export async function ensureRunning(timeoutMs = 1500): Promise<boolean> {
  const ctx = getAudioContext();
  if (isRunning(ctx)) return true;

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
  return isRunning(ctx);
}

/**
 * Starts audio from within a user gesture handler.
 *
 * Must be called synchronously enough from the gesture that the browser still
 * associates the two — anything awaited beforehand may forfeit the permission.
 */
export async function unlockAudio(): Promise<AudioContext> {
  const ctx = getAudioContext();
  await ensureRunning();

  // Safari sometimes reports "running" while still refusing to emit sound until
  // something has actually been played; a silent buffer settles it.
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();

  return ctx;
}
