/**
 * Exercise generation.
 *
 * Rhythm and pitch are generated separately: the rhythm decides how many notes
 * there are and when they fall, then a pitch strategy fills the slots. That
 * split means a new kind of exercise only needs a new pitch strategy, and every
 * kind gets dotted rhythms, rests and beaming for free.
 */

import { isPlayable, primaryFingering } from '../domain/fingering';
import {
  soundingFromWritten,
  writtenRange,
  type Clef,
  type Instrument,
} from '../domain/instruments';
import {
  keyAt,
  MAJOR_SCALE,
  orderByCloseness,
  scalePitchClasses,
  tonicPitchClass,
  type KeyChange,
} from '../domain/keys';
import {
  durationBeats,
  durationFromBeats,
  NOTE_VALUES,
  type Duration,
} from '../domain/rhythm';
import { pitchClass } from '../domain/pitch';
import type { Difficulty } from './difficulty';
import type { Metre } from '../domain/metre';
import { createRng, type Rng } from './rng';
import { assembleExercise, type Slot } from './assemble';
import type { Exercise, ExerciseKind } from './types';

export interface GenerateOptions {
  instrument: Instrument;
  clef: Clef;
  /** Written key signature the exercise opens in, on the circle of fifths. */
  fifths: number;
  /**
   * Every key the exercise may move through, `fifths` among them.
   *
   * One entry, or none given, means it stays where it started.
   */
  keySet?: readonly number[];
  difficulty: Difficulty;
  kind: ExerciseKind;
  /** Length of free material. Patterns are measured in `cycles` instead. */
  bars: number;
  /**
   * Times a scale or arpeggio is played through, up and back down.
   *
   * A pattern's length is its own rather than a number of bars: how many bars a
   * scale occupies is a consequence of how many notes it has, and asking for
   * bars is what used to stop one half way up. Ignored by free material.
   */
  cycles: number;
  /** The time signature and what follows from it; see `metre.ts`. */
  metre: Metre;
  seed: number;
  /**
   * Per written-pitch weighting used to bias selection toward notes the player
   * gets wrong. Values above 1 make a note more likely. Ignored by the scale
   * generator, whose material is fixed by definition.
   */
  noteWeights?: ReadonlyMap<number, number>;
}

interface Candidate {
  midi: number;
  /** The fingering it is played with, so repeats can be avoided. */
  mask: number;
}

/**
 * Whether a note belongs to a key, memoised per key.
 *
 * Asked rather than cached on the candidate, because an exercise can change
 * key and a note's diatonicity changes with it — B natural is foreign to E
 * flat and native to C. It was a field on `Candidate`, settled once for the
 * whole exercise, which is the assumption key changes break most quietly:
 * everything would still generate, and every accidental would be reckoned
 * against the wrong key.
 *
 * The set behind it is small and the answer is asked for every candidate of
 * every note, so it is worth not rebuilding.
 */
const scaleCache = new Map<number, Set<number>>();
function diatonicIn(midi: number, fifths: number): boolean {
  let scale = scaleCache.get(fifths);
  if (!scale) {
    scale = scalePitchClasses(fifths);
    scaleCache.set(fifths, scale);
  }
  return scale.has(pitchClass(midi));
}

/**
 * Narrows a pool by a preference, keeping the pool untouched if honouring the
 * preference would leave nothing to choose from.
 *
 * Every rule about which notes to favour is a preference rather than a
 * constraint: on a narrow range, or at the bottom of an instrument, there may
 * simply be no note that satisfies it, and a duller exercise is better than none.
 */
function prefer(pool: Candidate[], wanted: (candidate: Candidate) => boolean): Candidate[] {
  const kept = pool.filter(wanted);
  return kept.length > 0 ? kept : pool;
}

/** Every writable duration, longest first, for filling a gap. */
const LONGEST_FIRST: Duration[] = NOTE_VALUES.flatMap((value) => [
  { value, dotted: true },
  { value, dotted: false },
]).sort((a, b) => durationBeats(b) - durationBeats(a));

