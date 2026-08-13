/**
 * The two ends of a range, drawn where they live.
 *
 * The same argument as `note-chart.ts`: a bound named "G flat 3" asks the
 * reader to translate a letter, an accidental and an octave back into a place
 * on a stave, and the player who needs this app is the one for whom that
 * translation is the difficulty. So the bounds are semibreves on a stave, with
 * the fingering above each in the same relation the play surface puts it in.
 *
 * What this does that the fingering chart does not, and the reason it is its own
 * renderer rather than another caller of that one: **it makes room for whatever
 * it is given, furniture included.** The chart reserves a fixed thirteen
 * spaces, which is enough for notes near the stave and not enough for the ends
 * of a brass compass — a written C#3 in treble clef sits four and a half spaces
 * below the bottom line, exactly where that canvas stops. Here every extent is
 * measured, because the whole point of this figure is to show the extremes.
 *
 * The notes themselves are placed the way the chart places its own: evenly
 * across whatever is left after the clef and the key signature have taken their
 * room. The dials sit either side of the figure rather than beneath the notes,
 * so nothing outside the canvas depends on where in it a note lands — which is
 * what lets the header be measured rather than budgeted for, and lets the
 * figure stay legible when it is squeezed between two controls.
 */

import { needsAccidental, spellInKey } from '../domain/keys';
import type { SpelledPitch } from '../domain/pitch';
import type { Clef } from '../domain/instruments';
import { GLYPHS } from './glyphs';
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
  headerExtent,
  staveMetrics,
  yForPitch,
} from './stave';
import type { StaveTheme } from './surface';

export interface RangeBound {
  writtenMidi: number;
  /** "1-2", or "open", or "—" where the note has no fingering at all. */
  fingering: string;
}

export interface RangeStaveOptions {
  low: RangeBound;
  high: RangeBound;
  clef: Clef;
  /** Key the bounds are spelled in, so they read as the exercise will. */
  fifths: number;
  theme: StaveTheme;
}

/** Air between the outermost ink and the edge of the canvas, in stave spaces. */
const MARGIN = 0.4;

/**
 * How far the tallest accidental stands above the note it belongs to.
 *
 * Taken from the outlines rather than stated, since which one is drawn depends
 * on the key and the note and the answer wanted here is the worst case.
 */
const ACCIDENTAL_RISE = Math.max(
  -GLYPHS.accidentalFlat.bbox.top,
  -GLYPHS.accidentalSharp.bbox.top,
  -GLYPHS.accidentalNatural.bbox.top,
);

/** And how far below it they hang — a sharp is nearly symmetrical about it. */
const ACCIDENTAL_DROP = Math.max(
  GLYPHS.accidentalFlat.bbox.bottom,
  GLYPHS.accidentalSharp.bbox.bottom,
  GLYPHS.accidentalNatural.bbox.bottom,
);

/**
 * How far the drawing reaches above the top line and below the bottom one, in
 * stave spaces, counting everything that will be put on the canvas.
 *
 * Measured with a one-pixel stave space, which makes every distance below a
 * number of spaces and the whole thing independent of the size finally drawn
 * at.
 */
function inkExtent(
  clef: Clef,
  fifths: number,
  pitches: SpelledPitch[],
): { above: number; below: number } {
  const m = staveMetrics(clef, 0, 1);
  const header = headerExtent(clef, fifths);

  let top = -header.above;
  let bottom = m.bottomLineY + header.below;

  for (const pitch of pitches) {
    const y = yForPitch(m, pitch);
    // A notehead is a space tall, and its ledger lines never reach past it.
    top = Math.min(top, y - 0.5, fingeringHintY(m, pitch) - fingeringHintRise(m));
    bottom = Math.max(bottom, y + 0.5);
    if (needsAccidental(pitch, fifths)) {
      top = Math.min(top, y - ACCIDENTAL_RISE);
      bottom = Math.max(bottom, y + ACCIDENTAL_DROP);
    }
  }

  return { above: -top, below: bottom - m.bottomLineY };
}

/** Sizes the canvas to its width, draws, and returns the height used. */
export function drawRangeStave(canvas: HTMLCanvasElement, options: RangeStaveOptions): number {
  const { low, high, clef, fifths, theme } = options;
  const width = Math.max(1, canvas.getBoundingClientRect().width);
  /*
   * Twenty spaces of content: the widest header there is — a clef and seven
   * accidentals — and a column each for two notes. A fixed figure rather than a
   * measured one, deliberately: the notation should not change size when the
   * player changes key, and a signature that is narrower than the worst case
   * simply leaves its notes more room.
   *
   * The ceiling is well below the fingering chart's because height is what this
   * figure costs. A brass compass is thirteen spaces tall counting its ledger
   * lines, so every space the notation grows by is thirteen pixels of settings
   * screen — and on a wide window that buys nothing: the stave is already as
   * long as the row, and the notes only get bigger.
   */
  const staveSpace = Math.min(14, Math.max(9, width / 20));

  const pitches = [spellInKey(low.writtenMidi, fifths), spellInKey(high.writtenMidi, fifths)];
  const ink = inkExtent(clef, fifths, pitches);

  const topLineY = (ink.above + MARGIN) * staveSpace;
  const height = topLineY + (4 + ink.below + MARGIN) * staveSpace;

  const dpr = window.devicePixelRatio || 1;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const metrics = staveMetrics(clef, topLineY, staveSpace);
  ctx.strokeStyle = theme.stave;
  ctx.fillStyle = theme.stave;
  drawStaveLines(ctx, metrics, 0, width);

  // Both return the x to carry on from, so the header measures itself exactly
  // rather than being budgeted for — which matters most where there is least to
  // go round: seven flats on a phone take nearly half of what this is drawn in.
  let x = staveSpace * 0.4;
  x = drawClef(ctx, metrics, x);
  const headerWidth = drawKeySignature(ctx, metrics, x, fifths) + staveSpace * 0.5;

  const duration = { value: 'whole' as const, dotted: false };
  // Two even columns of what is left — but never wider than a note needs. On a
  // desktop, dividing the whole row between two semibreves pushes them to
  // opposite ends of the stave, where they read as two things rather than as a
  // range; seven spaces apart they stay a pair, and the stave simply runs on.
  const step = Math.min((width - headerWidth - staveSpace * 0.5) / 2, staveSpace * 7);

  [low, high].forEach((bound, index) => {
    const pitch = pitches[index];
    const note = {
      x: headerWidth + step * (index + 0.5) - noteheadWidth(metrics, duration) / 2,
      pitch,
      duration,
      showAccidental: needsAccidental(pitch, fifths),
      colour: theme.note,
    };
    drawNote(ctx, metrics, note);
    // A note's own column is the room its fingering has, which is the same
    // measure `note-chart.ts` gives one and generous for at most "1-2-3".
    drawFingeringHint(ctx, metrics, note, bound.fingering, step, theme.note);
  });

  return height;
}
