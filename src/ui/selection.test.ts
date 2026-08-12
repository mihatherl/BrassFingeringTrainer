import { describe, expect, it } from 'vitest';
import { tapBar, type Selection } from './selection';

/**
 * Choosing runs of bars, two taps at a time.
 *
 * The rules and not the screen: a canvas has no geometry in this environment,
 * so nothing here could work out which bar a tap landed on. What is worth
 * pinning is what a tap *means* once the bar is known, and that is all here.
 */

const nothing: Selection = { spans: [], anchor: null };

/** Taps in order, from an empty selection. */
function taps(...bars: number[]): Selection {
  return bars.reduce(tapBar, nothing);
}

describe('choosing bars to practise', () => {
  it('takes two taps to make a run', () => {
    // The first is a question half asked, and looks different on the page —
    // which is why it is held apart from the runs rather than as a run of one.
    expect(taps(4)).toEqual({ spans: [], anchor: 4 });
    expect(taps(4, 7)).toEqual({ spans: [{ from: 4, to: 7 }], anchor: null });
  });

  it('reads a run backwards as readily as forwards', () => {
    // Tapping the last bar first is not a mistake to correct, it is the same
    // run chosen from the other end.
    expect(taps(7, 4).spans).toEqual([{ from: 4, to: 7 }]);
  });

  it('lets a single bar be a run of its own', () => {
    expect(taps(9, 9).spans).toEqual([{ from: 9, to: 9 }]);
  });

  it('keeps several runs, in the order they are played', () => {
    // Sorted by where they sit in the piece rather than by when they were
    // chosen: that is the order they will be practised in, and the summary
    // line reads as a route through the part.
    const selection = taps(20, 23, 4, 7);
    expect(selection.spans).toEqual([
      { from: 4, to: 7 },
      { from: 20, to: 23 },
    ]);
  });

  it('drops a run when a bar inside it is tapped', () => {
    // The only way to undo one. A remove control beside every bar is more
    // furniture than a phone has room for.
    const selection = tapBar(taps(4, 7, 20, 23), 5);
    expect(selection.spans).toEqual([{ from: 20, to: 23 }]);
    expect(selection.anchor).toBeNull();
  });

  it('drops a run tapped at either of its ends', () => {
    expect(tapBar(taps(4, 7), 4).spans).toEqual([]);
    expect(tapBar(taps(4, 7), 7).spans).toEqual([]);
  });

  it('forgets a half-made run when an existing one is dropped', () => {
    /*
     * Otherwise the pending tap would silently pair with whatever was tapped
     * next, and a player who meant to remove a run would find they had made a
     * new one reaching back to wherever they had started.
     */
    const selection = tapBar({ spans: [{ from: 4, to: 7 }], anchor: 30 }, 5);
    expect(selection.anchor).toBeNull();
    expect(selection.spans).toEqual([]);
  });

  it('replaces the runs a wider one swallows', () => {
    // Rather than leaving the same bar in the selection twice, which would
    // practise it twice and count it twice.
    const selection = tapBar(tapBar(taps(10, 12, 20, 22), 8), 30);
    expect(selection.spans).toEqual([{ from: 8, to: 30 }]);
  });

  it('keeps a run that only reaches up to another', () => {
    // Abutting is not overlapping: 4–7 and 8–11 are two runs, and joining them
    // would silently drop the bar of rests the player put between them.
    const selection = tapBar(tapBar(taps(8, 11), 4), 7);
    expect(selection.spans).toEqual([
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
  });
});