/**
 * Fills a span with rests, in as few as will write cleanly.
 *
 * Longest first, but never across the middle of the bar: a rest straddling the
 * strongest division inside a bar hides where the beat is, which is the one
 * thing a rest must not do to someone counting. Odd bars have no such division
 * to respect, so they are simply filled.
 *
 * Every duration in use is a multiple of a semiquaver and every value here is a
 * dyadic fraction of a crotchet, so this terminates exactly rather than
 * approximately.
 */
function restsFilling(from: number, beats: number, metre: Metre): Slot[] {
  const { barBeats } = metre;
  const half = barBeats / 2;
  const splitsInHalf = Number.isInteger(half);

  const slots: Slot[] = [];
  let at = from;
  let left = beats;

  while (left > 1e-9) {
    // How much may be spent before the next division worth respecting.
    const toBoundary = splitsInHalf ? half - (at % half) : Infinity;
    const room = Math.min(left, toBoundary > 1e-9 ? toBoundary : half);
    const duration = LONGEST_FIRST.find((d) => durationBeats(d) <= room + 1e-9);
    // Nothing writable fits, which cannot happen for any metre on offer; giving
    // up beats looping forever.
    if (!duration) break;

    slots.push({ startBeat: at, duration, isRest: true, tiedFromPrevious: false });
    at += durationBeats(duration);
    left -= durationBeats(duration);
  }

  return slots;
}

export function generateExercise(options: GenerateOptions): Exercise {
  const rng = createRng(options.seed);
  const { metre } = options;
  const candidates = candidatePitches(options);
  if (candidates.length === 0) {
    throw new Error('No playable notes in range for this instrument and difficulty');
  }

  // Closest-first, so every change is a step around the circle rather than a
  // jump. One key means the list of one this has always produced.
  const ordered = orderByCloseness(options.fifths, options.keySet ?? [options.fifths]);

  /*
   * A pattern is generated the other way round from everything else.
   *
   * Free material takes a fixed number of bars and fills them with whatever
   * notes; a scale is a fixed shape, and how many bars it occupies falls out of
   * how long that shape is. So its contour is worked out first, and the rhythm
   * is built to hold a whole number of cycles of it. See `patternSlots`.
   *
   * With more than one key there is a contour per key, because a scale in B
   * flat is a different set of notes from one in E flat — changing key without
   * changing the shape would be a change of signature and nothing else. Cycles
   * are dealt out to the keys in contiguous blocks, so a key is finished with
   * before the next is taken up.
   *
   * A pattern that will not fit the instrument's compass is not a pattern, and
   * falls back to free material in the length free material is measured in.
   */
  const patterns = options.kind === 'scales' ? SCALE_PATTERNS : ARPEGGIO_PATTERNS;
  const contourFor = new Map<number, number[]>();
  if (isPattern(options.kind)) {
    for (const fifths of ordered) {
      const shape = patternContour(rng, { ...options, fifths }, candidates, patterns);
      if (shape) contourFor.set(fifths, shape);
    }
  }

  // Every key has to have produced a shape, or the blocks below would fall
  // back mid-exercise and the notes would stop being the pattern.
  const patterned = isPattern(options.kind) && contourFor.size === ordered.length;
  const cycleKeys = patterned
    ? Array.from(
        { length: options.cycles },
        (_, i) => ordered[Math.floor((i * ordered.length) / options.cycles)],
      )
    : [];

  const built = patterned
    ? patternSlots(
        rng,
        options,
        metre,
        cycleKeys.map((fifths) => contourFor.get(fifths)!.length),
      )
    : {
        slots: generateRhythm(rng, options, metre, isPattern(options.kind)),
        totalBeats: options.bars * metre.barBeats,
        cycleStarts: [] as number[],
      };
  const { slots, totalBeats } = built;

  /*
   * Where the key changes.
   *
   * A pattern's changes are not planned separately but read back off the
   * cycles, because the cycles were already built to the shape of a particular
   * key — planning them twice would let the two disagree about which key a
   * cycle is in, and the notes would then be laid out to the wrong shape.
   * Free material has no such constraint and is spread across its bar lines.
   */
  const keys = patterned
    ? keysFromCycles(cycleKeys, built.cycleStarts)
    : planKeyChanges(ordered, totalBeats, barLineCandidates(totalBeats, metre));

  // A tie continuation is not a choice of pitch — it is the note before it,
  // held — so the pitch generators are asked for one fewer note per tie.
  const soundedSlots = slots.filter((s) => !s.isRest && !s.tiedFromPrevious);
  const keyForNote = (index: number) => keyAt(keys, soundedSlots[index]?.startBeat ?? 0);

  const pitches = patterned
    ? patternPitches(soundedSlots, keys, contourFor)
    : generatePitches(
        rng,
        options,
        candidates,
        soundedSlots.length,
        freshStarts(slots),
        keyForNote,
      );

  return assembleExercise(slots, pitches, {
    instrument: options.instrument,
    clef: options.clef,
    keys,
    metre,
    totalBeats,
    seed: options.seed,
    kind: options.kind,
  });
}

