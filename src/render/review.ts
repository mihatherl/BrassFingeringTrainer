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
import { keyAt, widestKey } from '../domain/keys';
import type { Verdict } from '../engine/judge';
import { isTieContinuation } from '../exercise/ties';
import type { Exercise } from '../exercise/types';
import { accidentalRoom, dotRoom, noteheadWidth } from './notes';
import { engraveSpacing, NOTE_CLEARANCE, type Spacing } from './spacing';
import { measureStaveHeader, staveMetrics } from './stave';
import { BAR_LINE_SETBACK, drawSystem, justifiedX, keyChangeRoom } from './system';
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

  const layout = planReview(width, exercise);
  const height = layout.systems * layout.systemHeight;

  const dpr = window.devicePixelRatio || 1;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  if (!ctx) return height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

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
export function planReview(width: number, exercise: Exercise): ReviewLayout {
  // Big enough to read the noteheads, small enough that a phone still gets a
  // couple of bars to a line.
  const staveSpace = Math.min(18, Math.max(9, width / 34));
  const metrics = staveMetrics(exercise.clef, 0, staveSpace);
  const headerWidth =
    // The widest key reached, so a later system with more accidentals cannot
    // overflow a line whose bars were planned against a narrower one.
    measureStaveHeader(
      metrics,
      widestKey(exercise.keys),
      exercise.metre.beatsPerBar,
      exercise.metre.beatUnit,
    ) +
    staveSpace;

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
    // Room for the double bar and new signature at a change; nothing anywhere
    // else. See `keyChangeRoom`.
    keyChangeRoomAt: (beat) => {
      const change = exercise.keys.find((k) => k.fromBeat === beat);
      if (!change || change.fromBeat === 0) return 0;
      return keyChangeRoom(metrics, keyAt(exercise.keys, beat - 1e-6), change.fifths);
    },
  });

  // Systems are filled greedily, as an engraver fills a line: take bars until
  // the next one will not fit, then break. A line of held notes therefore holds
  // far more bars than a line of semiquavers, which is the whole point.
  const totalBars = Math.max(1, Math.ceil(exercise.totalBeats / exercise.metre.barBeats));
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

function drawReviewSystem(
  ctx: CanvasRenderingContext2D,
  options: ReviewOptions,
  layout: ReviewLayout,
  system: number,
): void {
  const { exercise, verdicts, theme } = options;
  const { staveSpace, headerWidth, spacing, systemStarts } = layout;
  const totalBars = Math.ceil(exercise.totalBeats / exercise.metre.barBeats);

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
      firstBar * exercise.metre.barBeats,
      Math.min(exercise.totalBeats, lastBar * exercise.metre.barBeats),
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
