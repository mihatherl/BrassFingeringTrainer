/**
 * Choosing which bars of a part to practise.
 *
 * The part is drawn as it is printed — repeats shown once, in the order they
 * sit on the page — because bars are chosen off the page. A player looking for
 * "the awkward bit at 33" is looking at their own printed part, and a view that
 * had already unfolded the repeats would number its bars differently from the
 * paper on the stand.
 *
 * Selecting is two taps: one on the first bar of a run, one on the last. A
 * third run can be added, and a fourth, and they are played one after another
 * with a bar of rests between. Tapping inside a run that is already chosen
 * takes it out again, which is the only way to undo something on a screen with
 * no room for a control beside every bar.
 *
 * The drawing is `render/review.ts`, which already lays a whole exercise out
 * into wrapped, justified systems and knows where every bar landed. Nothing
 * about a score view is different from the marked review except what is washed
 * behind the bars, so it would have been a poor thing to build twice.
 */

import { useCallback, useMemo, useState } from 'react';
import { barAtPoint, barRects, drawReview, planReview, scanningSpace } from '../render/review';
import type { BarSpan, ImportedBar } from '../import/part';
import type { Exercise } from '../exercise/types';
import { lengthOf, tapBar } from './selection';
import { StaveCanvas } from './StaveCanvas';

interface ScorePickerProps {
  /** The part as printed, which is what is drawn and what bars are counted in. */
  exercise: Exercise;
  /** One entry per bar of `exercise`, carrying its printed number. */
  bars: ImportedBar[];
  /** The player's chosen runs, in printed bar indices. */
  onPractise: (spans: BarSpan[]) => void;
  onBack: () => void;
  /** What the piece is called, for the heading. */
  title: string;
}

export function ScorePicker({ exercise, bars, onPractise, onBack, title }: ScorePickerProps) {
  const [spans, setSpans] = useState<BarSpan[]>([]);
  /**
   * The first tap of a run, waiting for its second.
   *
   * Its own state rather than a one-bar span, because a run of one bar is a
   * legitimate thing to choose and the two have to look different: this one is
   * a question half asked.
   */
  const [anchor, setAnchor] = useState<number | null>(null);

  const spanAt = useCallback(
    (bar: number) => spans.findIndex((span) => bar >= span.from && bar <= span.to),
    [spans],
  );

  const pickBar = useCallback(
    (bar: number) => {
      const next = tapBar({ spans, anchor }, bar);
      setSpans(next.spans);
      setAnchor(next.anchor);
    },
    [anchor, spans],
  );

  const draw = useCallback(
    (canvas: HTMLCanvasElement, theme: Parameters<typeof drawReview>[1]['theme']) => {
      drawReview(canvas, {
        exercise,
        staveSpace: scanningSpace(canvas.getBoundingClientRect().width),
        // Nothing has been played, so nothing is marked. The wash is the only
        // thing this view adds to the page.
        verdicts: [],
        theme,
        shade: (bar) => {
          if (spanAt(bar) !== -1) return theme.selection;
          if (bar === anchor) return theme.selectionPending;
          return null;
        },
      });
    },
    [exercise, spanAt, anchor],
  );

  const onPick = useCallback(
    (x: number, y: number, canvas: HTMLCanvasElement) => {
      // Planned again rather than remembered from the draw: the width is the
      // only input, and a layout held in state would be the stale one every
      // time the screen was resized between a draw and a tap.
      const width = canvas.getBoundingClientRect().width;
      const layout = planReview(width, exercise, scanningSpace(width));
      const bar = barAtPoint(barRects(exercise, layout), x, y);
      if (bar !== null) pickBar(bar);
    },
    [exercise, pickBar],
  );

  const chosen = useMemo(() => spans.reduce((sum, span) => sum + lengthOf(span), 0), [spans]);

  /** A run named the way the printed part names it: "17–24", or "17" alone. */
  const nameOf = (span: BarSpan) => {
    const from = bars[span.from]?.number ?? String(span.from + 1);
    const to = bars[span.to]?.number ?? String(span.to + 1);
    return from === to ? from : `${from}–${to}`;
  };

  return (
    <div className="screen screen--import">
      <header className="masthead">
        <h1>{title}</h1>
      </header>

      <StaveCanvas
        className="score-picker"
        draw={draw}
        onPick={onPick}
        label="The part, as printed. Tap a bar to choose it."
      />

      <div className="actions actions--sticky">
        {/*
          One line, always, whatever state the selection is in.

          It says what to do, then what you have chosen — and it is here rather
          than above the score for two reasons. Under the score it sat behind
          this very strip, so the one piece of confirmation on the screen was
          the one thing you could not see. And a line that comes and goes
          changes the height of a *fixed* strip, which pushes the page around
          and can bring in a scrollbar; the score is laid out against the width
          that scrollbar takes, so every selection nudged the whole thing.

          Named in the printed numbers, because that is what the player checks
          against the part on the stand.
        */}
        <p className="field__note picker__status">
          {spans.length > 0 ? (
            <>
              {spans.length === 1 && lengthOf(spans[0]) === 1 ? 'Bar ' : 'Bars '}
              {spans.map(nameOf).join(', ')}
              {chosen > 1 && ` — ${chosen} in all`}
            </>
          ) : anchor === null ? (
            'Tap the first bar of a run, then the last.'
          ) : (
            `Bar ${bars[anchor]?.number ?? anchor + 1} — now tap the last bar.`
          )}
        </p>
        <button
          type="button"
          className="button button--primary button--large"
          disabled={spans.length === 0}
          onClick={() => onPractise(spans)}
        >
          {spans.length === 0
            ? 'Choose some bars'
            : `Practise ${chosen} ${chosen === 1 ? 'bar' : 'bars'}`}
        </button>
        {/* Always here, disabled when there is nothing to clear. Coming and
            going would change the height of the strip, which is the thing that
            was moving the score. */}
        <button
          type="button"
          className="button"
          disabled={spans.length === 0 && anchor === null}
          onClick={() => {
            setSpans([]);
            setAnchor(null);
          }}
        >
          Start again
        </button>
        <button type="button" className="button button--quiet" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