/**
 * Every note the instrument can actually play, within the difficulty's range.
 *
 * The range is centred on the middle of the instrument's compass rather than on
 * an absolute pitch, so "one octave" means a comfortable octave on a tuba as
 * well as on a cornet.
 */
function candidatePitches(options: GenerateOptions): Candidate[] {
  const [lowest, highest] = writtenRange(options.instrument, options.clef);
  const centre = Math.round((lowest + highest) / 2);
  const half = Math.floor(options.difficulty.rangeSemitones / 2);
  const low = Math.max(lowest, centre - half);
  const high = Math.min(highest, centre + half);

  const candidates: Candidate[] = [];
  for (let midi = low; midi <= high; midi++) {
    const sounding = soundingFromWritten(midi, options.instrument, options.clef);
    if (!isPlayable(sounding, options.instrument)) continue;
    candidates.push({
      midi,
      mask: primaryFingering(sounding, options.instrument)?.mask ?? 0,
    });
  }
  return candidates;
}

/** Scales and arpeggios, which are drilled differently from free material. */
export function isPattern(kind: ExerciseKind): boolean {
  return kind === 'scales' || kind === 'arpeggios';
}

/** Spans a pattern falls back to when the full one will not fit. */
const SPAN_FALLBACKS = [24, 12, 7];

/**
 * The largest span that fits, and the roots it fits from.
 *
 * Two octaves needs 24 semitones of headroom above the tonic, and a brass
 * instrument's written compass is around 30 — so whether it fits at all depends
 * on where the key's tonic happens to sit. On an Eb bass, Eb and F manage two
 * octaves while Bb and C can only reach one. Shrinking is the honest response;
 * the alternative is a pattern that runs off the top half-finished.
 */
function fitSpan(
  low: number,
  high: number,
  rootClass: number,
  wanted: number,
): { span: number; roots: number[] } | null {
  for (const span of [wanted, ...SPAN_FALLBACKS.filter((s) => s < wanted)]) {
    const roots: number[] = [];
    for (let midi = low; midi + span <= high; midi++) {
      if (pitchClass(midi) === rootClass) roots.push(midi);
    }
    if (roots.length > 0) return { span, roots };
  }
  return null;
}

/**
 * How far a scale or arpeggio will actually reach, in semitones.
 *
 * Exported so the settings screen can say what the player is really going to
 * get rather than what was asked for.
 */
export function patternSpanFor(
  instrument: Instrument,
  clef: Clef,
  fifths: number,
  difficulty: Difficulty,
): number {
  const [low, high] = writtenRange(instrument, clef);
  const fitted = fitSpan(low, high, tonicPitchClass(fifths), difficulty.patterns.spanSemitones);
  return fitted?.span ?? 0;
}

/**
 * Fills the exercise with durations drawn from the difficulty's rhythm pool.
 *
 * Bars are filled exactly, with one exception: a note may be allowed to overrun
 * into the next bar, in which case it is written as a tied pair. That is the
 * only reason this runs across the whole exercise rather than a bar at a time.
 *
 * Scales and arpeggios may use a pool of their own: at the easier levels that is
 * plain crotchets end to end, so the exercise is about the fingering rather than
 * about reading a rhythm at the same time.
 */
