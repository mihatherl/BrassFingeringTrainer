/**
 * Drawing notes: noteheads, stems, flags, beams, ledger lines and accidentals.
 *
 * The layout layer decides x positions and beam grouping; this module only
 * draws what it is told to, so the same code serves the scrolling display and
 * any static preview.
 */

import { fingeringRows } from '../domain/fingering';
import { diatonicStep, type SpelledPitch } from '../domain/pitch';
import { NOTE_VALUE_FLAGS, type Duration, type NoteValue } from '../domain/rhythm';
import { drawGlyph, glyphWidth, type GlyphName } from './glyphs';
import { drawNumberGlyphs, isOnLine, yForStep, type StaveMetrics } from './stave';

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

/** Gap between a notehead and the tip of a tie leaving it, in stave spaces. */
const TIE_CLEARANCE = 0.12;
/**
 * How far a tie's tip sits from the centre of its notehead, as a fraction of
 * that head's width.
 *
 * Less than half, deliberately. The tip is the better part of a stave space
 * above or below the head's centre, where the ellipse has already narrowed to
 * nothing — so clearing the head's full width buys no room and costs a great
 * deal. At the spacing a crotchet actually gets, two noteheads sit about three
 * head-widths apart; taking a whole one out of that leaves a speck rather than
 * a tie.
 */
const TIE_INSET = 0.3;
/** How far the crown of a tie stands off the noteheads it joins. */
const TIE_HEIGHT = 0.66;
/** Shallowest a short tie may be flattened to, so it still reads as a curve. */
const TIE_MIN_HEIGHT = 0.35;
/** Thickness of a tie at its crown; it tapers to nothing at both tips. */
const TIE_THICKNESS = 0.17;

const STEM_LENGTH = 3.5;
const STEM_THICKNESS = 0.12;
const BEAM_THICKNESS = 0.5;
const BEAM_SPACING = 0.75;
const LEDGER_OVERHANG = 0.28;

/** The rest glyph for each written value. */
const REST_GLYPHS: Record<NoteValue, GlyphName> = {
  whole: 'restWhole',
  half: 'restHalf',
  quarter: 'restQuarter',
  eighth: 'rest8th',
  sixteenth: 'rest16th',
  thirtySecond: 'rest32nd',
};

/** Flag glyphs by beam count, stem up then stem down. */
const FLAG_GLYPHS: Record<number, readonly [GlyphName, GlyphName]> = {
  1: ['flag8thUp', 'flag8thDown'],
  2: ['flag16thUp', 'flag16thDown'],
  3: ['flag32ndUp', 'flag32ndDown'],
};

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
    const glyph = FLAG_GLYPHS[flags][up ? 0 : 1];
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

/**
 * One end of a tie: a notehead to hang off, or a bare x to run to.
 *
 * The second case is a system edge. A tie whose other note is on the line below
 * still has to leave the line it is on, and it does that by running to the
 * margin — which is a position, with no notehead to measure against.
 */
export interface TieEnd {
  /** Centre of the notehead, or the margin itself when `headWidth` is absent. */
  x: number;
  headWidth?: number;
}

export interface TieSegment {
  from: TieEnd;
  to: TieEnd;
  /** The pitch both ends share — a tie joins one note to itself. */
  pitch: SpelledPitch;
  colour: string;
}

/**
 * Draws a tie between two noteheads.
 *
 * Curved away from the stem, which is the engraving rule and also the practical
 * one: a tie on the stem side runs into the stem, the beam and the flag, and on
 * a run of quavers it would be lost among them entirely.
 *
 * Tapered rather than stroked — thickest at the crown and vanishing at both
 * tips — because a tie of even weight reads as a slur drawn with a ruler. The
 * shape is two quadratics sharing their endpoints, filled: one for each edge.
 *
 * A tie broken across a system takes the same call with one end at the margin,
 * so the two halves are drawn by the same code and match.
 */
