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
import { durationBeats, isBeamable, type Duration } from '../domain/rhythm';
import { pitchClass, type Letter } from '../domain/pitch';
import type { Difficulty } from './difficulty';
import { createRng, type Rng } from './rng';
import type { Exercise, ExerciseKind, NoteEvent, RestEvent } from './types';

export interface GenerateOptions {
  instrument: Instrument;
  clef: Clef;
  /** Written key signature on the circle of fifths. */
  fifths: number;
  difficulty: Difficulty;
  kind: ExerciseKind;
  bars: number;
  beatsPerBar: number;
  beatUnit: number;
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
}

export function generateExercise(options: GenerateOptions): Exercise {
  const rng = createRng(options.seed);
  const candidates = candidatePitches(options);
  if (candidates.length === 0) {
    throw new Error('No playable notes in range for this instrument and difficulty');
  }

  const slots = generateRhythm(rng, options, isPattern(options.kind));
  const noteSlots = slots.filter((s) => !s.isRest);
  const pitches = generatePitches(
    rng,
    options,
    candidates,
    noteSlots.length,
    freshStarts(slots),
  );

  const notes: NoteEvent[] = [];
  const rests: RestEvent[] = [];
  let pitchIndex = 0;

  for (const slot of slots) {
    if (slot.isRest) {
      rests.push({ startBeat: slot.startBeat, duration: slot.duration });
      continue;
    }
    const writtenMidi = pitches[pitchIndex++];
    const soundingMidi = soundingFromWritten(writtenMidi, options.instrument, options.clef);
    const primary = primaryFingering(soundingMidi, options.instrument);
    notes.push({
      writtenMidi,
      soundingMidi,
      startBeat: slot.startBeat,
      duration: slot.duration,
      acceptedMasks: [...fingeringMasks(soundingMidi, options.instrument)],
      primaryMask: primary?.mask ?? 0,
      beamGroup: -1,
      showAccidental: false,
    });
  }

  assignBeamGroups(notes, rests, options.beatsPerBar);
  assignAccidentals(notes, options.fifths, options.beatsPerBar);

  return {
    notes,
    rests,
    instrumentId: options.instrument.id,
    clef: options.clef,
    fifths: options.fifths,
    beatsPerBar: options.beatsPerBar,
    beatUnit: options.beatUnit,
    totalBeats: options.bars * options.beatsPerBar,
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
 * Fills each bar with durations drawn from the difficulty's rhythm pool.
 *
 * Scales and arpeggios may use a pool of their own: at the easier levels that is
 * plain crotchets end to end, so the exercise is about the fingering rather than
 * about reading a rhythm at the same time.
 */
function generateRhythm(rng: Rng, options: GenerateOptions, pattern: boolean): Slot[] {
  const slots: Slot[] = [];
  const { beatsPerBar, difficulty } = options;

  const pool = (pattern && difficulty.patterns.rhythms) || difficulty.rhythms;
  const restChance =
    pattern && difficulty.patterns.restChance !== undefined
      ? difficulty.patterns.restChance
      : difficulty.restChance;
  const smallest = pool.reduce((least, r) =>
    durationBeats(r.duration) < durationBeats(least.duration) ? r : least,
  ).duration;

  for (let bar = 0; bar < options.bars; bar++) {
    let beat = 0;
    while (beat < beatsPerBar - 1e-9) {
      const remaining = beatsPerBar - beat;
      const affordable = pool.filter((r) => durationBeats(r.duration) <= remaining + 1e-9);
      // If nothing in the pool fits the gap, close it with the largest that does.
      const duration =
        affordable.length > 0 ? rng.weighted(affordable, (r) => r.weight).duration : smallest;

      const beats = durationBeats(duration);
      if (beats > remaining + 1e-9) break;

      // Rests are kept off the downbeat so bars stay readable.
      const isRest = beat > 0 && rng.chance(restChance);
      slots.push({ startBeat: bar * beatsPerBar + beat, duration, isRest });
      beat += beats;
    }
  }
  return slots;
}

/**
 * Which notes begin afresh — the first, and any that follows a rest.
 *
 * Indices count notes only, ignoring the rests between them, which is how the
 * pitch generators number what they are producing.
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
  switch (options.kind) {
    // Scales and arpeggios are exempt from the fingering rules: their notes are
    // fixed by the pattern, and bending them to avoid a repeated fingering would
    // stop them being scales.
    case 'scales':
      return patternPitches(rng, options, candidates, count, SCALE_PATTERNS);
    case 'arpeggios':
      return patternPitches(rng, options, candidates, count, ARPEGGIO_PATTERNS);
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
function patternPitches(
  rng: Rng,
  options: GenerateOptions,
  candidates: Candidate[],
  count: number,
  patterns: Pattern[],
): number[] {
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
  if (!fitted) return randomPitches(rng, options, candidates, count, new Set());

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

  if (ascending.length < 2) return randomPitches(rng, options, candidates, count, new Set());

  // Up then back down, without sounding the turning notes twice.
  const contour = [...ascending, ...ascending.slice(1, -1).reverse()];

  const pitches: number[] = [];
  for (let i = 0; i < count; i++) pitches.push(contour[i % contour.length]);
  return pitches;
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
function assignBeamGroups(notes: NoteEvent[], rests: RestEvent[], beatsPerBar: number): void {
  const restBeats = new Set(rests.map((r) => Math.floor(r.startBeat)));
  let group = 0;
  let index = 0;

  while (index < notes.length) {
    const note = notes[index];
    if (!isBeamable(note.duration)) {
      index++;
      continue;
    }

    const beat = Math.floor(note.startBeat);
    const bar = Math.floor(note.startBeat / beatsPerBar);
    let end = index;
    while (
      end + 1 < notes.length &&
      isBeamable(notes[end + 1].duration) &&
      Math.floor(notes[end + 1].startBeat) === beat &&
      Math.floor(notes[end + 1].startBeat / beatsPerBar) === bar &&
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
 */
function assignAccidentals(notes: NoteEvent[], fifths: number, beatsPerBar: number): void {
  let currentBar = -1;
  let altered = new Map<string, number>();

  for (const note of notes) {
    const bar = Math.floor(note.startBeat / beatsPerBar);
    if (bar !== currentBar) {
      currentBar = bar;
      altered = new Map();
    }

    const spelled = spellInKey(note.writtenMidi, fifths);
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
