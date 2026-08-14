/**
 * Turning a dial with a finger: the gesture, without any opinion about what is
 * being turned or how it looks.
 *
 * Three controls in this app are dials — the range picker's notes, the play
 * screen's tempo and its key — and they share nothing but this. What they do
 * share is the whole of the feel, which is worth having in one place: a finger
 * travelling a fixed distance to each detent, a click and a tap of the hand as
 * each one passes, resistance rather than silence at the ends, and a keyboard
 * and a mouse wheel for anyone not using a finger at all.
 *
 * What the caller supplies is `resolve`: where so many detents from a starting
 * value lands, already clamped to whatever the caller's own limits are. Steps
 * of a scale, whole numbers of beats per minute — this never needs to know.
 *
 * A caller may also ask to be told when the finger comes *off*, separately from
 * every detent it crossed on the way. See `onCommit`, which exists because a
 * key change rewrites the music and a tempo change does not.
 */

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { detentClick } from '../audio/tick';

/** Wheel travel that amounts to one detent. */
const WHEEL_STEP = 24;

/** How far past the last reachable value the face will give, and how slackly. */
const RUBBER = 0.25;

export interface DialOptions<T extends number> {
  /** The value now. */
  value: T;
  /** Where `delta` detents from `from` lands, clamped to the caller's limits. */
  resolve: (from: T, delta: number) => T;
  onChange: (next: T) => void;
  /**
   * Called with the value the dial was let go on, where the caller wants the
   * turning and the acting kept apart.
   *
   * `onChange` still fires at every detent, so the face and the callout follow
   * the finger as they always did; this fires once, at the end. For a dial whose
   * change is cheap — the tempo — it is not wanted and not passed. For one whose
   * change rewrites the music, it is the difference between reading the key the
   * player chose and reading every key they passed through on the way to it.
   *
   * Keyboard and wheel have no release to wait for, so they commit as they go.
   * A page key is one press and commits once, which is the same bargain.
   */
  onCommit?: (value: T) => void;
  /** Travel to a detent, in CSS pixels. */
  stepPx: number;
  /** Detents a page key moves; page keys do nothing without it. */
  pageStep?: number;
  /** Where Home and End go; they do nothing without it. */
  ends?: { min: T; max: T };
}

export interface Dial {
  /** Pixels the face has been dragged since the last detent, for the drawing. */
  offset: number;
  /** True while a finger is on it, so a transition can be suspended. */
  turning: boolean;
  /** The element that is grabbed; the wheel listener needs it directly. */
  ref: RefObject<HTMLDivElement | null>;
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  };
}

export function useDial<T extends number>(options: DialOptions<T>): Dial {
  const { value, resolve, onChange, onCommit, stepPx, pageStep, ends } = options;

  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; y: number; from: T } | null>(null);
  const wheel = useRef(0);
  const [offset, setOffset] = useState(0);
  const [turning, setTurning] = useState(false);

  /*
   * The last value this dial asked for.
   *
   * A finger produces pointer moves faster than React re-renders, so two of
   * them can arrive against the same `value` — and without this, crossing one
   * detent would report itself twice and click twice. Reset whenever the prop
   * moves, which is the parent agreeing with what was asked for.
   */
  const asked = useRef<T>(value);
  const seen = useRef<T>(value);
  if (seen.current !== value) {
    seen.current = value;
    asked.current = value;
  }

  const settle = (next: T): boolean => {
    if (next === value || next === asked.current) return false;
    asked.current = next;
    onChange(next);
    detentClick();
    return true;
  };

  /*
   * A keypress or a wheel notch is its own gesture, over as soon as it happens,
   * so it settles and commits together. Only a finger has a middle.
   */
  const move = (delta: number) => {
    const next = resolve(value, delta);
    if (settle(next)) onCommit?.(next);
  };

  /*
   * A wheel listener of its own, because React's is passive and a passive
   * listener cannot stop the page scrolling underneath the dial being turned.
   * The handler is reached through a ref so the listener is bound once and
   * still sees the value the dial is on now.
   */
  const spin = useRef(move);
  spin.current = move;

  useEffect(() => {
    const element = ref.current;
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

  return {
    offset,
    turning,
    ref,
    handlers: {
      onPointerDown(event) {
        if (event.button > 0) return;
        // Optional because capture is what keeps a drag alive when the finger
        // leaves the control, not what makes it work: where it is missing the
        // dial simply stops at the edge instead of failing to start.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { pointerId: event.pointerId, y: event.clientY, from: value };
        setTurning(true);
        setOffset(0);
      },

      onPointerMove(event) {
        const held = drag.current;
        if (!held || held.pointerId !== event.pointerId) return;

        // Upwards is more — a higher note, a faster tempo.
        const travel = held.y - event.clientY;
        const steps = Math.round(travel / stepPx);
        const next = resolve(held.from, steps);
        settle(next);

        // Between two detents the face follows the finger; past the last one it
        // resists, so the end of the range is felt rather than merely obeyed.
        const residual = travel - steps * stepPx;
        const stuck = resolve(held.from, steps + (travel >= 0 ? 1 : -1)) === next;
        setOffset(
          stuck ? Math.max(-stepPx, Math.min(stepPx, travel * RUBBER)) : residual,
        );
      },

      onPointerUp(event) {
        const held = drag.current;
        if (held?.pointerId !== event.pointerId) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        drag.current = null;
        setTurning(false);
        setOffset(0);
        // Against where the finger went down, not against the last detent it
        // crossed: a turn that wandered away and came back has chosen the key it
        // started in, and rewriting the music to the key it is already in would
        // be work nobody asked for.
        if (asked.current !== held.from) onCommit?.(asked.current);
      },

      onPointerCancel(event) {
        const held = drag.current;
        if (held?.pointerId !== event.pointerId) return;
        drag.current = null;
        setTurning(false);
        setOffset(0);
        // Committed like a release rather than dropped. The detents have clicked
        // and the face has moved, so the player has already been told the dial is
        // where it is; leaving the music behind that would be the worse lie.
        if (asked.current !== held.from) onCommit?.(asked.current);
      },

      onKeyDown(event) {
        const steps: Record<string, number> = {
          ArrowUp: 1,
          ArrowRight: 1,
          ArrowDown: -1,
          ArrowLeft: -1,
          ...(pageStep === undefined ? {} : { PageUp: pageStep, PageDown: -pageStep }),
        };

        if (ends && (event.key === 'Home' || event.key === 'End')) {
          event.preventDefault();
          const end = event.key === 'Home' ? ends.min : ends.max;
          if (settle(end)) onCommit?.(end);
          return;
        }
        const delta = steps[event.key];
        if (delta === undefined) return;
        event.preventDefault();
        move(delta);
      },
    },
  };
}