export function drawTie(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  tie: TieSegment,
): void {
  const direction = stemUp(m, tie.pitch) ? 1 : -1;
  const y =
    yForStep(m, diatonicStep(tie.pitch)) + direction * (0.5 + TIE_CLEARANCE) * m.staveSpace;

  const gap = TIE_CLEARANCE * m.staveSpace;
  const fromX =
    tie.from.headWidth === undefined ? tie.from.x : tie.from.x + tie.from.headWidth * TIE_INSET + gap;
  const toX =
    tie.to.headWidth === undefined ? tie.to.x : tie.to.x - tie.to.headWidth * TIE_INSET - gap;

  // Shallower on a short tie — a fixed rise across a semiquaver's width is a
  // hoop rather than a curve — but never so shallow that it reads as a dash.
  const span = Math.abs(toX - fromX);
  const rise =
    direction *
    Math.max(
      TIE_MIN_HEIGHT * m.staveSpace,
      Math.min(TIE_HEIGHT * m.staveSpace, span * 0.35),
    );
  const thickness = direction * TIE_THICKNESS * m.staveSpace;
  const midX = (fromX + toX) / 2;

  // A quadratic reaches half its control point's offset at the crown, hence the
  // doubling: the far edge is to sit `rise` from the line joining the tips.
  ctx.fillStyle = tie.colour;
  ctx.beginPath();
  ctx.moveTo(fromX, y);
  ctx.quadraticCurveTo(midX, y + 2 * rise, toX, y);
  ctx.quadraticCurveTo(midX, y + 2 * (rise - thickness), fromX, y);
  ctx.fill();
}

/**
 * How thick the bar of a multi-bar rest is, and how far its end caps reach
 * past it — both in stave spaces, and both measured from the middle line.
 *
 * One space thick with caps a half-space either side puts the caps on the
 * second and fourth lines, which is where an engraved H-bar sits.
 */
const MULTI_REST_THICKNESS = 1;
const MULTI_REST_CAP_RISE = 0.5;
/** How high above the top line the count sits, and how big it is set. */
const MULTI_REST_COUNT_RISE = 2;
const MULTI_REST_COUNT_SCALE = 0.8;

/**
 * A multi-bar rest: the thick bar, its end caps, and the count above.
 *
 * Drawn between two x positions rather than from one, because its width is a
 * property of the page and not of how long it lasts — a forty-bar rest is not
 * twice the width of a twenty-bar one, and the number is what says which it
 * is. The caller has already reserved the room; this fills it.
 */
export function drawMultiBarRest(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  fromX: number,
  toX: number,
  bars: number,
  colour: string,
): void {
  const { staveSpace, middleLineY } = m;
  const thickness = staveSpace * MULTI_REST_THICKNESS;
  const rise = staveSpace * MULTI_REST_CAP_RISE;
  const top = middleLineY - thickness / 2;
  // Never thinner than a pixel, the same floor the stems and bar lines take.
  const capWidth = Math.max(1, staveSpace * 0.16);

  ctx.fillStyle = colour;
  ctx.fillRect(fromX, top, toX - fromX, thickness);
  ctx.fillRect(fromX, top - rise, capWidth, thickness + rise * 2);
  ctx.fillRect(toX - capWidth, top - rise, capWidth, thickness + rise * 2);

  drawNumberGlyphs(
    ctx,
    m,
    bars,
    (fromX + toX) / 2,
    m.topLineY - staveSpace * MULTI_REST_COUNT_RISE,
    MULTI_REST_COUNT_SCALE,
  );
}

export function drawRest(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  x: number,
  duration: Duration,
  colour: string,
): void {
  const glyph = REST_GLYPHS[duration.value];
  ctx.fillStyle = colour;
  drawGlyph(ctx, glyph, x, m.middleLineY, m.staveSpace);

  /*
   * A dotted rest gets its dot, in the space above the middle line where an
   * engraver puts it.
   *
   * It was missing entirely, which barely showed while rests were filled at
   * the half-bar and came out in plain values — and is the ordinary case the
   * moment compound time arrives, where a rest of one beat *is* a dotted
   * crotchet. A rest drawn a third shorter than it lasts is the notation
   * lying about the bar.
   */
  if (duration.dotted) {
    drawGlyph(
      ctx,
      'augmentationDot',
      x + (glyphWidth(glyph) + DOT_GAP) * m.staveSpace,
      m.middleLineY - m.staveSpace * 0.5,
      m.staveSpace,
    );
  }
}

/**
 * How far a callout floats above whatever it has to clear, in stave spaces.
 *
 * Enough to clear a bar number as well as the stave, since above the top line
 * that is the other tenant: the number is tucked against the stave and the
 * capsule floats over it. See `BAR_NUMBER_RISE`.
 */