function generateRhythm(
  rng: Rng,
  options: GenerateOptions,
  metre: Metre,
  pattern: boolean,
): Slot[] {
  const slots: Slot[] = [];
  const { difficulty } = options;
  // Crotchets in a bar, which is the numerator only in simple time.
  const barBeats = metre.barBeats;

  const pool = (pattern && difficulty.patterns.rhythms) || difficulty.rhythms;
  const restChance =
    pattern && difficulty.patterns.restChance !== undefined
      ? difficulty.patterns.restChance
      : difficulty.restChance;
  const tieChance = pattern ? 0 : difficulty.tieChance;
  const totalBeats = options.bars * barBeats;

  let beat = 0;
  while (beat < totalBeats - 1e-9) {
    const beatInBar = beat % barBeats;
    const remaining = barBeats - beatInBar;

    /*
     * Sometimes a note is allowed to overrun its bar.
     *
     * That is the one duration which cannot be written as a single note, and so
     * the one that needs a tie: the bar is filled, the remainder is written
     * again on the downbeat, and a curve joins the two. Rolled only where an
     * overrun is actually available, so `tieChance` reads as "how often a bar
     * end that could be tied over is" rather than as a rate diluted by every
     * position in the bar that could never have produced one.
     */
    const overruns =
      tieChance > 0 && beat + remaining < totalBeats - 1e-9
        ? pool.filter((r) => splitsOverBar(durationBeats(r.duration), remaining, barBeats))
        : [];

    if (overruns.length > 0 && rng.chance(tieChance)) {
      const beats = durationBeats(rng.weighted(overruns, (r) => r.weight).duration);
      slots.push({
        startBeat: beat,
        duration: durationFromBeats(remaining) as Duration,
        isRest: false,
        tiedFromPrevious: false,
      });
      slots.push({
        startBeat: beat + remaining,
        duration: durationFromBeats(beats - remaining) as Duration,
        isRest: false,
        tiedFromPrevious: true,
      });
      beat += beats;
      continue;
    }

    const affordable = pool.filter((r) => durationBeats(r.duration) <= remaining + 1e-9);
    // Nothing in the pool fits what is left of the bar, so there is no honest
    // way to fill it; move on to the next one rather than overflowing by
    // accident, which is a thing only a tie may do.
    if (affordable.length === 0) {
      beat += remaining;
      continue;
    }

    const duration = rng.weighted(affordable, (r) => r.weight).duration;
    // Rests are kept off the downbeat so bars stay readable.
    const isRest = beatInBar > 1e-9 && rng.chance(restChance);
    slots.push({ startBeat: beat, duration, isRest, tiedFromPrevious: false });
    beat += durationBeats(duration);
  }
  return slots;
}

/**
 * Fewest bars a key may hold before the next change.
 *
 * A key needs long enough to be established before it is left, or a change
 * reads as an accident rather than as a modulation. Four bars is the shortest
 * phrase most music admits, and it means a short exercise simply uses fewer of
 * the keys on offer rather than hurrying through all of them.
 */
const MIN_BARS_PER_KEY = 4;

/**
 * Where the key changes, and to what.
 *
 * One segment per key, in the order they were given, spread as evenly across
 * the exercise as the candidate positions allow. Candidates are the only beats
 * a change may legally land on: bar lines for free material, and for a pattern
 * the start of a cycle, which is why a cycle is padded out to its bar line in
 * the first place.
 *
 * An exercise too short to give every key its minimum simply uses fewer of
 * them. Dropping the tail rather than crowding the changes keeps what does
 * happen musical, which matters more than using everything that was ticked.
 */
function planKeyChanges(
  ordered: readonly number[],
  totalBeats: number,
  candidates: readonly number[],
): KeyChange[] {
  const opening: KeyChange = { fromBeat: 0, fifths: ordered[0] };
  if (ordered.length < 2 || candidates.length === 0) return [opening];

  const segments = Math.min(ordered.length, candidates.length + 1);
  const changes: KeyChange[] = [opening];

  for (let i = 1; i < segments; i++) {
    const target = (totalBeats * i) / segments;
    const free = candidates.filter((beat) => !changes.some((c) => c.fromBeat === beat));
    if (free.length === 0) break;
    const at = free.reduce((best, beat) =>
      Math.abs(beat - target) < Math.abs(best - target) ? beat : best,
    );
    changes.push({ fromBeat: at, fifths: ordered[i] });
  }

  return changes.sort((a, b) => a.fromBeat - b.fromBeat);
}

