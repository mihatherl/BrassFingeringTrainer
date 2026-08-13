// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { instrumentById } from '../domain/instruments';
import { parseMusicXml } from '../import/musicxml';
import { importPart, type BarSpan, type ImportedBar } from '../import/part';
import type { Exercise } from '../exercise/types';
import { barRects, planReview, scanningSpace } from '../render/review';
import { ScorePicker } from './ScorePicker';

/**
 * A tap on the score, from the pixel to the bar.
 *
 * The one step of this feature nothing covered, and four bugs in a row lived in
 * it — every one a quantity measured in one unit and consumed as another. What
 * was tested was each end: that the rectangles line up with the bar lines the
 * drawing puts down, and that a bar index becomes the right measures. The join
 * between them was only ever checked by a person driving a browser.
 *
 * A canvas has no geometry here, so it is given some: a rectangle at an offset
 * from the corner of the page, which is also what makes this worth writing.
 * The offset catches a tap read in page coordinates instead of the canvas's
 * own, which is a fault no amount of correct arithmetic downstream would save.
 *
 * What this cannot see is whether the ink lands where the rectangles say —
 * `review.test.ts` holds that end, against the bar lines actually drawn.
 */

afterEach(cleanup);

const WIDTH = 640;
/** Deliberately not at the origin; see above. */
const OFFSET = { left: 37, top: 91 };

/** Enough plain bars that they wrap: several to a line, and several lines. */
function printedPart(): { exercise: Exercise; bars: ImportedBar[] } {
  const note = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration></note>';
  const attributes =
    '<attributes><divisions>2</divisions><key><fifths>0</fifths></key>' +
    '<time><beats>4</beats><beat-type>4</beat-type></time>' +
    '<clef><sign>G</sign><line>2</line></clef></attributes>';
  const measures = Array.from(
    { length: 24 },
    (_, index) => `<measure number="${index + 1}">${index === 0 ? attributes : ''}${note}</measure>`,
  ).join('');
  const parsed = parseMusicXml(
    `<score-partwise version="4.0"><part-list><score-part id="P1"/></part-list>` +
      `<part id="P1">${measures}</part></score-partwise>`,
  );
  if ('problem' in parsed) throw new Error(parsed.problem);

  const { exercise, bars } = importPart(parsed.doc, {
    instrument: instrumentById('eb-bass'),
    reading: { kind: 'printed' },
  });
  return { exercise: exercise!, bars };
}

function show(onPractise: (spans: BarSpan[]) => void = () => undefined) {
  const { exercise, bars } = printedPart();
  render(
    <ScorePicker
      exercise={exercise}
      bars={bars}
      title="Test Piece"
      onPractise={onPractise}
      onBack={() => undefined}
    />,
  );

  const canvas = document.querySelector('.score-picker canvas') as HTMLCanvasElement;
  canvas.getBoundingClientRect = () =>
    ({ width: WIDTH, height: 500, left: OFFSET.left, top: OFFSET.top, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  const rects = barRects(exercise, planReview(WIDTH, exercise, scanningSpace(WIDTH)));

  /** Taps the middle of a bar, in page coordinates as a real pointer would. */
  const tap = (bar: number) => {
    const rect = rects[bar];
    fireEvent.click(canvas, {
      clientX: OFFSET.left + rect.x + rect.width / 2,
      clientY: OFFSET.top + rect.y + rect.height / 2,
    });
  };

  const status = () => document.querySelector('.picker__status')?.textContent ?? '';
  return { tap, status, rects, bars };
}

describe('tapping the score', () => {
  it('picks the bar under the pointer', () => {
    const { tap, status } = show();
    tap(2);
    // Named as the page names it: the third bar drawn is the one printed 3.
    expect(status()).toContain('Bar 3');
  });

  it('picks the right bar on a later line, not the first one', () => {
    /*
     * The assertion that costs a layout mistake its cover. Every bar of the
     * first system sits at a small y, so a hit-test that ignored the vertical
     * would still answer plausibly there and be wrong everywhere below.
     */
    const { tap, status, rects } = show();
    const onSecondLine = rects.findIndex((rect) => rect.y > 0);
    expect(onSecondLine).toBeGreaterThan(0);

    tap(onSecondLine);
    expect(status()).toContain(`Bar ${onSecondLine + 1} `);
  });

  it('reads the tap against the canvas, not the page', () => {
    // With the offset ignored, this tap lands a long way from where it was
    // aimed — far enough to be a different bar, and off the music entirely at
    // the top of the score.
    const { tap, status } = show();
    tap(0);
    expect(status()).toContain('Bar 1 ');
  });

  it('turns two taps into a run, and hands back the bars tapped', () => {
    let given: BarSpan[] | null = null;
    const { tap } = show((spans) => (given = spans));

    tap(1);
    tap(4);
    fireEvent.click(screen.getByRole('button', { name: /Practise/ }));

    expect(given).toEqual([{ from: 1, to: 4 }]);
  });

  it('says how many bars are in hand, in the printed numbers', () => {
    const { tap, status } = show();
    tap(1);
    tap(3);
    expect(status()).toBe('Bars 2–4 — 3 in all');
  });

  it('ignores a tap below the music', () => {
    // Where a short piece leaves room under the last system. Nothing is chosen
    // and nothing is half-chosen, so the instruction still stands.
    const { status } = show();
    const canvas = document.querySelector('.score-picker canvas') as HTMLCanvasElement;
    fireEvent.click(canvas, { clientX: OFFSET.left + 100, clientY: OFFSET.top + 5000 });
    expect(status()).toBe('Tap the first bar of a run, then the last.');
  });
});