const HINT_CLEARANCE = 1.45;
/** Size of one valve number, and the vertical pitch of a stack of them. */
const HINT_SIZE = 0.85;
const HINT_ROW = 0.88;
/** Air inside the capsule, either side of the numbers and above and below. */
const HINT_PAD_X = 0.32;
const HINT_PAD_Y = 0.18;
/** Width of the tail where it leaves the capsule; it tapers to a point. */
const HINT_TAIL_WIDTH = 0.5;
/** How far down the tail its waist sits, as a fraction of its length. */
const HINT_TAIL_WAIST = 0.22;
/** How much of a gap the tail's point leaves above the note it aims at. */
const HINT_TAIL_GAP = 0.15;

/**
 * Where the top of a note's ink is, for anything that has to sit clear of it.
 *
 * Stems point away from the middle line, so an upward stem is the thing to
 * clear on a low note and the notehead itself on a high one — and a semibreve
 * has no stem to clear at all, which is what a callout's tail was aiming at
 * before this asked: on the range picker it stopped in mid-stave, three and a
 * half spaces above a note that had nothing there.
 */
function noteCeiling(m: StaveMetrics, pitch: SpelledPitch, duration?: Duration): number {
  const y = yForStep(m, diatonicStep(pitch));
  const stemmed = duration === undefined || duration.value !== 'whole';
  return stemmed && stemUp(m, pitch) ? y - STEM_LENGTH * m.staveSpace : y;
}

/**
 * The bottom of a fingering callout — where its tail leaves the capsule.
 *
 * Never lower than the top line, which is what turns this into a *lane*: every
 * note in or below the stave gets its capsule at the same height, with a longer
 * tail the further down it lives, so a row of hints reads as a row rather than
 * as marks scattered at the heights of the notes they belong to. A note above
 * the stave takes its capsule with it, since a fixed lane would be underneath.
 *
 * Published rather than kept inside the drawing because a canvas that has to
 * *contain* a callout needs the same answer the drawing uses — the range picker
 * sizes itself around its two, and sizing it by anything but this is how a
 * figure ends up with the numbers cropped along its top edge.
 */
export function fingeringHintY(m: StaveMetrics, pitch: SpelledPitch): number {
  return Math.min(m.topLineY, noteCeiling(m, pitch)) - m.staveSpace * HINT_CLEARANCE;
}

/** How far a callout's capsule stands above that point. */
export function fingeringHintRise(m: StaveMetrics, rows: number): number {
  return m.staveSpace * (2 * HINT_PAD_Y + rows * HINT_ROW);
}

/**
 * A fingering over a note: the valve numbers in a capsule, on a tapered tail
 * pointing down at the note they belong to.
 *
 * Stacked rather than written along the stave, which is the whole point of the
 * shape. "1-2-3" set as text is three characters of horizontal room in a place
 * that has none to spare — hints were being dropped for want of it, and the
 * ones that fitted ran into the bar numbers, which are set in the same band.
 * One number wide and three tall costs nothing horizontally, so hints can sit
 * over consecutive notes, and the capsule keeps them out of the numbers' way by
 * standing above them.
 *
 * The tail is what makes that legibility safe. A mark floating in a lane of its
 * own has stopped saying which note it is about; a line drawn to the note says
 * it exactly, and tapering means the end that has to be precise is a point
 * while the end that has to be *seen* is broad.
 *
 * The width check is the last word on `hints.ts`'s "if space permits". Which
 * notes deserve a hint is a musical question answered from the exercise and the
 * tempo; whether one fits is a question only the layout can answer.
 */