/**
 * Pitches for a pattern: each note from the contour of the key it falls in.
 *
 * The index restarts when the key does, so a block of cycles in one key runs
 * round its own shape from the beginning. Where a key holds several cycles the
 * index simply wraps, which is also what puts the tonic under the extra
 * closing note `patternSlots` leaves at the very end — it lands exactly on a
 * multiple of the contour's length.
 */
function patternPitches(
  soundedSlots: readonly Slot[],
  keys: readonly KeyChange[],
  contourFor: ReadonlyMap<number, number[]>,
): number[] {
  const pitches: number[] = [];
  let current: number | null = null;
  let index = 0;

  for (const slot of soundedSlots) {
    const fifths = keyAt(keys, slot.startBeat);
    if (fifths !== current) {
      current = fifths;
      index = 0;
    }
    const contour = contourFor.get(fifths)!;
    pitches.push(contour[index % contour.length]);
    index++;
  }

  return pitches;
}

/**
 * The changes implied by a run of cycles, one entry wherever the key differs
 * from the cycle before it.
 *
 * Read back rather than planned, so there is one account of which key a cycle
 * is in — the same one its notes were laid out against.
 */
function keysFromCycles(
  cycleKeys: readonly number[],
  cycleStarts: readonly number[],
): KeyChange[] {
  const changes: KeyChange[] = [];
  cycleKeys.forEach((fifths, i) => {
    if (i === 0 || fifths !== cycleKeys[i - 1]) {
      changes.push({ fromBeat: cycleStarts[i], fifths });
    }
  });
  return changes;
}

/** Bar lines a change may land on, keeping every key its minimum stretch. */
function barLineCandidates(totalBeats: number, metre: Metre): number[] {
  const { barBeats } = metre;
  const totalBars = Math.round(totalBeats / barBeats);
  const beats: number[] = [];
  for (let bar = MIN_BARS_PER_KEY; bar <= totalBars - MIN_BARS_PER_KEY; bar += 1) {
    beats.push(bar * barBeats);
  }
  return beats;
}

/**
 * Slots for a pattern: whole cycles of it, each finishing on a bar line.
 *
 * Scales are measured in cycles rather than bars because a cycle is the thing
 * being practised, and the two do not divide into one another — a one-octave
 * scale up and back is fifteen notes, which is three and three quarter bars of
 * crotchets. Generating a fixed number of bars therefore stopped wherever the
 * bar count ran out, routinely part-way up the scale, which is the one place a
 * scale should never stop.
 *
 * So the cycle is generated whole and the remainder of its last bar is rested
 * out. Every cycle then begins on a downbeat, the exercise ends where the
 * pattern does, and a cycle boundary is a bar line — which is what lets the key
 * change between one cycle and the next without landing mid-bar.
 *
 * One note more than the cycles ask for, at the very end. A cycle deliberately
 * omits the tonic it would otherwise repeat at each join — playing it twice
 * over is not what going round again sounds like — but that leaves the last
 * one finishing on the second degree, hanging. So the closing tonic is added
 * back once, which is what the second-time bar of a scale in any method book
 * does.
 */
