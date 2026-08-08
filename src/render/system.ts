/**
 * One system: a single line of engraved music, clef to final bar line.
 *
 * Shared by the results-screen review and by paged reading, which want exactly
 * the same thing — a run of bars set out on a stave with each note in whatever
 * colour it has earned. Only what hangs off it differs: the review writes the
 * fingering under its mistakes, the play surface does not.
 *
 * Scrolling reading is not built from these. It draws one endless line whose
 * origin moves every frame, with notes culled by position rather than chosen by
 * bar, and its spacing is even rather than engraved.
 */

import type { Exercise } from '../exercise/types';
import {
  drawBeamGroup,
  drawFingeringHint,
  drawNote,
  drawRest,
  drawTie,
  noteheadWidth,
  type LayoutNote,
} from './notes';
import type { Spacing } from './spacing';
import {
  drawBarLine,
  drawClef,
  drawKeySignature,
  drawStaveLines,
  drawTimeSignature,
  type StaveMetrics,
} from './stave';
import type { StaveTheme } from './surface';

/**
 * How far a bar line sits to the left of its downbeat, in stave spaces.
 *
 * Half a notehead clears the note itself; the rest is the gap an engraver would
 * leave, so the note reads as being *after* the bar line rather than on it.
 */
export const BAR_LINE_SETBACK = 1.75;

export interface SystemOptions {
  exercise: Exercise;
  metrics: StaveMetrics;
  /** Where a beat sits on this line; see `justifiedX`. */
  xForBeat: (beat: number) => number;
  /** First bar of this system. */
  firstBar: number;
  /** One past the last bar of this system. */
  lastBar: number;
  theme: StaveTheme;
  colourFor: (noteIndex: number) => string;
  /** Text to write under a note, or null for most of them. */
  annotationFor?: (noteIndex: number) => string | null;
  /** Fingering to print above a note, for the ones the player struggles with. */
  hintFor?: (noteIndex: number) => string | undefined;
  /** Whether this system ends the music, and so gets a closing double bar. */
  final: boolean;
}

/**
 * Where each beat of one system sits, with the line justified to fill its width.
 *
 * Engraved music does not leave a quarter of a line empty because the next bar
 * would not quite fit. The bars that did fit are stretched until the line is
 * full, which is why printed systems all end flush at the right margin.
 *
 * Stretching is uniform across the system, so the proportions the engraving
 * rule worked out are preserved exactly — a bar of semiquavers stays wider than
 * a bar of minims, and everything simply has more air.
 *
 * The final system of a piece is the exception, and is left ragged. Stretching
 * two remaining bars across a full line would space them like a largo and imply
 * a breadth that is not there.
 */
export function justifiedX(
  spacing: Spacing,
  firstBeat: number,
  lastBeat: number,
  headerWidth: number,
  usableWidth: number,
  justify: boolean,
): (beat: number) => number {
  const from = spacing.xOf(firstBeat);
  const natural = spacing.xOf(lastBeat) - from;
  // Never below 1: squeezing is the spacing rule's job, and it has already had
  // its say about what fits.
  const stretch = justify && natural > 0 ? Math.max(1, usableWidth / natural) : 1;
  return (beat) => headerWidth + (spacing.xOf(beat) - from) * stretch;
}

/** Where an annotation sits, in stave spaces below the bottom line. */
const ANNOTATION_OFFSET = 4.6;

