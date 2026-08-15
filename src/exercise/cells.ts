/**
 * The cells: one bar of music each, from which the composer assembles tunes.
 *
 * A cell is written in **diatonic steps from an anchor** rather than in
 * degrees, so the composer can put it anywhere in the scale — a figure that
 * climbs a third is the same figure on the tonic and on the dominant, and a
 * sequence is the same cell a step along. Where the anchor lands is the
 * composer's business: it chooses so that joins step, so that a phrase closes
 * on the degree it should, and so that the tune reaches the range its level
 * allows. See `compose.ts`, and `docs/tunes-plan.md` for why any of this
 * exists.
 *
 * Each cell says what it is *for* — opening a phrase, carrying one on, or
 * closing one — and the level it first belongs to, which is a statement about
 * its rhythm and its shape: a level uses cells at or below itself. Level here
 * is exactly what `validateTheme` already checks on a whole tune, so a cell
 * written too fast for its level fails every tune it is composed into.
 *
 * ## The notation
 *
 * A bar is a run of tokens, `<step><duration>` — `0q` is the anchor as a
 * crotchet, `2e` two steps above it as a quaver, `-1h` a step below as a
 * minim. Durations: `w h q e s` for semibreve to semiquaver, a trailing `.`
 * for dotted, `t` for a triplet quaver (which come in threes) and `T` for a
 * triplet crotchet. `r` in place of a step is a rest. A trailing `~` ties the
 * note into whatever comes next, which the composer honours only where the
 * next cell begins on the same step, and drops otherwise.
 *
 * ## Writing one
 *
 * Opens begin on a note the composer can put on a stable degree — it will,
 * so write the shape you want and let it place it. Closes are anchored by
 * their **last** note, which the composer puts on the dominant or mediant at
 * a half close and on the tonic at the end; the shape leading to it is the
 * cadence. Moves are the middle of a phrase; a good move can be sequenced —
 * played again a step higher or lower — and still sound like music, since the
 * composer will do exactly that.
 */

export type CellRole = 'open' | 'move' | 'close';
export type CellLevel = 'beginner' | 'easy' | 'medium' | 'hard';

export interface CellEvent {
  /** Diatonic steps from the cell's anchor; absent for a rest. */
  step?: number;
  /** Length in crotchets. */
  beats: number;
  rest?: true;
  tied?: true;
}

export interface Cell {
  id: string;
  metre: readonly [number, number];
  role: CellRole;
  level: CellLevel;
  events: readonly CellEvent[];
}

const DURATIONS: Record<string, number> = {
  w: 4,
  h: 2,
  q: 1,
  e: 0.5,
  s: 0.25,
  t: 1 / 3,
  T: 2 / 3,
};

/** Reads the notation above into events; a mistake throws, at load. */
export function parseCell(bar: string): CellEvent[] {
  return bar
    .trim()
    .split(/\s+/)
    .map((token) => {
      const match = /^(r|-?\d+)([whqesTt])(\.?)(~?)$/.exec(token);
      if (!match) throw new Error(`cannot read cell token "${token}" in "${bar}"`);
      const [, step, code, dot, tie] = match;
      const beats = DURATIONS[code] * (dot ? 1.5 : 1);
      if (step === 'r') return { beats, rest: true } as CellEvent;
      const event: CellEvent = { step: Number(step), beats };
      if (tie) event.tied = true;
      return event;
    });
}

type Spec = readonly [id: string, role: CellRole, level: CellLevel, bar: string];

function corpus(metre: readonly [number, number], specs: readonly Spec[]): Cell[] {
  return specs.map(([id, role, level, bar]) => ({
    id: `${metre[0]}${metre[1]}-${id}`,
    metre,
    role,
    level,
    events: parseCell(bar),
  }));
}

/*
 * Four-four. The bulk of the corpus, since it is the bulk of what is read.
 */
