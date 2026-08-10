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

import { keyAt } from '../domain/keys';
import type { TempoEvent } from '../domain/tempo';
import type { Exercise } from '../exercise/types';
import {
  drawBeamGroup,
  drawTuplet,
  drawFingeringHint,
  drawNote,
  drawRest,
  drawTie,
  noteheadWidth,
  type LayoutNote,
} from './notes';
import { drawGlyph, glyphWidth } from './glyphs';
import type { Spacing } from './spacing';
import {
  drawBarLine,
  drawClef,
  drawKeySignature,
  drawStaveLines,
  drawTimeSignature,
  layoutKeySignature,
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

/**
 * Left margin before the clef, in stave spaces — and before the key signature
 * directly, on a system that skips the clef.
 */
export const MUSIC_MARGIN = 0.4;

/** Gap between the two lines of the double bar at a key change. */
const DOUBLE_BAR_GAP = 0.45;
/** Gap between that double bar and the signature it introduces. */
const KEY_CHANGE_LEAD = 0.5;

/**
 * Room a change of key needs, beyond what the bar line already takes.
 *
 * The double bar, the gap after it, and the signature itself — which for a
 * change is wider than an ordinary one, since it carries the naturals
 * cancelling the key being left as well as the accidentals of the key being
 * joined.
 *
 * Lives here rather than in `spacing.ts` because it is glyph arithmetic, and
 * the engraver deliberately takes every pixel figure from its caller. The
 * spacing must reserve exactly this or the change will be drawn over the note
 * before it.
 */
export function keyChangeRoom(metrics: StaveMetrics, from: number, to: number): number {
  const { width } = layoutKeySignature(metrics, to, from);
  return width + metrics.staveSpace * (KEY_CHANGE_LEAD + DOUBLE_BAR_GAP);
}

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
  /**
   * Whether to draw the clef at the head of this system. The key and time
   * signature are drawn regardless.
   *
   * The clef is the one element of the three a player never needs restated —
   * unlike the other two it cannot change mid-exercise even once key changes
   * exist, since a change of clef mid-part is not a thing brass notation does.
   * So a caller showing several systems at once — several stacked on one
   * screen — can ask for the courtesy repeat of just the clef to be skipped on
   * all but the first and get a little of that space back for music, while the
   * key and time signature stay in view on every line: both are live
   * information a reader may need to check mid-piece, more so once either can
   * change partway through. Static callers such as the results review draw
   * the clef on every system too, as engraved music conventionally does.
   */
  clef: boolean;
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

/**
 * The metronome mark's note against a full-sized one, and where the mark sits
 * above the stave. Cue-sized, as printed parts set it: the mark is an
 * instruction about the music, not a note of it.
 */
const MARK_SCALE = 0.75;
/**
 * Gap between the mark's notehead and its dot, in stave spaces before the
 * mark's own scaling. The same 0.3 the stave uses behind a notehead, so a
 * dotted crotchet in the mark is spaced like a dotted crotchet in the music.
 */
const MARK_DOT_GAP = 0.3;
const MARK_RISE = 2.5;

/**
 * The beat a tempo event's mark anchors to on the page, or null for events
 * that print nothing there.
 *
 * A step marks the beat it takes force; a rit marks where the broadening
 * begins — its far end needs no mark of its own, since either a new metronome
 * mark stands there or the music ends. A hold prints on its note rather than
 * over a bar line, and not until stage 3 gives it a glyph.
 */
export function tempoMarkBeat(event: TempoEvent): number | null {
  if (event.kind === 'tempo') return event.atBeat;
  if (event.kind === 'ramp') return event.fromBeat;
  return null;
}

/**
 * A change of key: the double bar, the naturals cancelling what is being left,
 * and the new signature.
 *
 * Positioned from the downbeat the change takes force at, and stacked leftwards
 * from there — the signature finishes where the downbeat's own clearance
 * begins. All of it has to fit between the last note of the old key and the
 * first of the new, which is why `keyChangeRoom` is reserved in the spacing
 * before any of this is drawn.
 *
 * Exported for the same reason `drawTempoEvent` is: the scrolling surface draws
 * one endless line rather than systems, and a change of key has to look the
 * same and sit in the same place whichever way the music is being read. It was
 * missing there entirely — the key simply switched in the fixed header as the
 * playhead crossed it, with nothing travelling towards the strike line to say
 * it was coming.
 */
export function drawKeyChange(
  ctx: CanvasRenderingContext2D,
  metrics: StaveMetrics,
  downbeatX: number,
  to: number,
  from: number,
  colour: string,
): void {
  const { staveSpace } = metrics;
  const { width } = layoutKeySignature(metrics, to, from);
  const signatureX = downbeatX - BAR_LINE_SETBACK * staveSpace - width;
  const lineX = signatureX - staveSpace * KEY_CHANGE_LEAD;

  ctx.strokeStyle = colour;
  drawBarLine(ctx, metrics, lineX);
  drawBarLine(ctx, metrics, lineX - staveSpace * DOUBLE_BAR_GAP);
  ctx.fillStyle = colour;
  drawKeySignature(ctx, metrics, signatureX, to, from);
}

/**
 * A tempo event's mark above the stave: a cue-sized beat note with "= 96" for
 * a step, "rit." for a ramp.
 *
 * Drawn from the exercise's own tempo events and nowhere else: the mark is
 * the page stating what the clock will actually do, and both read the same
 * data so neither can lie about the other. The note is the notehead glyph
 * with a stem, not font text, because the music fonts are embedded as paths
 * and a ♩ from the system font would render differently on every device.
 *
 * **The note is the beat the number counts, which in compound time is a dotted
 * crotchet.** Printing a plain crotchet against a dotted-crotchet number is
 * the page misquoting its own clock by half again, and it is the same mistake
 * in ink that the tempo setting used to make in seconds.
 *
 * A ramp prints "rit." unconditionally because the plan writes no accels;
 * the day it does, the label needs the tempo in force, which is the map's to
 * answer rather than something to reconstruct here.
 *
 * Exported for the scrolling surface, which draws its own endless line rather
 * than systems and needs the same mark at the same beat.
 */
export function drawTempoEvent(
  ctx: CanvasRenderingContext2D,
  metrics: StaveMetrics,
  x: number,
  event: TempoEvent,
  colour: string,
  dotted = false,
): void {
  const { staveSpace } = metrics;
  const y = metrics.topLineY - staveSpace * MARK_RISE;
  const textY = y + staveSpace * 0.4;

  ctx.save();
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (event.kind === 'tempo') {
    const headWidth = glyphWidth('noteheadBlack') * staveSpace * MARK_SCALE;
    const stemWidth = Math.max(1, staveSpace * 0.12 * MARK_SCALE);
    const stemRise = staveSpace * 2.6 * MARK_SCALE;

    drawGlyph(ctx, 'noteheadBlack', x, y, staveSpace * MARK_SCALE);
    // Up on the right of the head, as every stem this size is.
    ctx.fillRect(x + headWidth - stemWidth, y - stemRise, stemWidth, stemRise);

    /*
     * The dot sits after the head at the head's own height, exactly as it does
     * on the stave — and it is the same `augmentationDot` glyph the notes use,
     * not a drawn circle. Two reasons: a mark that quotes a dotted crotchet
     * should be printing the dot the reader has just seen on the page, and the
     * glyph is a path from the embedded font, so it renders identically
     * everywhere and through the SVG shim the engraving snapshots draw with.
     */
    let width = headWidth;
    if (dotted) {
      const gap = MARK_DOT_GAP * staveSpace * MARK_SCALE;
      drawGlyph(ctx, 'augmentationDot', x + headWidth + gap, y, staveSpace * MARK_SCALE);
      width = headWidth + gap + glyphWidth('augmentationDot') * staveSpace * MARK_SCALE;
    }

    ctx.font = `600 ${Math.round(staveSpace * 1.25)}px system-ui, sans-serif`;
    ctx.fillText(`= ${event.bpm}`, x + width + staveSpace * 0.5, textY);
  } else if (event.kind === 'ramp') {
    // Italic, as every printed part sets it.
    ctx.font = `italic 600 ${Math.round(staveSpace * 1.25)}px system-ui, sans-serif`;
    ctx.fillText('rit.', x, textY);
  }

  ctx.restore();
}

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

  // The key and time signature are drawn regardless; only the clef is ever
  // skipped, from a plain margin in its place. See `SystemOptions.clef`.
  let x = staveSpace * MUSIC_MARGIN;
  if (options.clef) x = drawClef(ctx, metrics, x);
  // The key this system opens in, which is not necessarily the one the
  // exercise opened in.
  x = drawKeySignature(ctx, metrics, x, keyAt(exercise.keys, firstBeat));
  // Where the music proper starts, which is where a tie arriving from the
  // system above has to begin.
  const musicLeft = drawTimeSignature(ctx, metrics, x, beatsPerBar, beatUnit);

  /*
   * Changes of key falling inside this system, as opposed to at its head —
   * the one at the head is already stated by the signature above.
   *
   * Each takes the full apparatus a part prints: a double bar to say something
   * structural is happening, the naturals cancelling what is being left, then
   * the new signature. All of it has to sit between the last note of the old
   * key and the first note of the new one, which is why `keyChangeRoom` is
   * reserved in the spacing before any of this is drawn.
   */
  const changes = new Map<number, number>();
  for (const change of exercise.keys) {
    if (change.fromBeat <= firstBeat || change.fromBeat >= lastBeat) continue;
    // The key being left, which is whatever was in force just before.
    changes.set(change.fromBeat, keyAt(exercise.keys, change.fromBeat - 1e-6));
  }

  // Every bar line except the one at the head of the system, which the start
  // of the stave already marks, and those belonging to a change, which are
  // drawn below at the position the signature leaves them.
  ctx.strokeStyle = theme.stave;
  for (let beat = firstBeat + barBeats; beat <= lastBeat; beat += barBeats) {
    if (changes.has(beat)) continue;
    drawBarLine(ctx, metrics, xForBeat(beat) - BAR_LINE_SETBACK * staveSpace);
  }

  for (const [beat, from] of changes) {
    drawKeyChange(ctx, metrics, xForBeat(beat), keyAt(exercise.keys, beat), from, theme.stave);
  }

  for (const rest of exercise.rests) {
    if (rest.startBeat < firstBeat || rest.startBeat >= lastBeat) continue;
    drawRest(ctx, metrics, xForBeat(rest.startBeat), rest.duration, theme.stave);
  }

  /*
   * Tempo marks falling on this system — including at its head, unlike a key
   * change there: the signature restates a key on every line, but nothing
   * restates a tempo, so a mark landing where the page turned must still be
   * seen.
   */
  for (const event of exercise.tempo) {
    const beat = tempoMarkBeat(event);
    if (beat === null || beat < firstBeat || beat >= lastBeat) continue;
    drawTempoEvent(
      ctx,
      metrics,
      xForBeat(beat) - BAR_LINE_SETBACK * staveSpace,
      event,
      theme.note,
      exercise.metre.isCompound,
    );
  }

  const loose: LayoutNote[] = [];
  const beamed = new Map<number, LayoutNote[]>();
  const tuplets = new Map<number, LayoutNote[]>();
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

    if (note.tupletGroup >= 0) {
      const group = tuplets.get(note.tupletGroup) ?? [];
      group.push(item);
      tuplets.set(note.tupletGroup, group);
    }

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
   * After the notes, because the bracket is placed against where their stems
   * actually ended up, and before the ties, which arch over everything.
   *
   * A group cut in half by a system break draws the part that is on this
   * system: the same treatment a beam gets, and the same reasoning — half a
   * bracket at the margin says "this continues" where nothing at all would say
   * the rhythm changed.
   */
  for (const group of tuplets.values()) {
    drawTuplet(ctx, metrics, group, 3, theme.note);
  }

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
