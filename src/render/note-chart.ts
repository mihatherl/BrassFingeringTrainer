/**
 * A fingering chart for a handful of notes: the stave, the notes, the numbers.
 *
 * Named pitches are how a program talks about notes and not how most players
 * do. "G flat 3" asks the reader to translate a letter, an accidental and an
 * octave number back into a position on a stave — and someone who needs the
 * practice is exactly the person for whom that translation is the difficulty
 * rather than an aside. So the note is simply drawn where it lives.
 *
 * Semibreves, because this is a chart and not music: no stems and no rhythm to
 * read past, which is what published fingering charts do for the same reason.
 * Ordered by pitch rather than by how badly each went, so the shape reads as
 * notation; the percentages underneath say which is worst.
 */

import { fingeringRows } from '../domain/fingering';
import { needsAccidental, spellInKey } from '../domain/keys';
import type { Clef } from '../domain/instruments';
import {
  drawFingeringHint,
  drawNote,
  fingeringHintRise,
  fingeringHintY,
  noteheadWidth,
} from './notes';
import {
  drawClef,
  drawKeySignature,
  drawStaveLines,
  staveMetrics,
  yForPitch,
} from './stave';
import type { StaveTheme } from './surface';

export interface ChartNote {
  writtenMidi: number;
  /** "1-2", or "open", or "—" where the note has no fingering at all. */
  fingering: string;
  /**
   * How often it went right, drawn as a percentage under the note.
   *
   * Optional because the chart is also used to *show* notes rather than to
   * report on them — the range picker draws its two bounds through here, and
   * a percentage under a note nobody has played yet would be an answer to a
   * question no one asked.
   */
  accuracy?: number;
}

export interface NoteChartOptions {
  notes: ChartNote[];
  clef: Clef;
  /** Key the notes are spelled in — normally the exercise just played. */
  fifths: number;
  theme: StaveTheme;
}

/**
 * Least clearance above the stave and below it, in stave spaces — enough for
 * the percentages underneath and a note or two outside the stave.
 */
const CHART_ABOVE = 4.5;
const CHART_BELOW = 4.5;

/** Where the percentage sits, in stave spaces below the bottom line, and its size. */
const SCORE_OFFSET = 4.4;
const SCORE_SIZE = 0.95;

/** Sizes the canvas to its width, draws, and returns the height used. */
export function drawNoteChart(canvas: HTMLCanvasElement, options: NoteChartOptions): number {
  const ctx = canvas.getContext('2d');
  const width = Math.max(1, canvas.getBoundingClientRect().width);
  const { notes, clef, fifths, theme } = options;

  const staveSpace = Math.min(22, Math.max(9, width / 26));

  /*
   * Sized to the notes it was given rather than to a fixed thirteen spaces.
   *
   * The weak notes are whichever ones the player keeps missing, which for a
   * brass part is as likely to be the bottom of the horn as the middle — and
   * each carries a fingering callout standing several spaces over it. Measured
   * from `fingeringHintY` and `fingeringHintRise`, which are the numbers the
   * drawing itself uses; `range-stave.ts` sizes itself the same way and for the
   * same reason.
   */
  const probe = staveMetrics(clef, 0, 1);
  let above = CHART_ABOVE;
  // The percentages hang below everything, and hung *off* the canvas while its
  // height was a constant: four and a half spaces of room for a row of figures
  // set four and a half spaces down.
  let below = notes.some((note) => note.accuracy !== undefined)
    ? SCORE_OFFSET + SCORE_SIZE + 0.3
    : CHART_BELOW;
  for (const note of notes) {
    const pitch = spellInKey(note.writtenMidi, fifths);
    const rows = fingeringRows(note.fingering).length;
    above = Math.max(
      above,
      -(fingeringHintY(probe, pitch) - fingeringHintRise(probe, rows)) + 0.4,
    );
    below = Math.max(below, yForPitch(probe, pitch) - probe.bottomLineY + 1);
  }

  const height = (above + 4 + below) * staveSpace;

  const dpr = window.devicePixelRatio || 1;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  if (!ctx || notes.length === 0) return height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const metrics = staveMetrics(clef, staveSpace * above, staveSpace);
  ctx.strokeStyle = theme.stave;
  ctx.fillStyle = theme.stave;
  drawStaveLines(ctx, metrics, 0, width);

  // Both return the x to carry on from, so the header measures itself exactly
  // rather than being estimated — and this chart carries no time signature.
  let x = staveSpace * 0.4;
  x = drawClef(ctx, metrics, x);
  const headerWidth = drawKeySignature(ctx, metrics, x, fifths) + staveSpace * 0.5;

  const ordered = [...notes].sort((a, b) => a.writtenMidi - b.writtenMidi);
  const step = (width - headerWidth - staveSpace) / ordered.length;

  ordered.forEach((note, index) => {
    const pitch = spellInKey(note.writtenMidi, fifths);
    const duration = { value: 'whole' as const, dotted: false };
    const centre = headerWidth + step * (index + 0.5);
    const item = {
      x: centre - noteheadWidth(metrics, duration) / 2,
      pitch,
      duration,
      showAccidental: needsAccidental(pitch, fifths),
      colour: theme.note,
    };

    drawNote(ctx, metrics, item);
    // The same placement the play surface uses, so a fingering sits in the same
    // relation to its note wherever it appears. `step` is generous, so the
    // width check never bites here.
    drawFingeringHint(ctx, metrics, item, note.fingering, step, theme.note, theme.background);

    if (note.accuracy !== undefined) {
      ctx.save();
      ctx.fillStyle = theme.hint;
      ctx.font = `${Math.round(staveSpace * SCORE_SIZE)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(
        `${Math.round(note.accuracy * 100)}%`,
        centre,
        metrics.bottomLineY + staveSpace * SCORE_OFFSET,
      );
      ctx.restore();
    }
  });

  return height;
}
