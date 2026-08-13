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
 * for the two extremes, and a wheel for a mouse.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { detentClick } from '../audio/tick';
import { stepOnLadder } from '../domain/ladder';

/** Height of one detent, in CSS pixels. The CSS reads it back as a variable. */
export const DIAL_STEP_PX = 30;

/** How many notes are shown either side of the chosen one. */
const RADIUS = 2;

/** Wheel travel that amounts to one detent. */
const WHEEL_STEP = 24;

/** How far past the last reachable note the drum will give, and how slackly. */
const RUBBER = 0.25;

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
  const windowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; y: number; from: number } | null>(null);
  const wheel = useRef(0);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  /*
   * The last note this dial asked for.
   *
   * A finger produces pointer moves faster than React re-renders, so two of
   * them can arrive against the same `value` — and without this, crossing one
   * detent would report itself twice and click twice. Reset whenever the prop
   * moves, which is the parent agreeing with what was asked for.
   */
  const asked = useRef(value);
  const seen = useRef(value);
  if (seen.current !== value) {
    seen.current = value;
    asked.current = value;
  }

  /** Where `delta` steps from `from` lands, without passing either bound. */
  const reach = (from: number, delta: number): number =>
    Math.min(max, Math.max(min, stepOnLadder(values, from, delta)));

  const settle = (next: number) => {
    if (next === value || next === asked.current) return;
    asked.current = next;
    onChange(next);
    detentClick();
  };

  const move = (delta: number) => settle(reach(value, delta));

  /*
   * A wheel listener of its own, because React's is passive and a passive
   * listener cannot stop the page scrolling underneath the dial being turned.
   * The handler is reached through a ref so the listener is bound once and
   * still sees the note the dial is on now.
   */
  const spin = useRef(move);
  spin.current = move;

  useEffect(() => {
    const element = windowRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      wheel.current += event.deltaY;
      let steps = 0;
      while (wheel.current <= -WHEEL_STEP) {
        wheel.current += WHEEL_STEP;
        steps += 1;
      }
      while (wheel.current >= WHEEL_STEP) {
        wheel.current -= WHEEL_STEP;
        steps -= 1;
      }
      if (steps !== 0) spin.current(steps);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button > 0) return;
    // Optional because capture is what keeps a drag alive when the finger
    // leaves the window, not what makes it work: where it is missing the dial
    // simply stops at the edge instead of failing to start.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, y: event.clientY, from: value };
    setDragging(true);
    setOffset(0);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held || held.pointerId !== event.pointerId) return;

    // Upwards is a higher note, which is the direction the stave already says.
    const travel = held.y - event.clientY;
    const steps = Math.round(travel / DIAL_STEP_PX);
    const next = reach(held.from, steps);
    settle(next);

    // Between two detents the drum follows the finger; past the last one it
    // resists, so the end of the compass is felt rather than merely obeyed.
    const residual = travel - steps * DIAL_STEP_PX;
    const stuck = reach(held.from, steps + (travel >= 0 ? 1 : -1)) === next;
    setOffset(
      stuck
        ? Math.max(-DIAL_STEP_PX, Math.min(DIAL_STEP_PX, travel * RUBBER))
        : residual,
    );
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    drag.current = null;
    setDragging(false);
    setOffset(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
      PageUp: PAGE_STEPS,
      PageDown: -PAGE_STEPS,
    };

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      settle(event.key === 'Home' ? min : max);
      return;
    }
    const delta = steps[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    move(delta);
  };

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
        ref={windowRef}
        className={`dial__window ${dragging ? 'is-turning' : ''}`}
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={name(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div className="dial__drum" style={{ transform: `translateY(${offset}px)` }}>
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