function patternSlots(
  rng: Rng,
  options: GenerateOptions,
  metre: Metre,
  /** Notes in each cycle. One entry per cycle, since a cycle in another key
      may be a different length. */
  notesPerCycle: readonly number[],
): { slots: Slot[]; totalBeats: number; cycleStarts: number[] } {
  const slots: Slot[] = [];
  const cycleStarts: number[] = [];
  const { barBeats } = metre;
  const pool = options.difficulty.patterns.rhythms ?? options.difficulty.rhythms;
  let beat = 0;

  const roomInBar = () => barBeats - (beat % barBeats);
  const fitting = (room: number) =>
    pool.filter((r) => durationBeats(r.duration) <= room + 1e-9);

  for (let cycle = 0; cycle < notesPerCycle.length; cycle++) {
    cycleStarts.push(beat);
    const last = cycle === notesPerCycle.length - 1;
    for (let i = 0; i < notesPerCycle[cycle] + (last ? 1 : 0); i++) {
      let affordable = fitting(roomInBar());
      if (affordable.length === 0) {
        // Nothing in the pool fits what is left of this bar. Rest it out and
        // start the note on the next downbeat rather than overrunning: a
        // pattern is never tied, so there is no honest way to spill.
        const room = roomInBar();
        slots.push(...restsFilling(beat, room, metre));
        beat += room;
        affordable = fitting(roomInBar());
      }

      const duration = rng.weighted(affordable, (r) => r.weight).duration;
      slots.push({ startBeat: beat, duration, isRest: false, tiedFromPrevious: false });
      beat += durationBeats(duration);
    }

    // Out to the bar line, so the next cycle starts where a cycle should.
    const leftover = roomInBar() % barBeats;
    if (leftover > 1e-9) {
      slots.push(...restsFilling(beat, leftover, metre));
      beat += leftover;
    }
  }

  return { slots, totalBeats: beat, cycleStarts };
}

/**
 * Whether a note of `beats` starting `remaining` from the bar line splits into
 * two notes that can each be written.
 *
 * Both halves have to be real note values — a tie is two notes, not a way of
 * writing an arbitrary length — and the tail must not run past the end of the
 * bar it lands in, since a note spanning two bar lines would need two ties and
 * a middle note that is nothing but bookkeeping.
 */
function splitsOverBar(beats: number, remaining: number, barBeats: number): boolean {
  const tail = beats - remaining;
  if (tail <= 1e-9 || tail > barBeats + 1e-9) return false;
  return durationFromBeats(remaining) !== null && durationFromBeats(tail) !== null;
}

/**
 * Which notes begin afresh — the first, and any that follows a rest.
 *
 * Indices count sounded notes only, ignoring both the rests between them and
 * the far ends of ties, which is how the pitch generators number what they are
 * producing. A tie continuation can never be a fresh start in any case: it is
 * the note before it, still sounding.
 */
function freshStarts(slots: Slot[]): Set<number> {
  const starts = new Set<number>();
  let afterSilence = true;
  let noteIndex = 0;

  for (const slot of slots) {
    if (slot.isRest) {
      afterSilence = true;
      continue;
    }
    if (slot.tiedFromPrevious) continue;
    if (afterSilence) starts.add(noteIndex);
    afterSilence = false;
    noteIndex++;
  }
  return starts;
}


function generatePitches(
  rng: Rng,
  options: GenerateOptions,
  candidates: Candidate[],
  count: number,
  freshStarts: ReadonlySet<number>,
  keyFor: (noteIndex: number) => number,
): number[] {
  // Scales and arpeggios never arrive here: their notes come from a contour
  // settled before the rhythm was built, since the rhythm is shaped around it.
  // One that would not fit the instrument is not a pattern at all and takes the
  // free-material path below, like anything else.
  switch (options.kind) {
    case 'phrases':
      return phrasePitches(rng, options, candidates, count, freshStarts, keyFor);
    default:
      return randomPitches(rng, options, candidates, count, freshStarts, keyFor);
  }
}

/**
 * A random walk constrained by the difficulty's maximum interval.
 *
 * Walking rather than picking freely keeps the line playable — a sequence of
 * unrelated leaps is a different and much less useful exercise than one that
 * moves the way music does.
 */
function randomPitches(
  rng: Rng,
  options: GenerateOptions,
  candidates: Candidate[],
  count: number,
  freshStarts: ReadonlySet<number>,
  keyFor: (noteIndex: number) => number,
): number[] {
  const pitches: number[] = [];
  let previous = nearestCandidate(candidates, middleOf(candidates)).midi;
  let previousMask = -1;

  for (let i = 0; i < count; i++) {
    const wantChromatic = rng.chance(options.difficulty.accidentalChance);
    const next = chooseNext(
      rng,
      options,
      candidates,
      previous,
      wantChromatic,
      i === 0,
      { previousMask, freshStart: freshStarts.has(i) },
      keyFor(i),
    );
    pitches.push(next.midi);
    previous = next.midi;
    previousMask = next.mask;
  }
  return pitches;
}

