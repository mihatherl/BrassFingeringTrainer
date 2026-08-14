// @vitest-environment happy-dom

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KeyDial } from './KeyDial';

/**
 * The key, turned while playing.
 *
 * The property that matters here is the one that separates this dial from the
 * tempo beside it: **the face follows the finger, and the music waits for it to
 * come off**. Every detent is shown, one is committed. Not for the sake of the
 * work — two hundred bars regenerate in a few milliseconds — but because a key
 * is a destination and not a path, and the keys passed through on the way are
 * not keys the player asked to read.
 */

afterEach(cleanup);

function show(initial = 0) {
  const shown: number[] = [];
  const committed: number[] = [];

  function Harness() {
    const [fifths, setFifths] = useState(initial);
    return (
      <KeyDial
        fifths={fifths}
        onChange={(next) => {
          shown.push(next);
          setFifths(next);
        }}
        onCommit={(next) => committed.push(next)}
        fromBar="9"
      />
    );
  }
  render(<Harness />);
  return { shown, committed };
}

const dial = () => screen.getByRole('spinbutton', { name: 'Key' });
const at = () => Number(dial().getAttribute('aria-valuenow'));

/** A finger travelling `pixels` up the wheel, in one move, then released. */
function spin(pixels: number, { release = true } = {}) {
  const wheel = dial();
  const from = 400;
  fireEvent.pointerDown(wheel, { pointerId: 1, button: 0, clientY: from });
  fireEvent.pointerMove(wheel, { pointerId: 1, clientY: from - pixels });
  if (release) fireEvent.pointerUp(wheel, { pointerId: 1, clientY: from - pixels });
}

describe('the key dial', () => {
  it('turns one step round the circle for each detent of travel', () => {
    show(0);
    // Twenty-two pixels to the detent: C up three is A, three sharps.
    spin(66);
    expect(at()).toBe(3);
    spin(-44);
    expect(at()).toBe(1);
  });

  it('stops at seven flats and seven sharps', () => {
    show(0);
    spin(22 * 20);
    expect(at()).toBe(7);
    spin(-22 * 40);
    expect(at()).toBe(-7);
  });

  /** The whole reason this dial is not the tempo dial. */
  it('shows every key it passes and commits only the one it stops on', () => {
    const { shown, committed } = show(-1);

    const wheel = dial();
    fireEvent.pointerDown(wheel, { pointerId: 1, button: 0, clientY: 400 });
    // One flat up to two sharps, a detent at a time — the player's own case.
    fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 400 - 22 });
    fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 400 - 44 });
    fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 400 - 66 });

    expect(shown, 'the face went through all three').toEqual([0, 1, 2]);
    expect(committed, 'and the music through none of them').toEqual([]);

    fireEvent.pointerUp(wheel, { pointerId: 1, clientY: 400 - 66 });
    expect(committed, 'one rewrite, into the key they chose').toEqual([2]);
  });

  it('commits nothing when the turn comes back to where it started', () => {
    const { committed } = show(0);
    const wheel = dial();
    fireEvent.pointerDown(wheel, { pointerId: 1, button: 0, clientY: 400 });
    fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 400 - 66 });
    fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 400 });
    fireEvent.pointerUp(wheel, { pointerId: 1, clientY: 400 });

    expect(committed, 'the music is already in that key').toEqual([]);
  });

  /**
   * A keypress has no middle to wait through, so it settles and commits
   * together. The same bargain as a wheel notch.
   */
  it('commits a keypress at once', () => {
    const { committed } = show(0);
    fireEvent.keyDown(dial(), { key: 'ArrowUp' });
    expect(at()).toBe(1);
    expect(committed).toEqual([1]);
  });

  it('commits a cancelled gesture rather than dropping it', () => {
    // The detents have clicked and the face has moved, so the player has already
    // been told where the dial is; leaving the music behind that is the worse lie.
    const { committed } = show(0);
    const wheel = dial();
    fireEvent.pointerDown(wheel, { pointerId: 1, button: 0, clientY: 400 });
    fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 400 - 44 });
    fireEvent.pointerCancel(wheel, { pointerId: 1 });
    expect(committed).toEqual([2]);
  });

  it('names the key and the bar the change lands in, while turning', () => {
    show(-2);
    expect(screen.queryByText('bar 9'), 'nothing in the way when idle').toBeNull();

    const wheel = dial();
    fireEvent.pointerDown(wheel, { pointerId: 1, button: 0, clientY: 400 });
    fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 400 - 22 });

    // The bar is the half a player cannot work out for themselves: whether the
    // change is coming soon enough to matter to the phrase they are in.
    expect(screen.getByText('bar 9')).toBeTruthy();
    expect(screen.getAllByText('F').length, 'the key it would land in').toBeGreaterThan(0);
  });

  it('says what it is set to, for anyone not looking at it', () => {
    show(-3);
    expect(dial().getAttribute('aria-valuetext')).toBe('Eb major, 3 flats');
    fireEvent.keyDown(dial(), { key: 'Home' });
    expect(dial().getAttribute('aria-valuetext')).toBe('Cb major, 7 flats');
  });
});