const FOUR_FOUR = corpus([4, 4], [
  // Opens — a first bar; the composer puts its first note on a stable degree.
  ['rise', 'open', 'beginner', '0q 1q 2q 3q'],
  ['fall', 'open', 'beginner', '0q -1q -2q -3q'],
  ['third-up', 'open', 'beginner', '0h 2h'],
  ['repeat-step', 'open', 'beginner', '0q 0q 1q 2q'],
  ['arpeggio', 'open', 'beginner', '0q 2q 4q 2q'],
  ['long-short', 'open', 'beginner', '0h 1q 2q'],
  ['fifth-fall', 'open', 'beginner', '4q 2q 0h'],
  ['neighbour', 'open', 'beginner', '0q 1q 0q 2q'],
  ['skip-run', 'open', 'easy', '0q 2q 1e 2e 3q'],
  ['quaver-turn', 'open', 'easy', '0e 1e 0e -1e 0h'],
  ['run-up', 'open', 'easy', '0e 1e 2e 3e 4h'],
  ['fanfare', 'open', 'easy', '0q 0e 0e 2q 4q'],
  ['leap-back', 'open', 'easy', '0h 4q 3q'],
  ['dotted-call', 'open', 'medium', '0q. 1e 2q 4q'],
  ['pushed', 'open', 'medium', '0e 2q 1e 0h'],
  ['answer-dotted', 'open', 'medium', '4q. 3e 2q 0q'],
  ['climb-dotted', 'open', 'medium', '0q. 1e 2q. 3e'],
  ['semi-run', 'open', 'hard', '0s 1s 2s 3s 4q 2q 0q'],
  ['triplet-lift', 'open', 'hard', '0t 1t 2t 4q 3q 2q'],
  ['snap', 'open', 'hard', '0e. 1s 2q 4e 2e 0q'],
  ['flourish', 'open', 'hard', '0e 2s 4s 5q 4e 2e 0q'],
  // Moves — the middle of a phrase; sequenced freely.
  ['step-up', 'move', 'beginner', '0q 1q 2q 1q'],
  ['step-down', 'move', 'beginner', '0q -1q -2q -1q'],
  ['held-step', 'move', 'beginner', '0h 1h'],
  ['zigzag', 'move', 'beginner', '0q 2q 1q 3q'],
  ['skip-back', 'move', 'beginner', '0q 2q 0q -1q'],
  ['two-and-two', 'move', 'beginner', '0q 0q 2h'],
  ['walk-down', 'move', 'easy', '0e -1e -2e -3e -2q 0q'],
  ['turn', 'move', 'easy', '0e 1e 0e -1e 0q 2q'],
  ['skip-quavers', 'move', 'easy', '0e 2e 1e 3e 2q 4q'],
  ['echo', 'move', 'easy', '0e 0e 1q 2e 2e 3q'],
  ['leap-and-fill', 'move', 'easy', '0q 4q 3e 2e 1q'],
  ['off-beat', 'move', 'medium', '0e 1q 2e 3q 4q'],
  ['dotted-walk', 'move', 'medium', '0q. 1e 2q. 3e'],
  ['dotted-back', 'move', 'medium', '0q. -1e -2q 0q'],
  ['rest-then-run', 'move', 'medium', 'rq 0e 1e 2e 3e 4q'],
  ['syncopated', 'move', 'medium', '0e 2q 1e 0q. -1e'],
  ['semi-turn', 'move', 'hard', '0s 1s 0s -1s 0e 2e 4q 3q'],
  ['triplet-walk', 'move', 'hard', '0t 1t 2t 3t 4t 5t 6q 4q'],
  ['snap-run', 'move', 'hard', '0e. 1s 2e. 3s 4e 2e 0q'],
  ['broken-chord', 'move', 'hard', '0s 2s 4s 6s 7q 4e 2e 0q'],
  ['rest-flurry', 'move', 'hard', 're 0e 1s 2s 3s 4s 5q 3q'],
  // Closes — anchored on the last note, which the composer places.
  ['step-close', 'close', 'beginner', '2q 1q 0h'],
  ['fall-close', 'close', 'beginner', '4q 2q 1q 0q'],
  ['long-close', 'close', 'beginner', '1h 0h'],
  ['lean-close', 'close', 'beginner', '-1q 1q 0h'],
  ['whole-close', 'close', 'beginner', '0w'],
  ['run-close', 'close', 'easy', '3e 2e 1e -1e 0h'],
  ['turn-close', 'close', 'easy', '1e 0e -1e 0e 0h'],
  ['leap-close', 'close', 'easy', '4q -1q 0h'],
  ['breath-close', 'close', 'easy', '2q 1q 0q rq'],
  ['dotted-close', 'close', 'medium', '2q. 1e 0h'],
  ['pushed-close', 'close', 'medium', '1e 0q. 0h'],
  ['suspended-close', 'close', 'medium', '1q. 1e 0h'],
  ['semi-close', 'close', 'hard', '3s 2s 1s -1s 0e. 0s 0h'],
  ['triplet-close', 'close', 'hard', '2t 1t -1t 0q 0h'],
  ['snap-close', 'close', 'hard', '1e. 0s 1e. 0s 0h'],
]);

/*
 * Three-four. Waltzes and minuets: the first beat carries the weight.
 */
