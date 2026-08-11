/**
 * Stave geometry and the fixed furniture at the left of the display: clef, key
 * signature and time signature.
 *
 * Everything is measured in stave spaces so the whole display scales with a
 * single number. Vertical position is a linear function of diatonic step, which
 * is why accidentals never move a note: F4 and F#4 share a step.
 */

import { LETTER_STEPS, diatonicStep, type Letter, type SpelledPitch } from '../domain/pitch';
import type { Clef } from '../domain/instruments';
import { FLAT_ORDER, SHARP_ORDER, signatureLetters } from '../domain/keys';
import { GLYPHS, drawGlyph, glyphWidth, type GlyphName } from './glyphs';

export interface StaveMetrics {
  clef: Clef;
  /** Pixels per stave space. The single scale factor for the whole display. */
  staveSpace: number;
  topLineY: number;
  bottomLineY: number;
  middleLineY: number;
  /** Diatonic step sitting on the bottom stave line. */
  bottomLineStep: number;
}

/** Bottom stave line: E4 in treble, G2 in bass. */
const BOTTOM_LINE_STEP: Record<Clef, number> = {
  treble: (4 + 1) * 7 + LETTER_STEPS.E,
  bass: (2 + 1) * 7 + LETTER_STEPS.G,
};

/** The line each clef's glyph origin is anchored to: G4 for treble, F3 for bass. */
const CLEF_ANCHOR_STEP: Record<Clef, number> = {
  treble: (4 + 1) * 7 + LETTER_STEPS.G,
  bass: (3 + 1) * 7 + LETTER_STEPS.F,
};

const CLEF_GLYPH: Record<Clef, GlyphName> = { treble: 'gClef', bass: 'fClef' };

export function staveMetrics(clef: Clef, topLineY: number, staveSpace: number): StaveMetrics {
  return {
    clef,
    staveSpace,
    topLineY,
    bottomLineY: topLineY + 4 * staveSpace,
    middleLineY: topLineY + 2 * staveSpace,
    bottomLineStep: BOTTOM_LINE_STEP[clef],
  };
}

/** Each diatonic step is half a stave space, counted upwards from the bottom line. */
export function yForStep(m: StaveMetrics, step: number): number {
  return m.bottomLineY - (step - m.bottomLineStep) * (m.staveSpace / 2);
}

export function yForPitch(m: StaveMetrics, pitch: SpelledPitch): number {
  return yForStep(m, diatonicStep(pitch));
}

/** True when a step sits on a line rather than in a space (including ledgers). */
export function isOnLine(m: StaveMetrics, step: number): boolean {
  return (step - m.bottomLineStep) % 2 === 0;
}

export function drawStaveLines(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  fromX: number,
  toX: number,
): void {
  ctx.lineWidth = Math.max(1, m.staveSpace * 0.13);
  ctx.beginPath();
  for (let line = 0; line < 5; line++) {
    const y = Math.round(m.topLineY + line * m.staveSpace) + 0.5;
    ctx.moveTo(fromX, y);
    ctx.lineTo(toX, y);
  }
  ctx.stroke();
}

/**
 * `crisp` snaps the line to the pixel grid, which is right for anything static.
 * Scrolling bar lines must not be snapped: rounding a position that changes
 * continuously makes the line judder a pixel at a time instead of gliding.
 */
export function drawBarLine(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  x: number,
  crisp = true,
): void {
  const lineX = crisp ? Math.round(x) + 0.5 : x;
  ctx.lineWidth = Math.max(1, m.staveSpace * 0.16);
  ctx.beginPath();
  ctx.moveTo(lineX, m.topLineY);
  ctx.lineTo(lineX, m.bottomLineY);
  ctx.stroke();
}

/** Draws the clef at `x`, returning the x to continue from. */
export function drawClef(ctx: CanvasRenderingContext2D, m: StaveMetrics, x: number): number {
  const glyph = CLEF_GLYPH[m.clef];
  drawGlyph(ctx, glyph, x, yForStep(m, CLEF_ANCHOR_STEP[m.clef]), m.staveSpace);
  return x + glyphWidth(glyph) * m.staveSpace + m.staveSpace * 0.7;
}

/**
 * Where each accidental of a key signature sits.
 *
 * These octaves are conventional rather than derivable — engravers place them so
 * the group stays inside the stave and reads as a shape — so they are simply
 * listed, in the order the accidentals are written.
 */
