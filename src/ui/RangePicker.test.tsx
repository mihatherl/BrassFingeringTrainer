// @vitest-environment happy-dom

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { instrumentById, writtenRange } from '../domain/instruments';
import { midiFromName } from '../domain/pitch';
import { DIAL_STEP_PX } from './NoteDial';
import { RangePicker } from './RangePicker';

/**
 * Dialling a range.
 *
 * Two things are worth holding down here, and neither is visible in the
 * drawing. **A turn is a stave step in the key** — the unit the figure above
 * the dials is drawn in, and the reason a bound never arrives carrying an
 * accidental nobody asked for. And **the dials block rather than shove**: a
 * lower bound driven up into the upper one stops there, because moving a note
 * the player is not touching is how a range walks up the horn on its own.
 *
 * Both gestures that turn a dial are exercised, since they are separate code
 * paths onto the same arithmetic: the drag, which is how it is meant to be
 * used, and the keyboard, which is how it is used by anyone who cannot drag.
 */

afterEach(cleanup);

const EB_BASS = instrumentById('eb-bass');
const EB_MAJOR = -3;
const [LOWEST, HIGHEST] = writtenRange(EB_BASS, 'treble');

function show(initial: { low: number; high: number } | null) {
  function Harness() {
    const [range, setRange] = useState(initial);
    return (
      <RangePicker
        instrument={EB_BASS}
        clef="treble"
        fifths={EB_MAJOR}
        range={range}
        onChange={setRange}
      />
    );
  }
  render(<Harness />);
}

const dial = (name: 'Lowest' | 'Highest') => screen.getByRole('spinbutton', { name });
const at = (name: 'Lowest' | 'Highest') => dial(name).getAttribute('aria-valuetext');

/** A finger on the dial, travelling `steps` detents upwards. */
function turn(name: 'Lowest' | 'Highest', steps: number) {
  const target = dial(name);
  const from = 500;
  fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientY: from });
  fireEvent.pointerMove(target, { pointerId: 1, clientY: from - steps * DIAL_STEP_PX });
  fireEvent.pointerUp(target, { pointerId: 1, clientY: from - steps * DIAL_STEP_PX });
}

const press = (name: 'Lowest' | 'Highest', key: string) => fireEvent.keyDown(dial(name), { key });

describe('the range dials', () => {
  it('opens at the whole compass, both ends of it reachable', () => {
    show(null);
    fireEvent.click(screen.getByRole('checkbox', { name: /Choose the range myself/ }));

    expect(at('Lowest')).toBe('Db3');
    expect(at('Highest')).toBe('C6');
    // The bottom of this instrument belongs to no flat key — spelled Db3 in E
    // flat, it is on the dial because it is the bottom of the horn.
    expect(LOWEST).toBe(midiFromName('C#3'));
  });

  it('turns by a step of the key, not by a semitone', () => {
    show({ low: midiFromName('G3'), high: midiFromName('C5') });

    turn('Lowest', 1);
    expect(at('Lowest')).toBe('Ab3');
    turn('Lowest', 1);
    expect(at('Lowest')).toBe('Bb3');
    turn('Lowest', -1);
    expect(at('Lowest')).toBe('Ab3');
  });

  it('follows a long drag the whole way in one gesture', () => {
    show({ low: midiFromName('G3'), high: midiFromName('C5') });

    // Seven steps of E flat major from G3 is the G an octave up.
    turn('Lowest', 7);
    expect(at('Lowest')).toBe('G4');
  });

  it('stops the lower bound at the upper one instead of pushing it along', () => {
    show({ low: midiFromName('G4'), high: midiFromName('Bb4') });

    turn('Lowest', 6);
    expect(at('Lowest')).toBe('Bb4');
    expect(at('Highest')).toBe('Bb4');
  });

  it('stops the upper bound at the lower one', () => {
    show({ low: midiFromName('G4'), high: midiFromName('Bb4') });

    turn('Highest', -6);
    expect(at('Highest')).toBe('G4');
    expect(at('Lowest')).toBe('G4');
  });

  it('is a spinbutton for anyone who cannot drag one', () => {
    show({ low: midiFromName('G3'), high: midiFromName('C5') });

    press('Lowest', 'ArrowUp');
    expect(at('Lowest')).toBe('Ab3');
    press('Lowest', 'ArrowDown');
    expect(at('Lowest')).toBe('G3');

    press('Highest', 'PageDown');
    expect(at('Highest')).toBe('C4');

    press('Lowest', 'Home');
    expect(at('Lowest')).toBe('Db3');
    press('Highest', 'End');
    expect(at('Highest')).toBe('C6');
  });

  it('says how much of the horn the choice covers', () => {
    show({ low: midiFromName('G3'), high: midiFromName('C5') });
    expect(screen.getByText(/an octave and 5 semitones/)).toBeTruthy();

    press('Highest', 'Home');
    expect(screen.getByText(/one note/)).toBeTruthy();
  });

  it('names both ends for a screen reader, which cannot see the stave', () => {
    show({ low: midiFromName('G3'), high: midiFromName('C5') });
    expect(screen.getByLabelText('Range: G3 to C5')).toBeTruthy();
  });

  it('offers nothing to dial until the range is asked for', () => {
    show(null);
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Choose the range myself/ })).toBeTruthy();
  });

  it('keeps the range within the instrument at both ends', () => {
    show({ low: LOWEST, high: HIGHEST });

    turn('Lowest', -20);
    expect(at('Lowest')).toBe('Db3');
    turn('Highest', 20);
    expect(at('Highest')).toBe('C6');
    expect(HIGHEST).toBe(midiFromName('C6'));
  });
});
