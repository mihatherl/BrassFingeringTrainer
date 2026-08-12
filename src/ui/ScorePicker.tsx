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
import { barAtPoint, barRects, drawReview, planReview } from '../render/review';
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

/**
 * How large to draw a stave here, against the reading size the review uses.
 *
 * Measured on the committed fixture, forty-two bars on a 390px phone: at the
 * review's own size that is **29 systems and 4324 pixels**, eleven screens of
 * scrolling to find bar 33. At this size it is eleven systems and about a
 * screen and a half, which is a piece you can take in.
 *
 * Not smaller, and the floor is why: a bar has to stay a comfortable thing to
 * hit with a thumb. At this scale a bar on a phone is around ninety pixels
 * wide and a system seventy tall, which is roomier than most buttons.
 */
function scoreSpace(width: number): number {
  return Math.min(9, Math.max(5, width / 60));
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
        staveSpace: scoreSpace(canvas.getBoundingClientRect().width),
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
      const layout = planReview(width, exercise, scoreSpace(width));
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

      <p className="field__note muted">
        {anchor === null
          ? 'Tap the first bar of a run, then the last. Add as many runs as you like.'
          : `Bar ${bars[anchor]?.number ?? anchor + 1} — now tap the last bar of the run.`}
      </p>

      <StaveCanvas
        className="score-picker"
        draw={draw}
        onPick={onPick}
        label="The part, as printed. Tap a bar to choose it."
      />

      <div className="actions actions--sticky">
        {spans.length > 0 && (
          /*
           * With the button rather than under the score, and that is not a
           * detail: under the score it sat behind this very strip, so the one
           * line saying what you had chosen was the one line you could not see.
           *
           * Named in the printed numbers, because that is what the player
           * checks against the part on the stand.
           */
          <p className="field__note">
            {spans.length === 1 && lengthOf(spans[0]) === 1 ? 'Bar ' : 'Bars '}
            {spans.map(nameOf).join(', ')}
            {chosen > 1 && ` — ${chosen} in all`}
          </p>
        )}
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
        {spans.length > 0 && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setSpans([]);
              setAnchor(null);
            }}
          >
            Start again
          </button>
        )}
        <button type="button" className="button button--quiet" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