const THREE_FOUR = corpus([3, 4], [
  ['rise', 'open', 'beginner', '0q 1q 2q'],
  ['long-two', 'open', 'beginner', '0h 2q'],
  ['arpeggio', 'open', 'beginner', '0q 2q 4q'],
  ['fall', 'open', 'beginner', '4q 2q 0q'],
  ['lilt', 'open', 'easy', '0q 1e 2e 3q'],
  ['skip', 'open', 'easy', '0e 2e 4q 3q'],
  ['swing', 'open', 'medium', '0q. 1e 2q'],
  ['pushed', 'open', 'medium', '0e 2q 4e 3q'],
  ['flourish', 'open', 'hard', '0s 1s 2s 3s 4q 2q'],
  ['triplet-rise', 'open', 'hard', '0t 1t 2t 4q 3q'],
  ['step-up', 'move', 'beginner', '0q 1q 2q'],
  ['step-down', 'move', 'beginner', '0q -1q -2q'],
  ['held-step', 'move', 'beginner', '0h 1q'],
  ['skip-back', 'move', 'beginner', '0q 2q 1q'],
  ['turn', 'move', 'easy', '0e 1e 0e -1e 0q'],
  ['run', 'move', 'easy', '0e 1e 2e 3e 4q'],
  ['dotted-walk', 'move', 'medium', '0q. 1e 2q'],
  ['off-beat', 'move', 'medium', '0e 1q 2e 3q'],
  ['rest-run', 'move', 'medium', 'rq 0e 1e 2q'],
  ['semi-turn', 'move', 'hard', '0s 1s 0s -1s 0e 2e 4q'],
  ['triplet-walk', 'move', 'hard', '0t 1t 2t 3q 4q'],
  ['snap-walk', 'move', 'hard', '0e. 1s 2e. 3s 4q'],
  ['step-close', 'close', 'beginner', '1q 0h'],
  ['fall-close', 'close', 'beginner', '2q 1q 0q'],
  ['long-close', 'close', 'beginner', '0h.'],
  ['turn-close', 'close', 'easy', '1e -1e 0h'],
  ['breath-close', 'close', 'easy', '1q 0q rq'],
  ['dotted-close', 'close', 'medium', '1q. 1e 0q'],
  ['pushed-close', 'close', 'medium', '1e 0q. 0q'],
  ['semi-close', 'close', 'hard', '2s 1s -1s 0s 0h'],
  ['triplet-close', 'close', 'hard', '2t 1t -1t 0h'],
]);

/*
 * Two-four. Marches and quicksteps: two beats and not much room.
 */
const TWO_FOUR = corpus([2, 4], [
  ['rise', 'open', 'beginner', '0q 1q'],
  ['third', 'open', 'beginner', '0q 2q'],
  ['long', 'open', 'beginner', '0h'],
  ['fall', 'open', 'beginner', '2q 0q'],
  ['quaver-rise', 'open', 'easy', '0e 1e 2q'],
  ['fanfare', 'open', 'easy', '0e 0e 4q'],
  ['skip', 'open', 'easy', '0e 2e 4e 2e'],
  ['dotted', 'open', 'medium', '0q. 1e'],
  ['pushed', 'open', 'medium', '0e 2q 1e'],
  ['semi-rise', 'open', 'hard', '0s 1s 2s 3s 4q'],
  ['snap', 'open', 'hard', '0e. 1s 2q'],
  ['step-up', 'move', 'beginner', '0q 1q'],
  ['step-down', 'move', 'beginner', '0q -1q'],
  ['skip-back', 'move', 'beginner', '0q 2q'],
  ['held', 'move', 'beginner', '0h'],
  ['walk', 'move', 'easy', '0e 1e 2e 3e'],
  ['turn', 'move', 'easy', '0e 1e 0e -1e'],
  ['off-beat', 'move', 'medium', '0e 1q 2e'],
  ['dotted-walk', 'move', 'medium', '0q. 1e'],
  ['rest-run', 'move', 'medium', 're 0e 1e 2e'],
  ['semi-walk', 'move', 'hard', '0s 1s 2s 3s 4e 2e'],
  ['snap-walk', 'move', 'hard', '0e. 1s 2e. 3s'],
  ['step-close', 'close', 'beginner', '1q 0q'],
  ['long-close', 'close', 'beginner', '0h'],
  ['fall-close', 'close', 'beginner', '2q 0q'],
  ['turn-close', 'close', 'easy', '1e -1e 0q'],
  ['breath-close', 'close', 'easy', '0q rq'],
  ['dotted-close', 'close', 'medium', '1q. 0e'],
  ['pushed-close', 'close', 'medium', '1e 0q 0e'],
  ['semi-close', 'close', 'hard', '2s 1s -1s 0s 0q'],
  ['snap-close', 'close', 'hard', '1e. 0s 0q'],
]);