export function drawFingeringHint(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  note: LayoutNote,
  text: string,
  room: number,
  colour: string,
  /** What the capsule is filled with, so it sits *over* whatever it crosses. */
  background: string,
): void {
  const { staveSpace } = m;
  const rows = fingeringRows(text);
  const size = Math.max(8, Math.round(staveSpace * HINT_SIZE));

  ctx.save();
  ctx.font = `600 ${size}px system-ui, sans-serif`;

  const widest = Math.max(...rows.map((row) => ctx.measureText(row).width));
  const width = widest + 2 * HINT_PAD_X * staveSpace;
  if (width > room) {
    ctx.restore();
    return;
  }

  const height = fingeringHintRise(m, rows.length);
  const centreX = note.x + noteheadWidth(m, note.duration) / 2;
  const bottom = fingeringHintY(m, note.pitch);
  const top = bottom - height;

  // Down to the note's own ink, so the point lands on the thing it means and
  // not on the stem or the ledger lines in front of it.
  const tip = noteCeiling(m, note.pitch, note.duration) - HINT_TAIL_GAP * staveSpace;

  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;

  if (tip > bottom) {
    /*
     * Two curves meeting at the point, rather than a triangle: a straight taper
     * of this length reads as a wedge, and the eye follows a needle down to
     * where it lands far more readily than it follows a wedge.
     */
    const half = (HINT_TAIL_WIDTH * staveSpace) / 2;
    // The waist sits near the capsule, so the shape is broad where it leaves
    // the capsule and a fine line for the rest of the way down. Placed at the
    // middle it stays thick for half its length, which on the long tail a low
    // note needs reads as a stick rather than as a pointer.
    const waist = bottom + (tip - bottom) * HINT_TAIL_WAIST;
    ctx.beginPath();
    ctx.moveTo(centreX - half, bottom);
    ctx.quadraticCurveTo(centreX - half * 0.12, waist, centreX, tip);
    ctx.quadraticCurveTo(centreX + half * 0.12, waist, centreX + half, bottom);
    ctx.closePath();
    ctx.fill();
  }

  // The capsule last, so it covers the head of its own tail — and filled, so a
  // bar number or a ledger line behind it is passed over rather than tangled
  // with.
  const radius = Math.min(width, height) / 2;
  ctx.beginPath();
  ctx.roundRect(centreX - width / 2, top, width, height, radius);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.lineWidth = Math.max(1, staveSpace * 0.09);
  ctx.strokeStyle = colour;
  ctx.stroke();

  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  rows.forEach((row, index) => {
    ctx.fillText(row, centreX, top + (HINT_PAD_Y + HINT_ROW * (index + 0.5)) * staveSpace);
  });

  ctx.restore();
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

/** How far above or below the notes a tuplet bracket sits, in stave spaces. */
const TUPLET_CLEARANCE = 1.2;
/** How far the bracket's ends turn towards the notes. */
const TUPLET_HOOK = 0.45;

/**
 * The bracket and numeral over a triplet.
 *
 * Drawn on the side the stems are on, which is where an engraver puts it and
 * why: on the notehead side it collides with ledger lines and the numeral ends
 * up inside the stave. With one direction for the group, taken the same way a
 * beam takes it — whichever extreme is further from the middle line.
 *
 * The bracket is broken for the numeral rather than drawn under it, so the
 * figure reads as part of the mark rather than as something printed on top of
 * it.
 */
export function drawTuplet(
  ctx: CanvasRenderingContext2D,
  m: StaveMetrics,
  notes: LayoutNote[],
  numeral: number,
  colour: string,
): void {
  if (notes.length < 2) return;

  const steps = notes.map((n) => diatonicStep(n.pitch));
  const middleStep = m.bottomLineStep + 4;
  const up = Math.max(...steps) - middleStep <= middleStep - Math.min(...steps);
  const direction = up ? -1 : 1;

  // Clear of the furthest note in that direction, and of the stems if the
  // stems are on this side.
  const reach = up ? Math.max(...steps) : Math.min(...steps);
  const stem = STEM_LENGTH * m.staveSpace * direction;
  const y = yForStep(m, reach) + stem + TUPLET_CLEARANCE * m.staveSpace * direction;

  const headWidth = noteheadWidth(m, notes[0].duration);
  const left = notes[0].x;
  const right = notes[notes.length - 1].x + headWidth;
  const middle = (left + right) / 2;
  const gap = m.staveSpace * 0.75;
  const hook = TUPLET_HOOK * m.staveSpace * direction;

  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, m.staveSpace * 0.09);
  ctx.beginPath();
  ctx.moveTo(left, y - hook);
  ctx.lineTo(left, y);
  ctx.lineTo(middle - gap, y);
  ctx.moveTo(middle + gap, y);
  ctx.lineTo(right, y);
  ctx.lineTo(right, y - hook);
  ctx.stroke();

  ctx.fillStyle = colour;
  ctx.font = `italic ${(m.staveSpace * 1.6).toFixed(2)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(numeral), middle, y);
}
