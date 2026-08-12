/**
 * The exercise, drawn again, marked.
 *
 * Nothing during play can teach a fingering. The player is reading ahead, and
 * anything asking to be studied in the moment is asking them to stop reading.
 * So the teaching goes here instead, where there is no music to keep up with:
 * every note in the colour of its verdict, and under each one that went wrong,
 * what should have been held.
 *
 * Only the mistakes are annotated. A fingering under every note would be a wall
 * of digits to search rather than an answer to find.
 *
 * Static, so unlike the play surface this wraps onto as many systems as the
 * music needs and hands back the height it used.
 */

import { formatMask } from '../domain/fingering';
import { widestKey } from '../domain/keys';
import { barCount, beatOfBar } from '../domain/metre';
import type { Verdict } from '../engine/judge';
import { isTieContinuation } from '../exercise/ties';
import type { Exercise } from '../exercise/types';
import { accidentalRoom, dotRoom, noteheadWidth } from './notes';
import { engraveSpacing, NOTE_CLEARANCE, type Spacing } from './spacing';
import { measureStaveHeader, staveMetrics } from './stave';
import { BAR_LINE_SETBACK, drawSystem, justifiedX, signatureChangeRoom, signatureChangesIn } from './system';
import { verdictColour, type StaveTheme } from './surface';

/**
 * Height of one system in stave spaces.
 *
 * Four for the stave itself, and the rest is what hangs off it: ledger lines
 * and accidentals above, ledger lines and the fingering annotation below.
 */
const SYSTEM_SPACES = 13;

export interface ReviewOptions {
  exercise: Exercise;
  /** Verdict per note index; absent means the exercise stopped before it. */
  verdicts: Array<Verdict | undefined>;
  /**
   * A wash behind a bar, or null for none.
   *
   * Here rather than in the screen that wants it because only this file knows
   * where a bar sits: the same spacing and the same greedy line-filling that
   * decide where a notehead goes decide where its bar begins and ends, and a
   * second implementation of that would drift the first time either changed.
   *
   * Drawn under the stave lines, so the notation reads over it rather than
   * through it.
   */
  shade?: (bar: number) => string | null;
  /** Stave size to draw at. Absent takes the reading size; see `planReview`. */
  staveSpace?: number;
  theme: StaveTheme;
}

/**
 * Draws the marked exercise into `canvas` at its current CSS width, sizing the
 * element's height to fit, and returns that height in CSS pixels.
 */
