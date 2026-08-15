/**
 * The composer: a tune from cells, calibrated to a level.
 *
 * What Themes became on 2026-08-16, and why: the hand-written corpus read a
 * level or two easier than the sight-reading of the same name — an octave
 * where the walk spanned an octave and a half, no accidentals where it had
 * one in six, no rests where it breathed twice a bar — and the choice was to
 * write hundreds more tunes by hand or to build this. See
 * `docs/tunes-plan.md` for the measurement and the plan.
 *
 * A tune is two four-bar phrases: an antecedent that opens, moves, moves and
 * closes on the dominant or the mediant, and a consequent that does the same
 * and closes on the tonic. Each bar is a cell from `cells.ts`, written in
 * steps from an anchor, and the whole of the composing is choosing anchors —
 * so that joins step rather than jump, so that a close lands where a close
 * lands, and so that the tune *reaches* the range its level allows rather
 * than sitting inside an octave. Then the diatonic line is inflected: an
 * accidental where a neighbour, a passing note or a repeated note invites
 * one, at the level's chance; a breath where a bar can spare its last note,
 * at the level's chance.
 *
 * What comes out is a `Theme`, and everything after that is what already
 * existed — placement, key tours across tunes, ties, triplet snapping and the
 * joins the tempo plan uses — unchanged.
 */

import type { Metre } from '../domain/metre';
import { MAJOR_SCALE } from '../domain/keys';
import { CELL_LEVELS, cellsFor, type Cell, type CellLevel } from './cells';
import type { Difficulty } from './difficulty';
import type { Rng } from './rng';
import { validateTheme, type Theme, type ThemeEvent } from './theme';

export interface ComposeOptions {
  difficulty: Difficulty;
  metre: Metre;
  rng: Rng;
  /** What the tune is called in the exercise; ids must differ within one. */
  id: string;
}

/**
 * How far a tune at each level should reach, in diatonic steps, and where its
 * window sits against the home tonic (step 0).
 *
 * The span is what sixteen bars of sight-reading at that level actually reach,
 * measured, converted to steps at twelve semitones to seven — the walk's pool
 * is wider than what it reaches, and the tune is held to the reach. The window
 * sits a little more above the tonic than below, which is where tunes sit.
 */
export const REACH: Record<CellLevel, { low: number; span: number }> = {
  beginner: { low: -2, span: 7 },
  easy: { low: -2, span: 9 },
  medium: { low: -3, span: 12 },
  hard: { low: -4, span: 15 },
};

/**
 * The least of its window a tune must actually reach, as a fraction. A tune
 * that reaches less is composed again — a level's reach is the whole reason
 * the window exists, and a tune that sits in the middle of it is a tune of
 * the level below.
 */
const REACH_FLOOR = 0.75;

/** How many times to compose before settling for what came out. */
const ATTEMPTS = 6;

/**
 * The widest join between one cell's last note and the next cell's first, in
 * steps. Inside a cell the leaps are whatever its author wrote; between cells
 * the composer holds them to the level. Beginner reads a third at most,
 * Hard a sixth.
 */
const JOIN: Record<CellLevel, number> = { beginner: 2, easy: 3, medium: 4, hard: 5 };

/** Bars in a phrase, and phrases in a tune. */
const PHRASE_BARS = 4;
const PHRASES = 2;
/** How long every tune is, in bars: two phrases of four. */
export const TUNE_BARS = PHRASE_BARS * PHRASES;

/** Degrees a tune may begin on and its first phrase may close on: stable ones. */
const STABLE = [0, 2, 4];
const HALF_CLOSE = [4, 2];

/**
 * How much more often an eligible note is inflected than the walk's per-note
 * chance. Only some of a tune's notes are neighbours, passing notes or
 * repeats that invite an accidental, so the chance is scaled up on those to
 * land the whole tune near the walk's rate. Settled by measurement, in
 * `compose.test`.
 */
const INFLECTION_SCALE = 6;

interface Placed {
  cell: Cell;
  anchor: number;
}

type LineNote = { step: number; beats: number; tied?: true; alter?: number };
type LineRest = { rest: true; beats: number };
type Line = Array<LineNote | LineRest>;

/**
 * Composes one tune, or null where the metre has no cells to compose from.
 * Composed again, a few times, if the first does not reach its level's range
 * or does not validate; the rng runs on, so each attempt differs.
 */
