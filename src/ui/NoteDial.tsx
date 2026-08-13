/**
 * A dial that turns a note up and down.
 *
 * Not a stepper and not a dropdown. A dropdown of thirty-six notes is a list to
 * hunt through, and a pair of arrows is two small targets to jab at; the thing
 * being chosen here is a *place on the horn*, and the gesture that matches it is
 * a continuous one — a finger travelling up moves the note up, and keeps moving
 * it for as long as the finger keeps going.
 *
 * The names travel with the finger rather than the drum snapping between them,
 * so the movement is legible while it happens, and each detent announces itself
 * with a click and a tap on the hand. Past the last note it can reach — the end
 * of the instrument, or the other bound of the range — the drum gives a quarter
 * of an inch and no more, which says "stopped" in the way a scroll view says it
 * rather than by simply going dead under the finger.
 *
 * The whole compass is not on a strip somewhere waiting to be rendered: rungs
 * are asked for one at a time from `stepOnLadder`, which is what lets the same
 * control serve a three-octave tuba and a note that has been squeezed to a
 * single choice by the bound opposite it.
 *
 * A dial is also a control someone may never touch with a finger, so the window
 * is a spinbutton: arrows for a step, page keys for seven of them, home and end
 * for the two extremes, and a wheel for a mouse. The gesture itself is
 * `useDial`, which the tempo dial turns the same way.
 */

import { type CSSProperties } from 'react';
import { stepOnLadder } from '../domain/ladder';
import { useDial } from './useDial';

/** Height of one detent, in CSS pixels. The CSS reads it back as a variable. */
export const DIAL_STEP_PX = 30;

/**
 * How many notes are shown either side of the chosen one.
 *
 * One. Two read better — a dial you can see further into is a dial you can aim
 * — but this stands beside the stave in a settings screen being kept short, and
 * two more rows is another half-inch between the player and the Start button
 * for notes they are about to turn past anyway.
 */
const RADIUS = 1;

/** Notes a page key moves by: a scale's worth, which is nearly an octave. */
const PAGE_STEPS = 7;

interface NoteDialProps {
  /** "Lowest" or "Highest" — shown under the dial and read out with it. */
  label: string;
  /** The rungs, ascending. See `domain/ladder.ts`. */
  values: readonly number[];
  /** The chosen note, in written MIDI. Need not be on the ladder. */
  value: number;
  /** Bounds this dial may not pass: the compass, or the other bound. */
  min: number;
  max: number;
  /** How a note is named on the drum. */
  name: (midi: number) => string;
  onChange: (midi: number) => void;
}

export function NoteDial({ label, values, value, min, max, name, onChange }: NoteDialProps) {
  /** Where `delta` steps from `from` lands, without passing either bound. */
  const reach = (from: number, delta: number): number =>
    Math.min(max, Math.max(min, stepOnLadder(values, from, delta)));

  const dial = useDial({
    value,
    resolve: reach,
    onChange,
    stepPx: DIAL_STEP_PX,
    pageStep: PAGE_STEPS,
    ends: { min, max },
  });

  /*
   * The names on the drum, top to bottom.
   *
   * A rung that repeats the one before it is a clamp rather than a note, and is
   * left blank: the drum runs out where the instrument does, instead of
   * printing the same note three times over.
   */
  const rows = [];
  for (let n = RADIUS; n >= -RADIUS; n--) {
    const midi = n === 0 ? value : reach(value, n);
    const previous = n === 0 ? null : reach(value, n > 0 ? n - 1 : n + 1);
    rows.push({ at: n, midi: midi === previous ? null : midi });
  }

  return (
    <div className="dial" style={{ '--dial-step': `${DIAL_STEP_PX}px` } as CSSProperties}>
      <div
        ref={dial.ref}
        className={`dial__window ${dial.turning ? 'is-turning' : ''}`}
        style={{ height: `calc(var(--dial-step) * ${RADIUS * 2 + 1})` }}
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={name(value)}
        {...dial.handlers}
      >
        <div className="dial__drum" style={{ transform: `translateY(${dial.offset}px)` }}>
          {rows.map((row) => (
            <span
              key={row.at}
              className={`dial__note ${row.at === 0 ? 'is-chosen' : ''}`}
              aria-hidden="true"
            >
              {row.midi === null ? '' : name(row.midi)}
            </span>
          ))}
        </div>
        <span className="dial__detent" aria-hidden="true" />
      </div>
      <span className="dial__label muted">{label}</span>
    </div>
  );
}
