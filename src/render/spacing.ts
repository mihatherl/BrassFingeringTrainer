/**
 * Engraved spacing: how much room each note gets.
 *
 * Printed music does not divide a line into equal bars. A bar of demisemiquaver
 * runs takes most of a system; a bar holding one semibreve is short. Spacing
 * follows the notes, not the barlines, and a page fits whatever it fits.
 *
 * Nor is the room proportional to duration — a semibreve does not take sixteen
 * times a semiquaver, or a page of held notes would be nothing but white. The
 * rule engravers use is that each halving of a note's value takes about three
 * quarters of the room, which is a power law with a fractional exponent. Four
 * times the duration comes out at not quite twice the width.
 *
 * The unit is anchored to the shortest note in the exercise, which is given
 * exactly the least room it can have without colliding with its neighbour.
 * Everything longer is then measured against it. So a study in crotchets packs
 * as tightly as crotchets can go, while the same screen showing semiquavers
 * spaces its crotchets nearly twice as wide — which is the point, since in that
 * exercise a crotchet really is the long note.
 *
 * This is for music that stands still. Scrolling music is spaced by how fast it
 * should travel, and giving it uneven spacing would make it surge and stall as
 * it crossed the strike line.
 */

import { barCount, beatOfBar } from '../domain/metre';
import type { Exercise } from '../exercise/types';

/**
 * Least room the shortest note may have, in notehead widths.
 *
 * Below about one, adjacent noteheads touch and then overlap. The margin above
 * that is what stops a run of semiquavers reading as a smear.
 */
export const NOTE_CLEARANCE = 1.3;

/** How much room a note keeps when its value is halved. */
const HALVING_RATIO = 0.75;

/** The power law that ratio implies: width ∝ duration ^ 0.415… */
const EXPONENT = Math.log2(1 / HALVING_RATIO);

export interface Spacing {
  /**
   * Distance from the start of the music to a beat position, in pixels.
   *
   * Defined outside the exercise as well as inside it: the count-in sits at
   * negative beats, and the last note needs somewhere for its bar line to go.
   */
  xOf(beat: number): number;
  /** The inverse, for working out how much music a width holds. */
  beatAt(x: number): number;
  /** Width of the whole exercise. */
  readonly width: number;
  /** Whole bars that fit in `available` pixels, starting at `fromBar`. Never 0. */
  barsFitting(fromBar: number, available: number): number;
  /** Mean pixels per beat. Not what anything is positioned by; for reporting. */
  readonly averagePixelsPerBeat: number;
}

export interface SpacingOptions {
  /**
   * Least room any column may have — a notehead plus enough to tell it from the
   * next one. The shortest note in the exercise is given exactly this.
   */
  minColumnWidth: number;
  /**
   * Widest a single bar may be. Below this nothing is squeezed; above it the
   * whole exercise is scaled down together, so a bar too wide for the screen
   * shrinks the page rather than falling off the end of it.
   */
  maxBarWidth?: number;
  /**
   * Anything a note needs beyond its own notehead, by note index.
   *
   * An accidental hangs to the *left* of the note it alters, so it takes room
   * from the gap in front of it; a dot hangs to the right and takes room from
   * the gap behind. Neither is part of the notehead, and a spacing rule that
   * counts only noteheads will happily lay a sharp on top of its neighbour.
   */
  extraWidthFor?: (noteIndex: number) => { before: number; after: number };
  /**
   * Room to reserve immediately before every bar line, on top of the note
   * clearance already given to whatever precedes it.
   *
   * A bar line is drawn set back from its column rather than on it — see
   * `BAR_LINE_SETBACK` — and that setback lands inside whatever gap the
   * previous note was given. Left unaccounted for, a bar's last note can end
   * up sitting on the line that is supposed to follow it, most visibly when
   * that note is also the shortest in the exercise and its column is already
   * packed to the floor.
   */
  barLineRoom?: number;
  /**
   * Extra room immediately before a beat where the key changes, on top of the
   * bar-line allowance — a change lands on a bar line and needs both.
   *
   * A function rather than a figure, unlike `barLineRoom`, because each change
   * is a different width: it carries a natural for every accidental of the key
   * being left as well as the accidentals of the one being joined. Returns 0
   * for a beat where nothing changes.
   */
  keyChangeRoomAt?: (beat: number) => number;
}