/*
 * Six-eight. Two dotted-crotchet pulses; quavers in threes.
 */
const SIX_EIGHT = corpus([6, 8], [
  // Beginner reads nothing shorter than a crotchet, which in six-eight is
  // dotted crotchets: two to the bar, and the tune moves on the pulse.
  ['two-pulses', 'open', 'beginner', '0q. 2q.'],
  ['pulse-step', 'open', 'beginner', '0q. 1q.'],
  ['pulse-fall', 'open', 'beginner', '2q. 0q.'],
  ['pulse-fifth', 'open', 'beginner', '0q. 4q.'],
  ['lilt', 'open', 'easy', '0e 1e 2e 3q.'],
  ['long-lift', 'open', 'easy', '0q. 1q 2e'],
  ['step-lift', 'open', 'easy', '0q 1e 2q.'],
  ['skip-lilt', 'open', 'easy', '0e 2e 4e 3q 2e'],
  ['run-lilt', 'open', 'easy', '0e 1e 2e 3e 4e 5e'],
  ['fall', 'open', 'easy', '4q. 2q 0e'],
  ['pushed', 'open', 'medium', '0e 2q 4q.'],
  ['dotted-lilt', 'open', 'medium', '0q. 1e 2e 3e'],
  ['semi-lilt', 'open', 'hard', '0s 1s 2e 3e 4q.'],
  ['flight', 'open', 'hard', '0e 2s 3s 4e 5e 4e 2e'],
  ['pulse-up', 'move', 'beginner', '0q. 1q.'],
  ['pulse-down', 'move', 'beginner', '0q. -1q.'],
  ['pulse-skip', 'move', 'beginner', '0q. 2q.'],
  ['pulse-back', 'move', 'beginner', '2q. 1q.'],
  ['step-lilt', 'move', 'easy', '0q 1e 2q 1e'],
  ['held-lilt', 'move', 'easy', '0q. 1q 2e'],
  ['skip-back', 'move', 'easy', '0q. 2q 0e'],
  ['walk', 'move', 'easy', '0e 1e 2e 3e 2e 1e'],
  ['turn', 'move', 'easy', '0e 1e 0e -1e 0e 2e'],
  ['dotted-walk', 'move', 'medium', '0q. 1e 2e 3e'],
  ['rest-lilt', 'move', 'medium', 're 0e 1e 2q.'],
  ['semi-walk', 'move', 'hard', '0s 1s 2s 3s 4e 5e 4e 2e'],
  ['snap-lilt', 'move', 'hard', '0e. 1s 2e 3q.'],
  ['pulse-close', 'close', 'beginner', '1q. 0q.'],
  ['pulse-fall-close', 'close', 'beginner', '2q. 0q.'],
  ['long-close', 'close', 'beginner', '0h.'],
  ['step-close', 'close', 'easy', '1q 1e 0q.'],
  ['fall-close', 'close', 'easy', '2q 1e 0q.'],
  ['turn-close', 'close', 'easy', '1e -1e 0e 0q.'],
  ['run-close', 'close', 'easy', '3e 2e 1e 0q.'],
  ['breath-close', 'close', 'easy', '1e 0q rq.'],
  ['dotted-close', 'close', 'medium', '1q. 0e 0q'],
  ['pushed-close', 'close', 'medium', '2e 1q 0q.'],
  ['semi-close', 'close', 'hard', '2s 1s -1s 0s 0e 0q.'],
]);

export const CELLS: readonly Cell[] = [...FOUR_FOUR, ...THREE_FOUR, ...TWO_FOUR, ...SIX_EIGHT];

/** The levels in order, so "at or below" is a comparison of indices. */
export const CELL_LEVELS: readonly CellLevel[] = ['beginner', 'easy', 'medium', 'hard'];

/** Cells for a metre at a level: the level's own and every level below it. */
export function cellsFor(
  metre: readonly [number, number],
  level: CellLevel,
  role?: CellRole,
): Cell[] {
  const ceiling = CELL_LEVELS.indexOf(level);
  return CELLS.filter(
    (cell) =>
      cell.metre[0] === metre[0] &&
      cell.metre[1] === metre[1] &&
      CELL_LEVELS.indexOf(cell.level) <= ceiling &&
      (role === undefined || cell.role === role),
  );
}