export function drawReview(canvas: HTMLCanvasElement, options: ReviewOptions): number {
  const ctx = canvas.getContext('2d');
  const width = Math.max(1, canvas.getBoundingClientRect().width);
  const { exercise, theme } = options;

  const layout = planReview(width, exercise, options.staveSpace);
  const height = layout.systems * layout.systemHeight;

  const dpr = window.devicePixelRatio || 1;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  if (!ctx) return height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  // Every wash before any notation, so a bar's shading cannot land on top of
  // the stave lines of the bar beside it where the two rectangles meet.
  if (options.shade) {
    for (const [bar, rect] of barRects(exercise, layout).entries()) {
      const colour = options.shade(bar);
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  for (let system = 0; system < layout.systems; system++) {
    drawReviewSystem(ctx, options, layout, system);
  }

  return height;
}

export interface ReviewLayout {
  staveSpace: number;
  headerWidth: number;
  /** Room a line of music has, once the clef and key signature have had theirs. */
  usableWidth: number;
  spacing: Spacing;
  /** First bar of each system. Systems hold different numbers of bars. */
  systemStarts: number[];
  systems: number;
  systemHeight: number;
}

/**
 * Chooses a scale and decides how the bars divide into systems.
 *
 * Exported for tests: how many bars land on a line is the thing most likely to
 * come out wrong on a narrow screen, and it is not visible from the drawing.
 */
export function planReview(width: number, exercise: Exercise, atSpace?: number): ReviewLayout {
  // Big enough to read the noteheads, small enough that a phone still gets a
  // couple of bars to a line.
  //
  // Overridable because the two screens that draw an exercise standing still
  // want different things from it. The review is read a note at a time, to see
  // what a fingering should have been. A score being chosen from is *scanned* —
  // the player is looking for the awkward eight bars, which means seeing the
  // shape of the piece, and full-size notation puts one bar on a phone's line
  // and forty-two lines under it.
  const staveSpace = atSpace ?? Math.min(18, Math.max(9, width / 34));
  const metrics = staveMetrics(exercise.clef, 0, staveSpace);
  const headerWidth =
    // The widest key reached, so a later system with more accidentals cannot
    // overflow a line whose bars were planned against a narrower one — and the
    // widest signature for the same reason, since a part that turns from 3/4
    // into 12/8 wants the room on every line rather than on the ones after it.
    Math.max(
      ...exercise.metres.map(({ metre }) =>
        measureStaveHeader(metrics, widestKey(exercise.keys), metre.beatsPerBar, metre.beatUnit),
      ),
    ) + staveSpace;

  const head = noteheadWidth(metrics, { value: 'quarter', dotted: false });
  const usable = width - headerWidth - staveSpace * 2;
  const spacing = engraveSpacing(exercise, {
    minColumnWidth: head * NOTE_CLEARANCE,
    maxBarWidth: usable,
    // Accidentals hang in front of their notes and dots behind them; without
    // this a sharp lands on top of whatever precedes it.
    extraWidthFor: (index) => {
      const note = exercise.notes[index];
      return {
        before: note.showAccidental ? accidentalRoom(metrics, note.pitch) : 0,
        after: dotRoom(metrics, note.duration),
      };
    },
    barLineRoom: BAR_LINE_SETBACK * staveSpace,
    // Room for the double bar and new signature at a change of key or metre;
    // nothing anywhere else. See `signatureChangeRoom`.
    signatureRoomAt: (beat) => {
      const change = signatureChangesIn(exercise, 0, Infinity).get(beat);
      return change ? signatureChangeRoom(metrics, change) : 0;
    },
  });

  // Systems are filled greedily, as an engraver fills a line: take bars until
  // the next one will not fit, then break. A line of held notes therefore holds
  // far more bars than a line of semiquavers, which is the whole point.
  const totalBars = barCount(exercise.metres, exercise.totalBeats);
  const systemStarts: number[] = [];
  for (let bar = 0; bar < totalBars; bar += spacing.barsFitting(bar, usable)) {
    systemStarts.push(bar);
  }

  return {
    staveSpace,
    headerWidth,
    usableWidth: usable,
    spacing,
    systemStarts,
    systems: systemStarts.length,
    systemHeight: staveSpace * SYSTEM_SPACES,
  };
}

/** Where a bar sits on the page, in CSS pixels from the canvas's top left. */
export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Every bar's place on the drawn page.
 *
 * What a screen needs to turn a tap into a bar, and the reason it lives here:
 * the layout is not a grid. Systems are filled greedily, so a line of held
 * notes carries far more bars than a line of semiquavers, and every line but
 * the last is justified to the margin. Nothing outside this file can work out
 * where bar 23 is without repeating all of that.
 *
 * A bar runs from its own first beat to the next bar's, except at the end of a
 * system, where it runs to the margin — otherwise the last bar of a line would
 * be a sliver and the gap after it would belong to nobody.
 */
export function barRects(exercise: Exercise, layout: ReviewLayout): BarRect[] {
  const { spacing, systemStarts, headerWidth, usableWidth, systemHeight } = layout;
  const totalBars = barCount(exercise.metres, exercise.totalBeats);
  const rects: BarRect[] = [];

  for (let system = 0; system < systemStarts.length; system++) {
    const firstBar = systemStarts[system];
    const lastBar = systemStarts[system + 1] ?? totalBars;
    const final = lastBar >= totalBars;
    const xForBeat = justifiedX(
      spacing,
      beatOfBar(exercise.metres, firstBar),
      Math.min(exercise.totalBeats, beatOfBar(exercise.metres, lastBar)),
      headerWidth,
      usableWidth,
      !final,
    );

    for (let bar = firstBar; bar < lastBar; bar++) {
      // The first bar of a line takes the header with it: a tap on the clef is
      // a tap on the bar it belongs to, not on nothing.
      const left = bar === firstBar ? 0 : xForBeat(beatOfBar(exercise.metres, bar));
      const nextBeat = Math.min(exercise.totalBeats, beatOfBar(exercise.metres, bar + 1));
      const right = bar + 1 >= lastBar ? headerWidth + usableWidth : xForBeat(nextBeat);
      rects.push({
        x: left,
        y: system * systemHeight,
        width: Math.max(0, right - left),
        height: systemHeight,
      });
    }
  }
  return rects;
}

/** Which bar a point falls in, or null where it falls outside every one. */
export function barAtPoint(rects: readonly BarRect[], x: number, y: number): number | null {
  const found = rects.findIndex(
    (rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height,
  );
  return found === -1 ? null : found;
}

function drawReviewSystem(
  ctx: CanvasRenderingContext2D,
  options: ReviewOptions,
  layout: ReviewLayout,
  system: number,
): void {
  const { exercise, verdicts, theme } = options;
  const { staveSpace, headerWidth, spacing, systemStarts } = layout;
  const totalBars = barCount(exercise.metres, exercise.totalBeats);

  // Three and a half spaces of clearance above the stave for ledger lines and
  // accidentals; the annotation gets what is left underneath.
  const topLineY = system * layout.systemHeight + staveSpace * 3.5;
  const lastBar = systemStarts[system + 1] ?? totalBars;

  const firstBar = systemStarts[system];
  const final = lastBar >= totalBars;

  drawSystem(ctx, {
    exercise,
    metrics: staveMetrics(exercise.clef, topLineY, staveSpace),
    // Every line justified to the margin, bar the last — see `justifiedX`.
    xForBeat: justifiedX(
      spacing,
      beatOfBar(exercise.metres, firstBar),
      Math.min(exercise.totalBeats, beatOfBar(exercise.metres, lastBar)),
      headerWidth,
      layout.usableWidth,
      !final,
    ),
    firstBar,
    lastBar,
    theme,
    colourFor: (index) => verdictColour(verdicts[index], theme),
    // Only the mistakes. A fingering under every note would be a wall of digits
    // to search rather than an answer to find.
    //
    // And only once per mistake: the far end of a tie wears the same verdict as
    // its head, since it is the same sound, but writing the answer under both
    // noteheads would twice answer a question asked once.
    annotationFor: (index) => {
      const verdict = verdicts[index];
      if (verdict === undefined || verdict === 'correct') return null;
      if (isTieContinuation(exercise.notes, index)) return null;
      return formatMask(exercise.notes[index].primaryMask);
    },
    final,
    // Read top to bottom rather than glanced at a screenful of stacked lines
    // at once, so the review keeps the courtesy clef on every system too, as
    // engraved music conventionally does.
    clef: true,
  });
}