const SIGNATURE_OCTAVES: Record<Clef, { sharps: number[]; flats: number[] }> = {
  //                    F  C  G  D  A  E  B
  treble: { sharps: [5, 5, 5, 5, 4, 5, 4], flats: [4, 5, 4, 5, 4, 5, 4] },
  bass: { sharps: [3, 3, 3, 3, 2, 3, 2], flats: [2, 3, 2, 3, 2, 3, 2] },
};

/** Gap after an accidental in a signature, before the next one, in stave spaces. */
const SIGNATURE_GAP = 0.18;
/**
 * Extra air between the naturals cancelling a key and the signature replacing
 * it, so the two read as two statements rather than one jumbled row.
 */
const CANCEL_GAP = 0.4;
/** Gap after the whole signature, before whatever follows it. */
const SIGNATURE_TRAIL = 0.6;

/** One accidental of a key signature, placed. */
export interface SignatureGlyph {
  glyph: GlyphName;
  /** Left edge, relative to where the signature starts. */
  dx: number;
  y: number;
}

/**
 * Where a key signature's accidentals go, and how much room the whole thing
 * takes.
 *
 * Laid out rather than drawn, so that measuring a signature and drawing one
 * cannot disagree. They used to be separate arithmetic — `drawKeySignature`
 * advanced a cursor while `measureStaveHeader` multiplied a count by a single
 * advance — which was fine only while every glyph in a signature was the same
 * width. It stops being true the moment a signature mixes naturals with sharps
 * or flats, which is exactly what cancelling an outgoing key looks like, and
 * the two would then disagree silently. That matters more than it sounds:
 * the measured width sets `headerWidth`, which sets `strikeX`, which is what
 * every note on a scrolling line is positioned and timed against.
 */
export function layoutKeySignature(
  m: StaveMetrics,
  fifths: number,
  /**
   * The key being left, when this signature is a change rather than an
   * opening. Its surplus accidentals are cancelled with naturals in front of
   * the new signature, in the positions they themselves occupied — which is
   * what makes them read as "these are no longer sharp" rather than as a row
   * of unrelated naturals.
   */
  from?: number,
): { glyphs: SignatureGlyph[]; width: number } {
  const glyphs: SignatureGlyph[] = [];
  let dx = 0;

  const place = (glyph: GlyphName, letter: Letter, octave: number) => {
    glyphs.push({ glyph, dx, y: yForPitch(m, { letter, alter: 0, octave }) });
    dx += glyphWidth(glyph) * m.staveSpace + m.staveSpace * SIGNATURE_GAP;
  };

  const octavesFor = (of: number) =>
    of > 0 ? SIGNATURE_OCTAVES[m.clef].sharps : SIGNATURE_OCTAVES[m.clef].flats;
  const orderFor = (of: number) => (of > 0 ? SHARP_ORDER : FLAT_ORDER);

  /*
   * Naturals first, for whatever the outgoing key had and the incoming one
   * does not.
   *
   * Three cases, all of which fall out of a plain set difference: changing
   * sign cancels everything, since no sharp survives into a flat key; fewer of
   * the same sign cancels only the surplus; and into C major the naturals are
   * the whole message, which is the one a reader is likeliest to miss.
   */
  if (from !== undefined && from !== fifths && from !== 0) {
    const leaving = signatureLetters(from);
    const arriving = new Set(fifths === 0 ? [] : signatureLetters(fifths));
    const sameSign = from > 0 === fifths > 0 && fifths !== 0;
    const octaves = octavesFor(from);
    const order = orderFor(from);

    for (const letter of leaving) {
      if (sameSign && arriving.has(letter)) continue;
      place('accidentalNatural', letter, octaves[order.indexOf(letter)]);
    }
    if (glyphs.length > 0 && fifths !== 0) dx += m.staveSpace * CANCEL_GAP;
  }

  if (fifths !== 0) {
    const octaves = octavesFor(fifths);
    const order = orderFor(fifths);
    const glyph: GlyphName = fifths > 0 ? 'accidentalSharp' : 'accidentalFlat';
    for (const letter of signatureLetters(fifths)) {
      place(glyph, letter, octaves[order.indexOf(letter)]);
    }
  }

  if (glyphs.length === 0) return { glyphs, width: 0 };
  return { glyphs, width: dx + m.staveSpace * SIGNATURE_TRAIL };
}

