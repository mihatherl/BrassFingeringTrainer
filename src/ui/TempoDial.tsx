/**
 * The tempo, under the player's hand while they are playing.
 *
 * A dial rather than a slider, on the player's call: a slider has to fit the
 * whole range — forty to two hundred and twenty — into whatever width is beside
 * the stave, which makes every pixel worth a couple of beats a minute and turns
 * "a shade slower" into a lottery. A dial gives the same finger travel to every
 * beat a minute wherever it starts from. Going from 140 to 80 then takes
 * several spins, which is the trade and the right way round: the small
 * adjustment is the one made constantly.
 *
 * **The reading is on the face, and again above it while turning.** On the face
 * because that is where a control's setting belongs and it is legible at a
 * glance the rest of the time; above it while a finger is on it because the
 * finger is covering the face, and the other hand is on the valves with the eye
 * on the stave. The callout is the trick a phone keyboard uses for the key
 * under the thumb, for the same reason.
 *
 * The face is a knurled wheel that turns with the finger. It carries no scale:
 * a wheel showing where forty and two hundred are would be a slider again, with
 * the same problem in a smaller space.
 */

import type { CSSProperties } from 'react';
import { TEMPO_RANGE } from '../domain/tempo';
import { useDial } from './useDial';

/**
 * Travel to one beat a minute, in CSS pixels.
 *
 * Halved on the player's call after living with it: a swipe is worth twice
 * what it was, so crossing a useful stretch of the range is a couple of spins
 * rather than five. Fine control is still a beat a minute — the detent has not
 * changed, only how far the finger goes to reach the next one.
 */
const STEP_PX = 9;

/** What a page key moves by — a useful lump of tempo, not a nudge. */
const PAGE_STEP = 10;

/**
 * Spacing of the wheel's ridges, in CSS pixels.
 *
 * Deliberately not a divisor of the detent: at half a detent the wheel would
 * land in exactly the same place at every stop and the turning would be
 * invisible, which is the one thing the ridges are there to show.
 */
const RIDGE_PX = 7;

interface TempoDialProps {
  tempo: number;
  onChange: (bpm: number) => void;
  /** True in compound time, where the number counts dotted crotchets. */
  compound?: boolean;
}

export function TempoDial({ tempo, onChange, compound }: TempoDialProps) {
  const dial = useDial({
    value: tempo,
    resolve: (from, delta) =>
      Math.min(TEMPO_RANGE.max, Math.max(TEMPO_RANGE.min, from + delta)),
    onChange,
    stepPx: STEP_PX,
    pageStep: PAGE_STEP,
    ends: { min: TEMPO_RANGE.min, max: TEMPO_RANGE.max },
  });

  /*
   * Where the ridges have turned to.
   *
   * From the tempo itself rather than from the drag, so the wheel is *at* a
   * position rather than merely moving: the same tempo always shows the same
   * face, and a change made with the keyboard turns it as far as a finger would
   * have. The residual is added on top, which is what makes it follow the hand
   * between one beat a minute and the next.
   */
  const phase = -(tempo * STEP_PX + dial.offset);
  const unit = compound ? 'dotted' : 'bpm';

  return (
    <div className="tempo-dial">
      {dial.turning && (
        <span className="tempo-dial__callout" aria-hidden="true">
          {tempo}
        </span>
      )}
      <div
        ref={dial.ref}
        className={`tempo-dial__wheel ${dial.turning ? 'is-turning' : ''}`}
        style={{ '--ridge': `${RIDGE_PX}px`, '--phase': `${phase}px` } as CSSProperties}
        role="spinbutton"
        tabIndex={0}
        aria-label="Tempo"
        aria-valuemin={TEMPO_RANGE.min}
        aria-valuemax={TEMPO_RANGE.max}
        aria-valuenow={tempo}
        aria-valuetext={`${tempo} beats per minute`}
        {...dial.handlers}
      >
        <span className="tempo-dial__face" aria-hidden="true">
          <strong>{tempo}</strong>
          <span className="tempo-dial__unit">{unit}</span>
        </span>
      </div>
    </div>
  );
}
