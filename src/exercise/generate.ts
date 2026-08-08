/**
 * Exercise generation.
 *
 * Rhythm and pitch are generated separately: the rhythm decides how many notes
 * there are and when they fall, then a pitch strategy fills the slots. That
 * split means a new kind of exercise only needs a new pitch strategy, and every
 * kind gets dotted rhythms, rests and beaming for free.
 */

import {
  isPlayable,
  acceptedMasks as fingeringMasks,
  primaryFingering,
} from '../domain/fingering';
import {
  soundingFromWritten,
  writtenRange,
  type Clef,
  type Instrument,
} from '../domain/instruments';
import { isDiatonic, needsAccidental, spellInKey, tonicPitchClass } from '../domain/keys';
import {
  durationBeats,
  durationFromBeats,
  isBeamable,
  NOTE_VALUES,
  type Duration,
} from '../domain/rhythm';
import { pitchClass, type Letter } from '../domain/pitch';
import type { Difficulty } from './difficulty';
import { barAt, type Metre } from '../domain/metre';
import { createRng, type Rng } from './rng';
import { isTieContinuation } from './ties';
import type { Exercise, ExerciseKind, NoteEvent, RestEvent } from './types';

export interface GenerateOptions {
  instrument: Instrument;
  clef: Clef;
  /** Written key signature on the circle of fifths. */
  fifths: number;
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
  diatonic: boolean;
  /** The fingering it is played with, so repeats can be avoided. */
  mask: number;
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

interface Slot {
  startBeat: number;
  duration: Duration;
  isRest: boolean;
  /** The far end of a tie: same pitch as the slot before, and never a rest. */
  tiedFromPrevious: boolean;
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

  /*
   * A pattern is generated the other way round from everything else.
   *
   * Free material takes a fixed number of bars and fills them with whatever
   * notes; a scale is a fixed shape, and how many bars it occupies falls out of
   * how long that shape is. So its contour is worked out first, and the rhythm
   * is built to hold a whole number of cycles of it. See `patternSlots`.
   *
   * A pattern that will not fit the instrument's compass is not a pattern, and
   * falls back to free material in the length free material is measured in.
   */
  const contour = isPattern(options.kind)
    ? patternContour(
        rng,
        options,
        candidates,
        options.kind === 'scales' ? SCALE_PATTERNS : ARPEGGIO_PATTERNS,
      )
    : null;

  const { slots, totalBeats } = contour
    ? patternSlots(rng, options, metre, contour.length)
    : {
        slots: generateRhythm(rng, options, metre, isPattern(options.kind)),
        totalBeats: options.bars * metre.barBeats,
      };

  // A tie continuation is not a choice of pitch — it is the note before it,
  // held — so the pitch generators are asked for one fewer note per tie.
  const soundedSlots = slots.filter((s) => !s.isRest && !s.tiedFromPrevious);
  const pitches = contour
    ? // Exactly whole cycles, and `patternSlots` emitted exactly that many
      // notes, so the two line up without the index ever drifting.
      soundedSlots.map((_, i) => contour[i % contour.length])
    : generatePitches(rng, options, candidates, soundedSlots.length, freshStarts(slots));

  const notes: NoteEvent[] = [];
  const rests: RestEvent[] = [];
  let pitchIndex = 0;

  for (const slot of slots) {
    if (slot.isRest) {
      rests.push({ startBeat: slot.startBeat, duration: slot.duration });
      continue;
    }
    if (slot.tiedFromPrevious) {
      const head = notes[notes.length - 1];
      head.tiedToNext = true;
      notes.push({
        ...head,
        startBeat: slot.startBeat,
        duration: slot.duration,
        acceptedMasks: [...head.acceptedMasks],
        beamGroup: -1,
        tiedToNext: false,
        showAccidental: false,
      });
      continue;
    }
    const writtenMidi = pitches[pitchIndex++];
    const soundingMidi = soundingFromWritten(writtenMidi, options.instrument, options.clef);
    const primary = primaryFingering(soundingMidi, options.instrument);
    notes.push({
      writtenMidi,
      soundingMidi,
      pitch: spellInKey(writtenMidi, options.fifths),
      startBeat: slot.startBeat,
      duration: slot.duration,
      acceptedMasks: [...fingeringMasks(soundingMidi, options.instrument)],
      primaryMask: primary?.mask ?? 0,
      beamGroup: -1,
      tiedToNext: false,
      showAccidental: false,
    });
  }

  assignBeamGroups(notes, rests, metre);
  assignAccidentals(notes, metre, options.fifths);

