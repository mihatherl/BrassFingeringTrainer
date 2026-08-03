/**
 * Drawing notes: noteheads, stems, flags, beams, ledger lines and accidentals.
 *
 * The layout layer decides x positions and beam grouping; this module only
 * draws what it is told to, so the same code serves the scrolling display and
 * any static preview.
 */

import { diatonicStep, type SpelledPitch } from '../domain/pitch';
import { NOTE_VALUE_FLAGS, type Duration } from '../domain/rhythm';
import { drawGlyph, glyphWidth, type GlyphName } from './glyphs';
import { isOnLine, yForStep, type StaveMetrics } from './stave';

export interface LayoutNote {
  /** X of the notehead's left edge. */
  x: number;
  pitch: SpelledPitch;
  duration: Duration;
  showAccidental: boolean;
  /** Fill colour, used to show judging feedback. */
  colour: string;
}

/** Gap between an accidental and the notehead it belongs to, in stave spaces. */
const ACCIDENTAL_GAP = 0.28;
/** Gap between a notehead and its augmentation dot. */
const DOT_GAP = 0.3;

const STEM_LENGTH = 3.5;
const STEM_THICKNESS = 0.12;
const BEAM_THICKNESS = 0.5;
const BEAM_SPACING = 0.75;
const LEDGER_OVERHANG = 0.28;

function noteheadGlyph(duration: Duration): GlyphName {
  if (duration.value === 'whole') return 'noteheadWhole';
  if (duration.value === 'half') return 'noteheadHalf';
  return 'noteheadBlack';
}

function accidentalGlyph(alter: number): GlyphName | null {
  if (alter === 0) return 'accidentalNatural';
  if (alter > 0) return 'accidentalSharp';
  return 'accidentalFlat';
}

/** Stems point away from the middle line, so the note stays inside the stave. */
export function stemUp(m: StaveMetrics, pitch: SpelledPitch): boolean {
  const middleStep = m.bottomLineStep + 4;
  return diatonicStep(pitch) < middleStep;
}

export function drawLedgerLines(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  x: number,
  pitch: SpelledPitch,
  headWidth: number,
): void {
  const step = diatonicStep(pitch);
  const topLineStep = m.bottomLineStep + 8;
  const from = x - LEDGER_OVERHANG * m.staveSpace;
  const to = x + headWidth + LEDGER_OVERHANG * m.staveSpace;

  ctx.lineWidth = Math.max(1, m.staveSpace * 0.15);
  ctx.beginPath();

  // Ledger lines only ever fall on line positions, hence stepping by two.
  const firstBelow = m.bottomLineStep - 2;
  for (let s = firstBelow; s >= step; s -= 2) {
    const y = Math.round(yForStep(m, s)) + 0.5;
    ctx.moveTo(from, y);
    ctx.lineTo(to, y);
  }
  const firstAbove = topLineStep + 2;
  for (let s = firstAbove; s <= step; s += 2) {
    const y = Math.round(yForStep(m, s)) + 0.5;
    ctx.moveTo(from, y);
    ctx.lineTo(to, y);
  }
  ctx.stroke();
}

/** Draws one note complete with accidental, ledger lines, stem and flag. */
export function drawNote(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  note: LayoutNote,
  options: { beamed?: boolean; forceStemUp?: boolean; stemEndY?: number } = {},
): void {
  const head = noteheadGlyph(note.duration);
  const headWidth = glyphWidth(head) * m.staveSpace;
  const y = yForStep(m, diatonicStep(note.pitch));

  ctx.fillStyle = note.colour;
  ctx.strokeStyle = note.colour;

  drawLedgerLines(ctx, m, note.x, note.pitch, headWidth);

  if (note.showAccidental) {
    const glyph = accidentalGlyph(note.pitch.alter);
    if (glyph) {
      drawGlyph(ctx, glyph, note.x - accidentalRoom(m, note.pitch), y, m.staveSpace);
    }
  }

  drawGlyph(ctx, head, note.x, y, m.staveSpace);

  if (note.duration.dotted) {
    // Dots sit in a space, so a note on a line pushes its dot up to the space above.
    const dotY = isOnLine(m, diatonicStep(note.pitch)) ? y - m.staveSpace / 2 : y;
    drawGlyph(ctx, 'augmentationDot', note.x + headWidth + DOT_GAP * m.staveSpace, dotY, m.staveSpace);
  }

  if (note.duration.value === 'whole') return;

  const up = options.forceStemUp ?? stemUp(m, note.pitch);
  const stemX = up ? note.x + headWidth - (STEM_THICKNESS * m.staveSpace) / 2 : note.x + (STEM_THICKNESS * m.staveSpace) / 2;
  const stemEndY = options.stemEndY ?? y + (up ? -1 : 1) * STEM_LENGTH * m.staveSpace;

  ctx.lineWidth = STEM_THICKNESS * m.staveSpace;
  ctx.beginPath();
  ctx.moveTo(stemX, y);
  ctx.lineTo(stemX, stemEndY);
  ctx.stroke();

  const flags = NOTE_VALUE_FLAGS[note.duration.value];
  if (flags > 0 && !options.beamed) {
    const glyph: GlyphName =
      flags === 1 ? (up ? 'flag8thUp' : 'flag8thDown') : up ? 'flag16thUp' : 'flag16thDown';
    drawGlyph(ctx, glyph, stemX, stemEndY, m.staveSpace);
  }
}