export function drawSystem(ctx: CanvasRenderingContext2D, options: SystemOptions): void {
  const { exercise, metrics, xForBeat, theme, firstBar, lastBar } = options;
  const { staveSpace } = metrics;
  const { barBeats, beatsPerBar, beatUnit } = exercise.metre;

  const firstBeat = firstBar * barBeats;
  const lastBeat = Math.min(exercise.totalBeats, lastBar * barBeats);
  const rightEdge = xForBeat(lastBeat) - BAR_LINE_SETBACK * staveSpace;

  ctx.strokeStyle = theme.stave;
  ctx.fillStyle = theme.stave;
  drawStaveLines(ctx, metrics, 0, rightEdge);

  let x = staveSpace * 0.4;
  x = drawClef(ctx, metrics, x);
  x = drawKeySignature(ctx, metrics, x, exercise.fifths);
  // Where the music proper starts, which is where a tie arriving from the
  // system above has to begin.
  const musicLeft = drawTimeSignature(ctx, metrics, x, beatsPerBar, beatUnit);

  // Every bar line except the one at the head of the system, which the clef
  // stands in for.
  ctx.strokeStyle = theme.stave;
  for (let beat = firstBeat + barBeats; beat <= lastBeat; beat += barBeats) {
    drawBarLine(ctx, metrics, xForBeat(beat) - BAR_LINE_SETBACK * staveSpace);
  }

  for (const rest of exercise.rests) {
    if (rest.startBeat < firstBeat || rest.startBeat >= lastBeat) continue;
    drawRest(ctx, metrics, xForBeat(rest.startBeat), rest.duration, theme.stave);
  }

  const loose: LayoutNote[] = [];
  const beamed = new Map<number, LayoutNote[]>();
  const hints: Array<{ note: LayoutNote; text: string; room: number }> = [];

  exercise.notes.forEach((note, index) => {
    if (note.startBeat < firstBeat || note.startBeat >= lastBeat) return;

    const headWidth = noteheadWidth(metrics, note.duration);
    const centre = xForBeat(note.startBeat);
    const item: LayoutNote = {
      x: centre - headWidth / 2,
      pitch: note.pitch,
      duration: note.duration,
      showAccidental: note.showAccidental,
      colour: options.colourFor(index),
    };

    if (note.beamGroup >= 0) {
      const group = beamed.get(note.beamGroup) ?? [];
      group.push(item);
      beamed.set(note.beamGroup, group);
    } else {
      loose.push(item);
    }

    const annotation = options.annotationFor?.(index);
    if (annotation) annotate(ctx, metrics, centre, annotation, item.colour);

    const hint = options.hintFor?.(index);
    if (hint) {
      const next = exercise.notes[index + 1];
      const room =
        next && next.startBeat < lastBeat ? xForBeat(next.startBeat) - centre : rightEdge - centre;
      hints.push({ note: item, text: hint, room });
    }
  });

  for (const note of loose) drawNote(ctx, metrics, note);
  for (const group of beamed.values()) drawBeamGroup(ctx, metrics, group);

  /*
   * Ties, drawn over the notes rather than with them.
   *
   * A tie belongs to two noteheads, and on an engraved page those two are
   * routinely on different lines: the whole point of the thing is that it
   * crosses a bar line, and a system break is a bar line. So each end is placed
   * independently — against its notehead if that note is on this system, and
   * against the margin if it is not — which draws the half of the tie that
   * belongs here and leaves the other half to the system that owns it.
   */
  exercise.notes.forEach((note, index) => {
    const next = exercise.notes[index + 1];
    if (!note.tiedToNext || !next) return;

    const headHere = note.startBeat >= firstBeat && note.startBeat < lastBeat;
    const tailHere = next.startBeat >= firstBeat && next.startBeat < lastBeat;
    if (!headHere && !tailHere) return;

    drawTie(ctx, metrics, {
      from: headHere
        ? { x: xForBeat(note.startBeat), headWidth: noteheadWidth(metrics, note.duration) }
        : { x: musicLeft },
      to: tailHere
        ? { x: xForBeat(next.startBeat), headWidth: noteheadWidth(metrics, next.duration) }
        : { x: rightEdge },
      pitch: note.pitch,
      colour: options.colourFor(index),
    });
  });

  for (const { note, text, room } of hints) {
    drawFingeringHint(ctx, metrics, note, text, room, theme.hint);
  }

  if (options.final) {
    ctx.strokeStyle = theme.stave;
    drawBarLine(ctx, metrics, rightEdge);
    ctx.fillStyle = theme.stave;
    ctx.fillRect(rightEdge + staveSpace * 0.35, metrics.topLineY, staveSpace * 0.35, staveSpace * 4);
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