export function engraveSpacing(exercise: Exercise, options: SpacingOptions): Spacing {
  const { totalBeats, metres } = exercise;
  const totalBars = barCount(metres, totalBeats);
  const columns = columnBeats(exercise);

  // Gaps between consecutive columns are the durations that matter: what a note
  // is written as decides its glyph, but what follows it decides its room.
  const gaps: number[] = [];
  for (let i = 0; i < columns.length - 1; i++) gaps.push(columns[i + 1] - columns[i]);

  const shortest = gaps.length > 0 ? Math.min(...gaps) : 1;
  const unit = options.minColumnWidth / shortest ** EXPONENT;

  /*
   * Each column has two parts, and only one of them can give.
   *
   * The elastic part is what the duration asks for. The floor is what the
   * glyphs physically occupy — the notehead clearance, plus this note's dot and
   * the next note's accidental, both of which live in this gap rather than in a
   * note's own width. Squeezing that is how a sharp ends up on top of whatever
   * precedes it.
   */
  const elastic = gaps.map((gap) => unit * gap ** EXPONENT);
  const noteAt = notesByBeat(exercise);
  const barBoundaries = barBoundaryBeats(exercise);
  const floors = gaps.map((_, index) =>
    floorWidth(noteAt, columns, index, options, barBoundaries),
  );

  const offsetsAt = (give: number) => {
    const offsets = [0];
    for (let i = 0; i < gaps.length; i++) {
      offsets.push(offsets[i] + Math.max(floors[i], give * elastic[i]));
    }
    return offsets;
  };

  const widestBar = (offsets: number[]) => {
    const at = (beat: number) => interpolate(columns, offsets, beat);
    let widest = 0;
    for (let bar = 0; beatOfBar(metres, bar) < totalBeats; bar++) {
      widest = Math.max(widest, at(beatOfBar(metres, bar + 1)) - at(beatOfBar(metres, bar)));
    }
    return widest;
  };

  let offsets = offsetsAt(1);
  let scale = 1;
  const limit = options.maxBarWidth;

  if (limit !== undefined && limit > 0 && widestBar(offsets) > limit) {
    // Take the elastic room away first, by halving the interval until the
    // widest bar fits. Twenty passes settles it to well under a pixel.
    let tooTight = 0;
    let roomy = 1;
    for (let pass = 0; pass < 20; pass++) {
      const give = (tooTight + roomy) / 2;
      if (widestBar(offsetsAt(give)) <= limit) tooTight = give;
      else roomy = give;
    }
    offsets = offsetsAt(tooTight);

    // Still over means the glyphs alone will not fit, and something has to
    // give: a bar running off the side of the screen is worse than a cramped
    // one, since at least a cramped bar can be read slowly.
    const stubborn = widestBar(offsets);
    if (stubborn > limit) scale = limit / stubborn;
  }

  const xOf = (beat: number) => interpolate(columns, offsets, beat) * scale;
  const width = xOf(totalBeats);

  return {
    xOf,
    beatAt: (x: number) => interpolate(offsets.map((o) => o * scale), columns, x),
    width,
    averagePixelsPerBeat: totalBeats > 0 ? width / totalBeats : 0,
    barsFitting(fromBar, available) {
      const start = xOf(beatOfBar(metres, fromBar));
      let bars = 0;
      while (
        fromBar + bars < totalBars &&
        xOf(beatOfBar(metres, fromBar + bars + 1)) - start <= available
      ) {
        bars++;
      }
      // A bar too wide for the space still has to be shown; the alternative is
      // a page holding nothing.
      return Math.max(1, bars);
    },
  };
}

/** What a column must hold whatever its duration asks for. */
function floorWidth(
  noteAt: Map<number, number>,
  columns: number[],
  index: number,
  options: SpacingOptions,
  barBoundaries: Set<number>,
): number {
  const extra = options.extraWidthFor;
  const here = noteAt.get(columns[index]);
  const next = noteAt.get(columns[index + 1]);
  const barLine = barBoundaries.has(columns[index + 1]) ? (options.barLineRoom ?? 0) : 0;
  // Summed with the bar line's own room rather than replacing it: a change
  // sits on a bar line and the double bar has to clear the note before it.
  const keyChange = options.keyChangeRoomAt?.(columns[index + 1]) ?? 0;

  return (
    options.minColumnWidth +
    barLine +
    keyChange +
    (extra === undefined || here === undefined ? 0 : extra(here).after) +
    (extra === undefined || next === undefined ? 0 : extra(next).before)
  );
}

/** Which note, if any, begins at each beat. */
function notesByBeat(exercise: Exercise): Map<number, number> {
  const byBeat = new Map<number, number>();
  exercise.notes.forEach((note, index) => byBeat.set(note.startBeat, index));
  return byBeat;
}

/** Every beat a bar line falls on, including the closing one. */
function barBoundaryBeats(exercise: Exercise): Set<number> {
  const { totalBeats, metres } = exercise;
  const bars = barCount(metres, totalBeats);
  const beats = new Set<number>([totalBeats]);
  for (let bar = 1; bar < bars; bar++) {
    beats.add(beatOfBar(metres, bar));
  }
  return beats;
}

/**
 * Every position that needs its own column.
 *
 * Note and rest onsets because something is drawn there, and bar starts because
 * a bar line has to land on a column boundary rather than part-way through an
 * interpolation — otherwise a bar with a syncopated first note pulls its own
 * line out of place.
 */
function columnBeats(exercise: Exercise): number[] {
  const beats = new Set<number>([0, exercise.totalBeats]);
  for (const note of exercise.notes) beats.add(note.startBeat);
  for (const rest of exercise.rests) beats.add(rest.startBeat);
  const { totalBeats, metres } = exercise;
  const bars = barCount(metres, totalBeats);
  for (let bar = 0; bar < bars; bar++) {
    beats.add(beatOfBar(metres, bar));
  }
  return [...beats].sort((a, b) => a - b);
}

/**
 * Maps a value through a pair of matched, ascending sequences.
 *
 * Used in both directions — beats to pixels and back — so the two stay exact
 * inverses of one another by construction. Outside the range it continues at
 * the rate of the nearest segment, which is what puts the count-in somewhere
 * sensible and gives the final bar line room.
 */
function interpolate(from: number[], to: number[], value: number): number {
  const last = from.length - 1;
  if (last < 1) return to[0] ?? 0;

  if (value <= from[0]) {
    const rate = (to[1] - to[0]) / (from[1] - from[0]);
    return to[0] + (value - from[0]) * rate;
  }
  if (value >= from[last]) {
    const rate = (to[last] - to[last - 1]) / (from[last] - from[last - 1]);
    return to[last] + (value - from[last]) * rate;
  }

  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (from[mid] <= value) low = mid;
    else high = mid;
  }
  const span = from[high] - from[low];
  return span === 0 ? to[low] : to[low] + ((value - from[low]) / span) * (to[high] - to[low]);
}