export function drawKeySignature(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  x: number,
  fifths: number,
  /** The key being left, if this is a change; see `layoutKeySignature`. */
  from?: number,
): number {
  const { glyphs, width } = layoutKeySignature(m, fifths, from);
  for (const { glyph, dx, y } of glyphs) {
    drawGlyph(ctx, glyph, x + dx, y, m.staveSpace);
  }
  return x + width;
}

export function drawTimeSignature(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  x: number,
  beatsPerBar: number,
  beatUnit: number,
): number {
  const top = digitGlyphs(beatsPerBar);
  const bottom = digitGlyphs(beatUnit);
  const width = Math.max(digitsWidth(top), digitsWidth(bottom)) * m.staveSpace;

  drawDigits(ctx, m, top, x, width, m.middleLineY - m.staveSpace);
  drawDigits(ctx, m, bottom, x, width, m.middleLineY + m.staveSpace);

  return x + width + m.staveSpace;
}

/**
 * Draws a whole number in the time-signature figures, centred on a point.
 *
 * Exported because the count over a multi-bar rest is set in these same
 * numerals — an engraver uses the time-signature figures there rather than
 * text, and the app already carries them as glyphs, so the count matches the
 * signature at the head of the line instead of being the page's one number in
 * a different alphabet.
 */
export function drawNumberGlyphs(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  value: number,
  centreX: number,
  centreY: number,
  scale = 1,
): void {
  const glyphs = digitGlyphs(value);
  const size = m.staveSpace * scale;
  const width = digitsWidth(glyphs) * size;
  let cursor = centreX - width / 2;
  for (const glyph of glyphs) {
    const { top, bottom } = GLYPHS[glyph].bbox;
    drawGlyph(ctx, glyph, cursor, centreY - ((top + bottom) / 2) * size, size);
    cursor += glyphWidth(glyph) * size;
  }
}

function digitGlyphs(value: number): GlyphName[] {
  return String(value)
    .split('')
    .map((d) => `timeSig${d}` as GlyphName);
}

function digitsWidth(glyphs: GlyphName[]): number {
  return glyphs.reduce((sum, g) => sum + glyphWidth(g), 0);
}

/** Time signature digits are centred on each other and on the given y. */
function drawDigits(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  glyphs: GlyphName[],
  x: number,
  boxWidth: number,
  centreY: number,
): void {
  const width = digitsWidth(glyphs) * m.staveSpace;
  let cursor = x + (boxWidth - width) / 2;
  for (const glyph of glyphs) {
    const { top, bottom } = GLYPHS[glyph].bbox;
    const offset = -((top + bottom) / 2) * m.staveSpace;
    drawGlyph(ctx, glyph, cursor, centreY + offset, m.staveSpace);
    cursor += glyphWidth(glyph) * m.staveSpace;
  }
}

/**
 * Total width of the clef/key/time block, needed to position the strike line.
 *
 * `showClef` is false for a system that repeats the key and time signature but
 * not the clef — see `SystemOptions.clef` in `system.ts` for why a system
 * would want that.
 */
/**
 * Room a time signature takes, including the space after it.
 *
 * Its own function because a signature is drawn in two places now — at the head
 * of a line and where the metre changes part-way along one — and the room has
 * to be reserved in the spacing before either is drawn. Two copies of this
 * arithmetic would be two answers to how wide a 12/8 is.
 */
export function timeSignatureWidth(m: StaveMetrics, beatsPerBar: number, beatUnit: number): number {
  return (
    Math.max(digitsWidth(digitGlyphs(beatsPerBar)), digitsWidth(digitGlyphs(beatUnit))) *
      m.staveSpace +
    m.staveSpace
  );
}

export function measureStaveHeader(
  m: StaveMetrics,
  fifths: number,
  beatsPerBar: number,
  beatUnit: number,
  showClef = true,
): number {
  const clefWidth = showClef ? glyphWidth(CLEF_GLYPH[m.clef]) * m.staveSpace + m.staveSpace * 0.7 : 0;

  // The same layout the drawing uses, rather than arithmetic that happens to
  // agree with it — see `layoutKeySignature`.
  const keyWidth = layoutKeySignature(m, fifths).width;

  return clefWidth + keyWidth + timeSignatureWidth(m, beatsPerBar, beatUnit);
}
