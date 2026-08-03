/**
 * The shared AudioContext.
 *
 * Browsers refuse to start audio without a user gesture — on iOS in particular
 * a context created outside one stays suspended forever — so the play screen
 * gates the first exercise behind an explicit tap that calls `unlockAudio`.
 */

let context: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!context) {
    context = new AudioContext({ latencyHint: 'interactive' });
  }
  return context;
}

/** Must be called from within a user gesture handler. */
export async function unlockAudio(): Promise<AudioContext> {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  // Safari sometimes reports "running" while still refusing to emit sound until
  // something has actually been played; a silent buffer settles it.
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();

  return ctx;
}

export function isAudioUnlocked(): boolean {
  return context !== null && context.state === 'running';
}
