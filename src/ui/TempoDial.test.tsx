// @vitest-environment happy-dom

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TEMPO_RANGE } from '../domain/tempo';
import { TempoDial } from './TempoDial';

/**
 * The tempo, turned while playing.
 *
 * A dial rather than a slider because a slider has to fit forty to two hundred
 * and twenty into the width beside the stave, which makes every pixel worth a
 * couple of beats a minute. The property that matters here is the one that buys
 * back: **the same finger travel is worth the same change wherever it starts**,
 * and a big move is several spins rather than a lottery.
 */

afterEach(cleanup);

function show(initial = 120) {
  function Harness() {
    const [tempo, setTempo] = useState(initial);
    return <TempoDial tempo={tempo} onChange={setTempo} />;
  }
  render(<Harness />);
}

const dial = () => screen.getByRole('spinbutton', { name: 'Tempo' });
const at = () => Number(dial().getAttribute('aria-valuenow'));

/** A finger on the wheel, travelling `pixels` (up is faster). */
function spin(pixels: number) {
  const wheel = dial();
  const from = 400;
  fireEvent.pointerDown(wheel, { pointerId: 1, button: 0, clientY: from });
  fireEvent.pointerMove(wheel, { pointerId: 1, clientY: from - pixels });
  fireEvent.pointerUp(wheel, { pointerId: 1, clientY: from - pixels });
}

describe('the tempo dial', () => {
  it('turns a beat a minute for each detent of travel', () => {
    show(120);
    // Eighteen pixels to the detent: five detents down.
    spin(-90);
    expect(at()).toBe(115);
    spin(90);
    expect(at()).toBe(120);
  });

  it('takes a few spins to cross the range, at the same rate throughout', () => {
    /*
     * The trade the player asked for. A slider would put 140 and 80 a
     * thumb's width apart and every tempo in between within a pixel or two of
     * its neighbours; here the distance is the same wherever you are, and a
     * long journey is simply several spins.
     */
    show(140);
    const spins = [];
    for (let i = 0; i < 5; i++) {
      spin(-216); // twelve detents, about a thumb's worth
      spins.push(at());
    }

    expect(spins).toEqual([128, 116, 104, 92, 80]);
  });

  it('shows the tempo in its own numbers, where a thumb is not', () => {
    // The reading is above the wheel and large, because the hand turning the
    // dial covers the dial and the eye is on the stave.
    show(120);
    spin(-36);
    expect(screen.getByText('118')).toBeTruthy();
  });

  it('stops at the ends of the range rather than running past them', () => {
    show(TEMPO_RANGE.max - 2);
    spin(360);
    expect(at()).toBe(TEMPO_RANGE.max);

    cleanup();
    show(TEMPO_RANGE.min + 2);
    spin(-360);
    expect(at()).toBe(TEMPO_RANGE.min);
  });

  it('is a spinbutton for anyone not using a finger', () => {
    show(120);
    fireEvent.keyDown(dial(), { key: 'ArrowDown' });
    expect(at()).toBe(119);
    fireEvent.keyDown(dial(), { key: 'PageDown' });
    expect(at()).toBe(109);
    fireEvent.keyDown(dial(), { key: 'Home' });
    expect(at()).toBe(TEMPO_RANGE.min);
    fireEvent.keyDown(dial(), { key: 'End' });
    expect(at()).toBe(TEMPO_RANGE.max);
  });
});
