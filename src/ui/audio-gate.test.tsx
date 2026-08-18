// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * What the gate does when the sound cannot be brought up.
 *
 * The one thing past "Tap to start" that can be tested without a real
 * AudioContext, and it is worth testing because the failure it guards against
 * is *silence with no message* — the app looking as though it is playing while
 * nothing can be heard, which is the hardest fault for a player to report and
 * the easiest for anyone to mistake for a bug in the music.
 *
 * The context module is faked here rather than the browser: `ensureRunning`
 * answers whether the clock is genuinely moving, and this test is about the
 * screen's answer to *no*.
 */

const ensureRunning = vi.fn<() => Promise<boolean>>();
const markStuck = vi.fn();
// Enough of a context to be handed around; the voice's own loading throws on
// it, which is the caught case the screen already handles by playing on
// synthesis, and leaves this test measuring only the clock's verdict.
const fakeContext = {} as AudioContext;

vi.mock('../audio/context', () => ({
  getAudioContext: () => fakeContext,
  ensureRunning: () => ensureRunning(),
  markStuck: () => markStuck(),
  unlockAudio: async () => fakeContext,
}));

const { App } = await import('./App');

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

async function tapThroughToPlay(): Promise<void> {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  fireEvent.click(await screen.findByRole('button', { name: /tap to start/i }));
}

describe('the audio gate', () => {
  it('says the sound did not start rather than running a silent exercise', async () => {
    // The context died while the samples were coming down — the case the
    // screen used to walk straight past, into a frozen count-in.
    ensureRunning.mockResolvedValue(false);

    await tapThroughToPlay();

    expect(await screen.findByRole('heading', { name: /audio didn’t start/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    // And no valve pad: nothing was started to be silent.
    expect(screen.queryByRole('button', { name: /valve 1/i })).toBeNull();
  });

  it('offers the way out from a gesture, so a fresh context can be brought up', async () => {
    ensureRunning.mockResolvedValue(false);
    await tapThroughToPlay();
    const again = await screen.findByRole('button', { name: /try again/i });

    // Trying again asks the context to come up afresh — the one thing that
    // needs a tap, and the reason this is a button rather than a retry.
    ensureRunning.mockClear();
    fireEvent.click(again);
    await waitFor(() => expect(ensureRunning).toHaveBeenCalled());
  });
});
