/**
 * Multi-bar rests, and what the rest of the app has to know about them.
 *
 * A multi-bar rest is one object covering several bars — the thick bar with a
 * count over it. Brass band parts are made of them, and a tuba part more than
 * most: twenty bars off is a normal thing to be asked to count.
 *
 * It is deliberately **not** expanded into that many bars of silence. The
 * count is the notation; a player reads "20" and counts, and twenty bars of
 * semibreve rests written out is not something any publisher prints or any
 * player wants to scroll past. That leaves three things true of the span which
 * every consumer has to agree about, and which is why they are answered here
 * rather than worked out again in each renderer:
 *
 *  - **No bar lines are drawn inside it.** An engraved multi-bar rest has a
 *    line at each end and nothing between; the count says how many bars are in
 *    there, so drawing nineteen bar lines would both contradict it and be
 *    unreadable.
 *  - **It gets one column, not one per bar.** Its width on the page is a
 *    property of the symbol, not of how long it lasts — a forty-bar rest is
 *    not twice as wide as a twenty-bar one.
 *  - **A system may not break inside it.** It is a single symbol; half of one
 *    at the end of a line means nothing.
 *
 * The bars still *exist* and are still counted: bar numbers run through a
 * multi-bar rest exactly as they do through played music, which is the whole
 * point of counting one.
 */

import { barAt, beatOfBar, type MetreChange } from '../domain/metre';
import type { Exercise, RestEvent } from './types';

/** A multi-bar rest, located in both bars and beats. */
export interface MultiRestSpan {
  /** First bar it covers. */
  fromBar: number;
  /** One past the last bar it covers. */
  toBar: number;
  fromBeat: number;
  toBeat: number;
  /** How many bars, which is the number printed over it. */
  bars: number;
}

/** Whether a rest is a multi-bar one rather than an ordinary rest. */
export function isMultiRest(rest: RestEvent): boolean {
  return (rest.bars ?? 1) > 1;
}

/**
 * Every multi-bar rest in the exercise, in beat order.
 *
 * Empty for everything the generator makes, which is why the cost of asking is
 * a loop over a list that is nearly always empty.
 */
export function multiRestSpans(exercise: Exercise): MultiRestSpan[] {
  const spans: MultiRestSpan[] = [];
  for (const rest of exercise.rests) {
    if (!isMultiRest(rest)) continue;
    const bars = rest.bars as number;
    const fromBar = barAt(exercise.metres, rest.startBeat);
    const toBar = fromBar + bars;
    spans.push({
      fromBar,
      toBar,
      fromBeat: beatOfBar(exercise.metres, fromBar),
      toBeat: beatOfBar(exercise.metres, toBar),
      bars,
    });
  }
  return spans.sort((a, b) => a.fromBeat - b.fromBeat);
}

/**
 * Whether a bar line at this beat falls *inside* a multi-bar rest, and so is
 * not drawn.
 *
 * The lines at the two ends are drawn — they are the rest's own edges. Only
 * the ones between are suppressed.
 */
export function insideMultiRest(spans: readonly MultiRestSpan[], beat: number): boolean {
  return spans.some((s) => beat > s.fromBeat + 1e-9 && beat < s.toBeat - 1e-9);
}

/**
 * The span a bar falls inside, or null.
 *
 * Used where a walk over bars has to step over a whole rest rather than into
 * it — laying out systems, and deciding how many bars fit on a line.
 */
export function spanAtBar(
  spans: readonly MultiRestSpan[],
  bar: number,
): MultiRestSpan | null {
  return spans.find((s) => bar > s.fromBar && bar < s.toBar) ?? null;
}

/**
 * The next bar a system may start on, at or after `bar`.
 *
 * A line break inside a multi-bar rest would leave half a symbol hanging at the
 * end of it, so a break landing there is pushed to the far side.
 */
export function nextBreakableBar(spans: readonly MultiRestSpan[], bar: number): number {
  const span = spanAtBar(spans, bar);
  return span ? span.toBar : bar;
}

/**
 * Bar lines that a multi-bar rest removes, as a set of beats.
 *
 * For the spacing, which needs to know which bar starts do *not* get a column
 * of their own.
 */
export function suppressedBarLines(
  metres: readonly MetreChange[],
  spans: readonly MultiRestSpan[],
): Set<number> {
  const beats = new Set<number>();
  for (const span of spans) {
    for (let bar = span.fromBar + 1; bar < span.toBar; bar++) {
      beats.add(beatOfBar(metres, bar));
    }
  }
  return beats;
}