  return {
    notes,
    rests,
    instrumentId: options.instrument.id,
    clef: options.clef,
    // One key for the whole exercise, for now. The shape is a list because a
    // part changes key; nothing generates a second entry yet.
    keys: [{ fromBeat: 0, fifths: options.fifths }],
    metre,
    totalBeats,
    seed: options.seed,
    kind: options.kind,
  };
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
      diatonic: isDiatonic(midi, options.fifths),
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
  notesPerCycle: number,
): { slots: Slot[]; totalBeats: number } {
  const slots: Slot[] = [];
  const { barBeats } = metre;
  const pool = options.difficulty.patterns.rhythms ?? options.difficulty.rhythms;
  let beat = 0;

  const roomInBar = () => barBeats - (beat % barBeats);
  const fitting = (room: number) =>
    pool.filter((r) => durationBeats(r.duration) <= room + 1e-9);

  for (let cycle = 0; cycle < options.cycles; cycle++) {
    const last = cycle === options.cycles - 1;
    for (let i = 0; i < notesPerCycle + (last ? 1 : 0); i++) {
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

  return { slots, totalBeats: beat };
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
): number[] {
  // Scales and arpeggios never arrive here: their notes come from a contour
  // settled before the rhythm was built, since the rhythm is shaped around it.
  // One that would not fit the instrument is not a pattern at all and takes the
  // free-material path below, like anything else.
  switch (options.kind) {
    case 'phrases':
      return phrasePitches(rng, options, candidates, count, freshStarts);
    default:
      return randomPitches(rng, options, candidates, count, freshStarts);
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
): number[] {
  const pitches: number[] = [];
  let previous = nearestCandidate(candidates, middleOf(candidates)).midi;
  let previousMask = -1;

  for (let i = 0; i < count; i++) {
    const wantChromatic = rng.chance(options.difficulty.accidentalChance);
    const next = chooseNext(rng, options, candidates, previous, wantChromatic, i === 0, {
      previousMask,
      freshStart: freshStarts.has(i),
    });
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
    const preferred = reachable.filter((c) => c.diatonic === !wantChromatic);

    const usable = preferred.length > 0 ? preferred : reachable;
    const next =
      usable.length > 0
        ? rng.weighted(applyFingeringRules(usable, rules), (c) => noteWeight(options, c.midi))
        : chooseNext(rng, options, candidates, previous, wantChromatic, false, rules);

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
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

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
): Candidate {
  const withinReach = candidates.filter(
    (c) => first || Math.abs(c.midi - previous) <= options.difficulty.maxInterval,
  );
  const matching = withinReach.filter((c) => c.diatonic === !wantChromatic);
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

/**
 * Beams runs of quavers and shorter within a beat.
 *
 * Grouping by beat is what makes a bar of semiquavers readable at a glance;
 * anything crossing a beat, or interrupted by a rest or a longer note, starts a
 * new group.
 */
function assignBeamGroups(notes: NoteEvent[], rests: RestEvent[], metre: Metre): void {
  // Grouped by pulse rather than by crotchet, which is the same thing in simple
  // time and the difference between beaming in twos and in threes once it is
  // not: 6/8 beams three quavers to a dotted crotchet.
  const pulseOf = (beat: number) => Math.floor(beat / metre.pulseBeats + 1e-9);
  const restBeats = new Set(rests.map((r) => pulseOf(r.startBeat)));
  let group = 0;
  let index = 0;

  while (index < notes.length) {
    const note = notes[index];
    if (!isBeamable(note.duration)) {
      index++;
      continue;
    }

    const beat = pulseOf(note.startBeat);
    const bar = barAt(metre, note.startBeat);
    let end = index;
    while (
      end + 1 < notes.length &&
      isBeamable(notes[end + 1].duration) &&
      pulseOf(notes[end + 1].startBeat) === beat &&
      barAt(metre, notes[end + 1].startBeat) === bar &&
      !restBeats.has(beat)
    ) {
      end++;
    }

    if (end > index) {
      for (let i = index; i <= end; i++) notes[i].beamGroup = group;
      group++;
    }
    index = end + 1;
  }
}

/**
 * Decides which notes need an accidental drawn.
 *
 * An accidental holds for the rest of the bar at that letter and octave, so a
 * repeated F# is marked once. Conversely a note that reverts to the key
 * signature after an accidental needs a natural to cancel it.
 *
 * A tie continuation never takes one. It is not a new note, so there is nothing
 * to alter; the accidental on the head of the tie carries across the bar line
 * with the sound. Nor does it establish anything in the bar it lands in, which
 * means a later note of that pitch in that bar gets an accidental of its own —
 * the cautionary an engraver would write there anyway.
 */
function assignAccidentals(notes: NoteEvent[], metre: Metre, fifths: number): void {
  let currentBar = -1;
  let altered = new Map<string, number>();

  for (const [index, note] of notes.entries()) {
    const bar = barAt(metre, note.startBeat);
    if (bar !== currentBar) {
      currentBar = bar;
      altered = new Map();
    }

    if (isTieContinuation(notes, index)) {
      note.showAccidental = false;
      continue;
    }

    // Spelling is already settled; this only decides what has to be drawn.
    const spelled = note.pitch;
    const key = `${spelled.letter as Letter}${spelled.octave}`;
    const established = altered.get(key);

    if (established === spelled.alter) {
      note.showAccidental = false;
      continue;
    }

    const differsFromKey = needsAccidental(spelled, fifths);
    // Needed either because it departs from the signature, or because it must
    // cancel an accidental earlier in the bar.
    note.showAccidental = differsFromKey || established !== undefined;

    if (note.showAccidental) altered.set(key, spelled.alter);
  }
}
