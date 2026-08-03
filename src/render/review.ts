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
import { spellInKey } from '../domain/keys';
import type { Verdict } from '../engine/judge';
import type { Exercise } from '../exercise/types';
import { drawBeamGroup, drawNote, drawRest, noteheadWidth, type LayoutNote } from './notes';
import {
  drawBarLine,
  drawClef,
  drawKeySignature,
  drawStaveLines,
  drawTimeSignature,
  measureStaveHeader,
  staveMetrics,
  type StaveMetrics,
} from './stave';
import { engraveSpacing, NOTE_CLEARANCE, type Spacing } from './spacing';
import { verdictColour, type StaveTheme } from './surface';

/** Matches the play surface, so a bar line never sits astride its downbeat. */
const BAR_LINE_SETBACK = 1.75;

/**
 * Height of one system in stave spaces.
 *
 * Four for the stave itself, and the rest is what hangs off it: ledger lines
 * and accidentals above, ledger lines and the fingering annotation below.
 */
const SYSTEM_SPACES = 13;

/** Where the annotation sits, in stave spaces below the bottom line. */
const ANNOTATION_OFFSET = 4.6;

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
    drawSystem(ctx, options, layout, system);
  }

  return height;
}

export interface ReviewLayout {
  staveSpace: number;
  headerWidth: number;
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
    measureStaveHeader(metrics, exercise.fifths, exercise.beatsPerBar, exercise.beatUnit) +
    staveSpace;

  const head = noteheadWidth(metrics, { value: 'quarter', dotted: false });
  const usable = width - headerWidth - staveSpace * 2;
  const spacing = engraveSpacing(exercise, {
    minColumnWidth: head * NOTE_CLEARANCE,
    maxBarWidth: usable,
  });

  // Systems are filled greedily, as an engraver fills a line: take bars until
  // the next one will not fit, then break. A line of held notes therefore holds
  // far more bars than a line of semiquavers, which is the whole point.
  const totalBars = Math.max(1, Math.ceil(exercise.totalBeats / exercise.beatsPerBar));
  const systemStarts: number[] = [];
  for (let bar = 0; bar < totalBars; bar += spacing.barsFitting(bar, usable)) {
    systemStarts.push(bar);
  }

  return {
    staveSpace,
    headerWidth,
    spacing,
    systemStarts,
    systems: systemStarts.length,
    systemHeight: staveSpace * SYSTEM_SPACES,
  };
}

function drawSystem(
  ctx: CanvasRenderingContext2D,
  options: ReviewOptions,
  layout: ReviewLayout,
  system: number,
): void {
  const { exercise, verdicts, theme } = options;
  const { staveSpace, headerWidth, spacing, systemStarts } = layout;

  // Three and a half spaces of clearance above the stave for ledger lines and
  // accidentals; the annotation gets what is left underneath.
  const topLineY = system * layout.systemHeight + staveSpace * 3.5;
  const metrics = staveMetrics(exercise.clef, topLineY, staveSpace);

  const firstBar = systemStarts[system];
  const nextBar = systemStarts[system + 1] ?? Math.ceil(exercise.totalBeats / exercise.beatsPerBar);
  const firstBeat = firstBar * exercise.beatsPerBar;
  const lastBeat = Math.min(exercise.totalBeats, nextBar * exercise.beatsPerBar);
  const originX = spacing.xOf(firstBeat);
  const xForBeat = (beat: number) => headerWidth + spacing.xOf(beat) - originX;

  ctx.strokeStyle = theme.stave;
  ctx.fillStyle = theme.stave;
  drawStaveLines(ctx, metrics, 0, xForBeat(lastBeat) - BAR_LINE_SETBACK * staveSpace);

  let x = staveSpace * 0.4;
  x = drawClef(ctx, metrics, x);
  x = drawKeySignature(ctx, metrics, x, exercise.fifths);
  drawTimeSignature(ctx, metrics, x, exercise.beatsPerBar, exercise.beatUnit);

  // Every bar line except the one at the head of the system, which the clef
  // stands in for.
  ctx.strokeStyle = theme.stave;
  for (let beat = firstBeat + exercise.beatsPerBar; beat <= lastBeat; beat += exercise.beatsPerBar) {
    drawBarLine(ctx, metrics, xForBeat(beat) - BAR_LINE_SETBACK * staveSpace);
  }

  for (const rest of exercise.rests) {
    if (rest.startBeat < firstBeat || rest.startBeat >= lastBeat) continue;
    drawRest(ctx, metrics, xForBeat(rest.startBeat), rest.duration, theme.stave);
  }

  const loose: LayoutNote[] = [];
  const beamed = new Map<number, LayoutNote[]>();

  exercise.notes.forEach((note, index) => {
    if (note.startBeat < firstBeat || note.startBeat >= lastBeat) return;

    const headWidth = noteheadWidth(metrics, note.duration);
    const centre = xForBeat(note.startBeat);
    const verdict = verdicts[index];
    const item: LayoutNote = {
      x: centre - headWidth / 2,
      pitch: spellInKey(note.writtenMidi, exercise.fifths),
      duration: note.duration,
      showAccidental: note.showAccidental,
      colour: verdictColour(verdict, theme),
    };

    if (note.beamGroup >= 0) {
      const group = beamed.get(note.beamGroup) ?? [];
      group.push(item);
      beamed.set(note.beamGroup, group);
    } else {
      loose.push(item);
    }

    if (verdict !== undefined && verdict !== 'correct') {
      annotate(ctx, metrics, centre, formatMask(note.primaryMask), verdictColour(verdict, theme));
    }
  });

  for (const note of loose) drawNote(ctx, metrics, note);
  for (const group of beamed.values()) drawBeamGroup(ctx, metrics, group);

  // The end of the music, rather than the end of a system that happens to be full.
  if (lastBeat >= exercise.totalBeats) {
    ctx.strokeStyle = theme.stave;
    const end = xForBeat(lastBeat) - BAR_LINE_SETBACK * staveSpace;
    drawBarLine(ctx, metrics, end);
    ctx.fillStyle = theme.stave;
    ctx.fillRect(end + staveSpace * 0.35, metrics.topLineY, staveSpace * 0.35, staveSpace * 4);
  }
}

function annotate(
  ctx: CanvasRenderingContext2D,
  metrics: StaveMetrics,
  centreX: number,
  text: string,
  colour: string,
): void {
  ctx.save();
  ctx.fillStyle = colour;
  ctx.font = `600 ${Math.round(metrics.staveSpace * 1.25)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(text, centreX, metrics.bottomLineY + metrics.staveSpace * ANNOTATION_OFFSET);
  ctx.restore();
}