/**
 * Sight-reading material: mostly stepwise, with a phrase-level sense of
 * direction that turns over every few notes and the occasional leap.
 */
function phrasePitches(
  rng: Rng,
  options: GenerateOptions,
  candidates: Candidate[],
  count: number,
  freshStarts: ReadonlySet<number>,
  keyFor: (noteIndex: number) => number,
): number[] {
  const pitches: number[] = [];
  const centre = middleOf(candidates);
  let previous = nearestCandidate(candidates, centre).midi;
  let previousMask = -1;
  let direction = rng.chance(0.5) ? 1 : -1;
  let remainingInPhrase = rng.int(3, 7);

  for (let i = 0; i < count; i++) {
    if (remainingInPhrase-- <= 0) {
      direction = -direction;
      remainingInPhrase = rng.int(3, 7);
    }

    const wantChromatic = rng.chance(options.difficulty.accidentalChance);
    const leap = rng.chance(0.15);
    const maxStep = leap ? options.difficulty.maxInterval : Math.min(2, options.difficulty.maxInterval);

    // Pull back toward the middle when the line drifts to an extreme.
    const drift = previous - centre;
    const span = options.difficulty.rangeSemitones / 2;
    if (Math.abs(drift) > span * 0.7 && rng.chance(0.6)) {
      direction = drift > 0 ? -1 : 1;
    }

    const rules = { previousMask, freshStart: freshStarts.has(i) };

    // Candidates lying in the phrase's current direction, within one step or
    // leap — except at a fresh start, where a line coming out of a rest is under
    // no obligation to continue by step from where it left off. Opening the pool
    // there also leaves the fingering preferences something to work with: a
    // single stepwise candidate cannot be steered away from open valves.
    const reachable = rules.freshStart
      ? candidates.filter(
          (c) => Math.abs(c.midi - previous) <= options.difficulty.maxInterval,
        )
      : candidates.filter((c) => {
          const delta = (c.midi - previous) * direction;
          return delta > 0 && delta <= maxStep;
        });
    const preferred = reachable.filter(
      (c) => diatonicIn(c.midi, keyFor(i)) === !wantChromatic,
    );

    const usable = preferred.length > 0 ? preferred : reachable;
    const next =
      usable.length > 0
        ? rng.weighted(applyFingeringRules(usable, rules), (c) => noteWeight(options, c.midi))
        : chooseNext(rng, options, candidates, previous, wantChromatic, false, rules, keyFor(i));

    pitches.push(next.midi);
    previous = next.midi;
    previousMask = next.mask;
  }
  return pitches;
}

/**
 * Scale and arpeggio shapes, as semitones above their own root, paired with the
 * scale degree that root sits on.
 *
 * Every one of these is strictly diatonic to the key. That is the point: a
 * scales drill in Eb should contain the notes of Eb and nothing else. Patterns
 * built on the tonic but borrowed from another mode — a parallel minor, or a
 * flat-seventh chord on the tonic — look like heavy chromaticism against the key
 * signature, which is not what anyone means by "scales and arpeggios".
 *
 * The dominant seventh is diatonic precisely because it is built on the fifth
 * degree, not the first: in Eb that is Bb D F Ab, all in key.
 */

interface Pattern {
  /** Semitones from the key's tonic to this pattern's root. */
  rootDegree: number;
  /** Semitones above that root. */
  intervals: number[];
}

const SCALE_PATTERNS: Pattern[] = [{ rootDegree: 0, intervals: MAJOR_SCALE }];

/**
 * The tonic triad, and only the tonic triad.
 *
 * Chords on other degrees — subdominant, dominant, dominant seventh, relative
 * minor — are all diatonic and all worth practising, but selecting "C major"
 * and being given F-A-C is not what anyone means by a C major arpeggio. They
 * belong behind an explicit choice, not behind a dice roll. Adding one is a
 * matter of listing it here and letting the player pick.
 */
const ARPEGGIO_PATTERNS: Pattern[] = [{ rootDegree: 0, intervals: [0, 4, 7] }];