export function composeTune(options: ComposeOptions): Theme | null {
  const level = options.difficulty.id as CellLevel;
  if (!CELL_LEVELS.includes(level)) return null;

  let fallback: Theme | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const composed = attemptTune(options, level);
    // A placement can fail outright in a small window with few cells; that is
    // an attempt lost, not a tune lost.
    if (!composed) continue;
    const { theme, reach } = composed;
    if (validateTheme(theme).length > 0) continue;
    if (reach >= REACH[level].span * REACH_FLOOR) return theme;
    fallback ??= theme;
  }
  return fallback;
}

function attemptTune(
  options: ComposeOptions,
  level: CellLevel,
): { theme: Theme; reach: number } | null {
  const { difficulty, metre, rng } = options;
  const signature: readonly [number, number] = [metre.beatsPerBar, metre.beatUnit];

  const opens = cellsFor(signature, level, 'open');
  const moves = cellsFor(signature, level, 'move');
  const closes = cellsFor(signature, level, 'close');
  if (opens.length === 0 || moves.length === 0 || closes.length === 0) return null;

  const window = REACH[level];
  const low = window.low;
  const high = window.low + window.span;
  const join = JOIN[level];

  const placed: Placed[] = [];
  let lastStep: number | null = null;
  let reachedLow = Infinity;
  let reachedHigh = -Infinity;

  const stepsOf = (cell: Cell) =>
    cell.events.filter((e) => e.step !== undefined).map((e) => e.step!);
  const firstStep = (cell: Cell) => stepsOf(cell)[0];
  const lastStepOf = (cell: Cell) => stepsOf(cell)[stepsOf(cell).length - 1];

  /** Anchors at which every note of the cell lies inside the window. */
  const anchorsInWindow = (cell: Cell): number[] => {
    const steps = stepsOf(cell);
    const min = Math.min(...steps);
    const max = Math.max(...steps);
    const anchors: number[] = [];
    for (let a = low - min; a <= high - max; a++) anchors.push(a);
    return anchors;
  };

  /**
   * How far a placement would push the tune's reach outwards, in steps: the
   * whole of what the steering wants. Zero once the window is reached.
   */
  const extension = (cell: Cell, anchor: number) => {
    const steps = stepsOf(cell).map((s) => s + anchor);
    const lo = Math.min(...steps);
    const hi = Math.max(...steps);
    return Math.max(0, reachedLow - lo) + Math.max(0, hi - reachedHigh);
  };

  const commit = (cell: Cell, anchor: number) => {
    placed.push({ cell, anchor });
    for (const s of stepsOf(cell)) {
      reachedLow = Math.min(reachedLow, s + anchor);
      reachedHigh = Math.max(reachedHigh, s + anchor);
    }
    lastStep = lastStepOf(cell) + anchor;
  };

  /**
   * Places an open or a move: an anchor inside the window, joining by no more
   * than the level allows plus any slack given, weighted towards extending
   * the reach. The very first note of a tune lands on a stable degree near
   * the tonic, so that two tunes can abut and so that the tune sounds like it
   * starts.
   */
  const placeFree = (cell: Cell, slack: number): boolean => {
    let candidates = anchorsInWindow(cell);
    if (lastStep === null) {
      candidates = candidates.filter((a) => {
        const first = a + firstStep(cell);
        return STABLE.includes(((first % 7) + 7) % 7) && Math.abs(first) <= 4;
      });
    } else {
      const last = lastStep;
      candidates = candidates.filter(
        (a) => Math.abs(a + firstStep(cell) - last) <= join + slack,
      );
    }
    if (candidates.length === 0) return false;
    const anchor = rng.weighted(candidates, (a) => 1 + 3 * extension(cell, a));
    commit(cell, anchor);
    return true;
  };

  /**
   * Places a close: its last note on one of the degrees given, in any octave
   * inside the window, joining from the note before by no more than the
   * level allows plus the slack, and as gently as it can within that.
   */
  const placeClose = (cell: Cell, degrees: readonly number[], slack: number): boolean => {
    const last = lastStep ?? 0;
    const endStep = lastStepOf(cell);
    const gap = (a: number) => Math.abs(a + firstStep(cell) - last);
    const candidates = anchorsInWindow(cell).filter(
      (a) => degrees.includes((((a + endStep) % 7) + 7) % 7) && gap(a) <= join + slack,
    );
    if (candidates.length === 0) return false;
    // The gentlest join, with a little room for the rng so two closes differ.
    const anchor = rng.weighted(candidates, (a) => 1 / (1 + gap(a)));
    commit(cell, anchor);
    return true;
  };

  /**
   * Picks a cell to place: the one preferred, if it will go, and otherwise
   * the rest in a random order until one does — then the same again with a
   * step of slack on the join. A cell can refuse a place — a close whose
   * shape climbs cannot end on the dominant inside a Beginner window — and
   * that is the cell's problem, not the tune's.
   */
  const placeOneOf = (
    preferred: Cell | null,
    pool: readonly Cell[],
    place: (cell: Cell, slack: number) => boolean,
  ): Cell | null => {
    for (const slack of [0, 1, 2]) {
      if (preferred && place(preferred, slack)) return preferred;
      for (const cell of rng.shuffle(pool.filter((c) => c !== preferred))) {
        if (place(cell, slack)) return cell;
      }
    }
    return null;
  };

  /**
   * A cell of the tune's own level, where the level has any: a level's tune
   * must be harder than the level below in some respect, which the validator
   * checks, and a tune built entirely from the cells it inherited would not
   * be. Own-level cells are preferred three to one, and the first move of the
   * tune is always one.
   */
  const own = (pool: readonly Cell[]) => pool.filter((c) => c.level === level);
  const prefer = (pool: readonly Cell[]) => {
    const mine = own(pool);
    return mine.length > 0 && rng.chance(0.75) ? rng.pick(mine) : rng.pick(pool);
  };

  /**
   * The phrases. The consequent usually opens as the antecedent did — that is
   * what makes it an answer — and a move is often the last move a step along,
   * which is what gives a tune a motif rather than a run of unrelated bars.
   */
  let firstOpen: Cell | null = null;
  let lastMove: Placed | null = null;
  let ownPlaced = false;
  for (let phrase = 0; phrase < PHRASES; phrase++) {
    const wanted: Cell = firstOpen && rng.chance(0.6) ? firstOpen : prefer(opens);
    const open = placeOneOf(wanted, opens, placeFree);
    if (!open) return null;
    firstOpen ??= open;
    ownPlaced ||= open.level === level;

    for (let bar = 1; bar < PHRASE_BARS - 1; bar++) {
      if (lastMove && rng.chance(0.5)) {
        // The last move again, a step or two along — towards the unreached
        // end of the window if there is one — if that lies in the window and
        // joins; otherwise a move like any other.
        const move = lastMove.cell;
        const shifts = rng.shuffle([1, -1, 2, -2]).map((d) => lastMove!.anchor + d);
        const legal = shifts.filter(
          (a) =>
            anchorsInWindow(move).includes(a) &&
            Math.abs(a + firstStep(move) - (lastStep ?? 0)) <= join,
        );
        if (legal.length > 0) {
          commit(move, rng.weighted(legal, (a) => 1 + 3 * extension(move, a)));
          lastMove = placed[placed.length - 1];
          continue;
        }
      }
      const forceOwn = !ownPlaced && own(moves).length > 0;
      const pool = forceOwn ? own(moves) : moves;
      const move = placeOneOf(forceOwn ? rng.pick(pool) : prefer(moves), pool, placeFree);
      if (!move) return null;
      ownPlaced ||= move.level === level;
      lastMove = placed[placed.length - 1];
    }

    const degrees = phrase === PHRASES - 1 ? [0] : HALF_CLOSE;
    const close = placeOneOf(prefer(closes), closes, (c, slack) =>
      placeClose(c, degrees, slack),
    );
    if (!close) return null;
  }

  const line = inflect(lineOf(placed, difficulty, rng), difficulty, rng);
  return {
    theme: {
      id: options.id,
      name: options.id,
      difficulty: difficulty.id,
      metres: [signature],
      bars: PHRASE_BARS * PHRASES,
      events: toEvents(line),
    },
    reach: reachedHigh - reachedLow,
  };
}