/**
 * Draws a run of beamed notes.
 *
 * Beams are kept horizontal. Slanted beams engrave better, but on a display
 * that is continuously scrolling past a fixed line, a level beam is easier to
 * read and removes a whole class of layout edge cases.
 */
export function drawBeamGroup(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  notes: LayoutNote[],
): void {
  if (notes.length === 0) return;
  if (notes.length === 1) {
    drawNote(ctx, m, notes[0]);
    return;
  }

  const steps = notes.map((n) => diatonicStep(n.pitch));
  const middleStep = m.bottomLineStep + 4;
  // One direction for the whole group, chosen by whichever extreme is furthest
  // from the middle line — the standard engraving rule.
  const highest = Math.max(...steps);
  const lowest = Math.min(...steps);
  const up = highest - middleStep <= middleStep - lowest;

  const extremeStep = up ? lowest : highest;
  const beamY =
    yForStep(m, extremeStep) + (up ? -1 : 1) * STEM_LENGTH * m.staveSpace;

  for (const note of notes) {
    drawNote(ctx, m, note, { beamed: true, forceStemUp: up, stemEndY: beamY });
  }

  const headWidth = glyphWidth('noteheadBlack') * m.staveSpace;
  const stemOffset = up ? headWidth - (STEM_THICKNESS * m.staveSpace) / 2 : (STEM_THICKNESS * m.staveSpace) / 2;
  const startX = notes[0].x + stemOffset;
  const endX = notes[notes.length - 1].x + stemOffset;

  ctx.fillStyle = notes[0].colour;
  const thickness = BEAM_THICKNESS * m.staveSpace;
  const direction = up ? 1 : -1;

  // Primary beam spans the group; secondary beams only span runs of semiquavers.
  ctx.fillRect(startX, beamY, endX - startX, thickness * direction);

  const maxFlags = Math.max(...notes.map((n) => NOTE_VALUE_FLAGS[n.duration.value]));
  for (let level = 1; level < maxFlags; level++) {
    const offsetY = beamY + direction * level * BEAM_SPACING * m.staveSpace;
    let runStart: number | null = null;
    for (let i = 0; i < notes.length; i++) {
      const carries = NOTE_VALUE_FLAGS[notes[i].duration.value] > level;
      if (carries && runStart === null) runStart = i;
      const runEnds = !carries || i === notes.length - 1;
      if (runStart !== null && runEnds) {
        const last = carries ? i : i - 1;
        const from = notes[runStart].x + stemOffset;
        // A lone semiquaver among quavers gets a stub rather than a full beam.
        const to =
          last > runStart ? notes[last].x + stemOffset : from + m.staveSpace * 0.9;
        ctx.fillRect(from, offsetY, to - from, thickness * direction);
        runStart = null;
      }
    }
  }
}

export function drawRest(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  x: number,
  duration: Duration,
  colour: string,
): void {
  const glyph: GlyphName =
    duration.value === 'whole'
      ? 'restWhole'
      : duration.value === 'half'
        ? 'restHalf'
        : duration.value === 'quarter'
          ? 'restQuarter'
          : duration.value === 'eighth'
            ? 'rest8th'
            : 'rest16th';
  ctx.fillStyle = colour;
  drawGlyph(ctx, glyph, x, m.middleLineY, m.staveSpace);
}

export function noteheadWidth(m: StaveMetrics, duration: Duration): number {
  return glyphWidth(noteheadGlyph(duration)) * m.staveSpace;
}

/**
 * Room an accidental takes in front of its notehead, gap included.
 *
 * An accidental is drawn to the left of the note it alters, so it occupies the
 * space between that note and the one before — which is why spacing has to know
 * about it. Left out, a sharp simply lands on top of its neighbour.
 */
export function accidentalRoom(m: StaveMetrics, pitch: SpelledPitch): number {
  const glyph = accidentalGlyph(pitch.alter);
  if (!glyph) return 0;
  return (glyphWidth(glyph) + ACCIDENTAL_GAP) * m.staveSpace;
}

/** Room an augmentation dot takes behind its notehead, gap included. */
export function dotRoom(m: StaveMetrics, duration: Duration): number {
  if (!duration.dotted) return 0;
  return (DOT_GAP + glyphWidth('augmentationDot')) * m.staveSpace;
}