/**
 * Scales and arpeggios: a genuine pattern, starting on its own root and running
 * up and back down through the available range.
 *
 * Starting on the root matters. Collecting every pitch of the scale that happens
 * to fall in range and running through them gives the right notes but the wrong
 * exercise — it begins wherever the instrument's compass happens to start, so it
 * never sounds or feels like the scale you meant to practise.
 */
function patternContour(
  rng: Rng,
  options: GenerateOptions,
  candidates: Candidate[],
  patterns: Pattern[],
): number[] | null {
  const pattern = rng.pick(patterns);
  const tonic = tonicPitchClass(options.fifths);
  const rootClass = pitchClass(tonic + pattern.rootDegree);

  const [instrumentLow, instrumentHigh] = writtenRange(options.instrument, options.clef);

  const fitted = fitSpan(
    instrumentLow,
    instrumentHigh,
    rootClass,
    options.difficulty.patterns.spanSemitones,
  );
  if (!fitted) return null;

  // Of the roots that fit, the one closest to the middle of the difficulty's own
  // range, so an easy exercise is not pushed to the bottom of the instrument
  // merely because that is where the first available root happens to be.
  const centre = middleOf(candidates);
  const root = fitted.roots.reduce((best, r) =>
    Math.abs(r - centre) < Math.abs(best - centre) ? r : best,
  );

  // Every degree of the pattern from the root up to the top of the span. Working
  // in semitones rather than whole octaves is what lets a pattern stop on the
  // fifth rather than always having to complete an octave.
  const degrees = new Set(pattern.intervals.map((interval) => interval % 12));
  const ascending: number[] = [];
  for (let offset = 0; offset <= fitted.span; offset++) {
    if (degrees.has(offset % 12)) ascending.push(root + offset);
  }

  if (ascending.length < 2) return null;

  // Up then back down, without sounding the turning notes twice.
  return [...ascending, ...ascending.slice(1, -1).reverse()];
}

function chooseNext(
  rng: Rng,
  options: GenerateOptions,
  candidates: Candidate[],
  previous: number,
  wantChromatic: boolean,
  first: boolean,
  fingering: { previousMask: number; freshStart: boolean },
  /** The key in force at this note, which decides what counts as chromatic. */
  fifths: number,
): Candidate {
  const withinReach = candidates.filter(
    (c) => first || Math.abs(c.midi - previous) <= options.difficulty.maxInterval,
  );
  const matching = withinReach.filter((c) => diatonicIn(c.midi, fifths) === !wantChromatic);
  const base = matching.length > 0 ? matching : withinReach.length > 0 ? withinReach : candidates;
  return rng.weighted(applyFingeringRules(base, fingering), (c) => noteWeight(options, c.midi));
}

/**
 * Two preferences about fingering, applied to whatever pool is left after the
 * musical choices have been made.
 *
 * **Not the same fingering twice running.** Two consecutive notes on one
 * fingering — written C and G on a cornet, both open — ask the player to do
 * nothing at all between them, which is the one thing a fingering drill should
 * never do. Scales and arpeggios are exempt because their notes are fixed.
 *
 * **Not open at a fresh start.** Beginning the exercise, or coming out of a
 * rest, on a note that needs no valves is indistinguishable from not having
 * started. Better to begin on something the hand has to do.
 */
function applyFingeringRules(
  pool: Candidate[],
  fingering: { previousMask: number; freshStart: boolean },
): Candidate[] {
  let narrowed = pool;
  if (fingering.previousMask >= 0) {
    narrowed = prefer(narrowed, (c) => c.mask !== fingering.previousMask);
  }
  if (fingering.freshStart) {
    narrowed = prefer(narrowed, (c) => c.mask !== 0);
  }
  return narrowed;
}

/** Weak-note drilling: notes the player misses are made more likely to appear. */
function noteWeight(options: GenerateOptions, midi: number): number {
  return options.noteWeights?.get(midi) ?? 1;
}

function middleOf(candidates: Candidate[]): number {
  return (candidates[0].midi + candidates[candidates.length - 1].midi) / 2;
}

function nearestCandidate(candidates: Candidate[], target: number): Candidate {
  return candidates.reduce((best, c) =>
    Math.abs(c.midi - target) < Math.abs(best.midi - target) ? c : best,
  );
}