/**
 * The placed cells as one line of absolute steps and rests — breathing as it
 * goes: at the level's chance, scaled by how many notes the bar has, the last
 * note of a bar that is not a close becomes a rest, where it is short, not
 * the first note of its bar and not held into the next. The walk rests at
 * that chance per slot; a tune breathes at bar ends, which is where a player
 * does.
 */
function lineOf(placed: readonly Placed[], difficulty: Difficulty, rng: Rng): Line {
  const line: Line = [];
  placed.forEach(({ cell, anchor }, index) => {
    const next = placed[index + 1];
    const notes = cell.events.filter((e) => !e.rest);
    const breathe =
      cell.role !== 'close' &&
      difficulty.restChance > 0 &&
      notes.length > 1 &&
      rng.chance(Math.min(0.5, difficulty.restChance * cell.events.length));

    cell.events.forEach((event, i) => {
      if (event.rest) {
        line.push({ rest: true, beats: event.beats });
        return;
      }
      const step = event.step! + anchor;
      const isLast = i === cell.events.length - 1;
      // A tie is kept only where the next bar really begins on this note.
      const tied =
        event.tied &&
        isLast &&
        next !== undefined &&
        next.cell.events[0].step !== undefined &&
        next.cell.events[0].step + next.anchor === step;
      if (breathe && isLast && !tied && event.beats <= 1) {
        line.push({ rest: true, beats: event.beats });
      } else if (tied) {
        line.push({ step, beats: event.beats, tied: true });
      } else {
        line.push({ step, beats: event.beats });
      }
    });
  });
  return line;
}

