/**
 * Choosing runs of bars: the rules, with no screen around them.
 *
 * Its own module because it is the part of the picker with decisions in it,
 * and because the picker cannot be driven where it matters — a canvas has no
 * geometry in a test environment, so nothing there can work out which bar a
 * tap landed on. Asked directly, these are ordinary functions.
 */

import type { BarSpan } from '../import/part';

/** Bars in a run, counting both ends. */
export function lengthOf(span: BarSpan): number {
  return span.to - span.from + 1;
}

/** What a selection holds after a bar is tapped: the runs, and any pending start. */
export interface Selection {
  spans: BarSpan[];
  /**
   * The first tap of a run, waiting for its second.
   *
   * Its own field rather than a one-bar span, because a run of one bar is a
   * legitimate thing to choose and the two have to look different: this one is
   * a question half asked.
   */
  anchor: number | null;
}

/**
 * A tap on a bar, applied.
 *
 * Pulled out of the component and exported because it is the part with rules
 * in it, and the component around it cannot be tested where it matters: a
 * canvas in the test environment has no geometry, so nothing can work out
 * which bar a tap landed on. This can be asked directly.
 */
export function tapBar(selection: Selection, bar: number): Selection {
  // A tap inside a chosen run takes it out. Nothing else would undo it: a
  // remove control beside every bar is more furniture than a phone has room
  // for, and clearing the lot to drop one run is not undoing, it is starting
  // again.
  const existing = selection.spans.findIndex((span) => bar >= span.from && bar <= span.to);
  if (existing !== -1) {
    return {
      spans: selection.spans.filter((_, index) => index !== existing),
      anchor: null,
    };
  }

  if (selection.anchor === null) return { spans: selection.spans, anchor: bar };

  const from = Math.min(selection.anchor, bar);
  const to = Math.max(selection.anchor, bar);
  return {
    // A run that swallows runs already chosen replaces them, rather than
    // leaving the same bar in the selection twice over.
    spans: [
      ...selection.spans.filter((span) => span.to < from || span.from > to),
      { from, to },
    ].sort((a, b) => a.from - b.from),
    anchor: null,
  };
}