/** The semitones from a scale step up to the next. */
function toneAbove(step: number): number {
  const from = ((step % 7) + 7) % 7;
  const to = (from + 1) % 7;
  return (((MAJOR_SCALE[to] - MAJOR_SCALE[from]) % 12) + 12) % 12;
}

/**
 * Inflects the diatonic line with accidentals where the music invites them,
 * each at the level's chance:
 *
 * - a note left by a whole-tone step *up*, having been approached from above
 *   or by a leap, is raised — F sharp under G, D sharp under E, C up to F
 *   sharp and on to G: a lower neighbour or a leading-note approach;
 * - a sixth or seventh degree left by a whole-tone step *down*, having been
 *   approached from below or by a leap, is lowered — A flat over G, B flat
 *   falling to A, E up to A flat and down to G: an upper neighbour or a
 *   descending chromatic;
 * - a repeated note whose repeat is left by a whole-tone step gets that
 *   repeat inflected towards it — C C sharp D, E E flat D: the chromatic
 *   passing note, in the one place a fixed rhythm has room for it.
 *
 * Nothing else: an accidental placed by rule reads as a chromatic note in a
 * tune, and one placed at random reads as a misprint. Spelling is the key's
 * own, downstream.
 */
function inflect(line: Line, difficulty: Difficulty, rng: Rng): Line {
  const chance = Math.min(1, difficulty.accidentalChance * INFLECTION_SCALE);
  if (chance === 0) return line;
  const notes = line
    .map((event, index) => ({ event, index }))
    .filter((e): e is { event: LineNote; index: number } => !('rest' in e.event));

  const alters = new Map<number, number>();
  for (let i = 1; i < notes.length - 1; i++) {
    const prev = notes[i - 1].event.step;
    const cur = notes[i].event.step;
    const next = notes[i + 1].event.step;
    if (notes[i].event.tied || notes[i - 1].event.tied) continue;
    // Never two in a row: a raised note against a lowered one beside it is
    // an interval nobody writes.
    if (alters.has(notes[i - 1].index)) continue;
    const degree = ((cur % 7) + 7) % 7;
    const upIsTone = toneAbove(cur) === 2;
    const downIsTone = toneAbove(cur - 1) === 2;

    // Approached by step from the other side, or by a leap from either.
    const approach = Math.abs(prev - cur);
    let alter = 0;
    if (next === cur + 1 && upIsTone && (prev > cur || approach >= 2)) alter = 1;
    else if (next === cur - 1 && downIsTone && [5, 6].includes(degree) && (prev < cur || approach >= 2))
      alter = -1;
    else if (prev === cur && next === cur + 1 && upIsTone) alter = 1;
    else if (prev === cur && next === cur - 1 && downIsTone) alter = -1;

    if (alter !== 0 && rng.chance(chance)) alters.set(notes[i].index, alter);
  }

  return line.map((event, index) =>
    alters.has(index) ? { ...(event as LineNote), alter: alters.get(index) } : event,
  );
}

/** Absolute steps to the degrees and octaves a `Theme` is written in. */
function toEvents(line: Line): ThemeEvent[] {
  return line.map((event) => {
    if ('rest' in event) return { rest: true, beats: event.beats };
    const degree = ((event.step % 7) + 7) % 7 + 1;
    const octave = Math.floor(event.step / 7);
    const out: ThemeEvent = { degree, beats: event.beats };
    if (octave !== 0) out.octave = octave;
    if (event.alter) out.alter = event.alter;
    if (event.tied) out.tied = true;
    return out;
  });
}
