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
  orderByCloseness,
  scalePitchClasses,
  spellInKey,
  spellWithLetter,
  tonicPitchClass,
  tourKey,
  type KeyChange,
} from '../domain/keys';
import {
  durationBeats,
  durationFromBeats,
  NOTE_VALUES,
  type Duration,
} from '../domain/rhythm';
import { LETTERS, pitchClass, type SpelledPitch } from '../domain/pitch';
import type { Difficulty } from './difficulty';
import { metreFor, type Metre } from '../domain/metre';
import { createRng, type Rng } from './rng';
import { assembleExercise, type Slot, type SlotPitch } from './assemble';
import { tonicWindow } from './theme';
import { stitchThemes } from './phrases';
import { planTempo } from './tempo-plan';
import type { Exercise, ExerciseKind } from './types';

/**
 * How far the paper runs past the chosen length, in bars.
 *
 * Two hundred bars of free material is around eight minutes of continuous
 * playing at ordinary tempi — long enough that reaching the cap is an
 * achievement rather than an interruption, small enough to generate and lay
 * out without noticing.
 */
export const HORIZON_BARS = 200;

/**
 * How much of each material a run is committed to, before it is asked whether
 * to carry on.
 *
 * A setting until v2.14.0, and dropped on the player's call: *people's attention
 * span will snap when presented with too many options*. It was never one setting
 * either — free material is measured in bars, a pattern in times through and
 * themes in whole tunes, so "length" was three controls wearing one label, only
 * one of which was ever visible at a time.
 *
 * What replaced it is not a shorter run but an open-ended one. Every run now
 * opens on the figure below, and a player who wants more plays on into the grey
 * and is given it — which was already how the offer worked, so removing the
 * control removed a decision rather than a capability. A player who wants less
 * presses Stop, which has always scored what was actually played.
 *
 * The figures are the player's, chosen as what one sitting at each of these is
 * worth: sixteen bars of reading, four times through a scale, eight through an
 * arpeggio — shorter, so more of them — and four whole tunes.
 */
export const DEFAULT_LENGTHS: Readonly<
  Record<Exclude<ExerciseKind, 'imported'>, { bars: number; cycles: number; themeCount: number }>
> = {
  phrases: { bars: 16, cycles: 4, themeCount: 4 },
  drills: { bars: 16, cycles: 4, themeCount: 4 },
  themes: { bars: 16, cycles: 4, themeCount: 4 },
};

/**
 * The length figures for a kind, including the ones it does not measure itself
 * in — a pattern that will not fit the instrument falls back to free material,
 * and has to have a bar count waiting for it when it does.
 *
 * A drill's cycle count is its own rather than the kind's, because a cycle of
 * a chord is half the notes of a cycle of a scale — the judgement about how
 * long one sitting is worth lives on each entry of `DRILLS`.
 */
export function defaultLengthFor(
  kind: ExerciseKind,
  drillId?: DrillId,
): {
  bars: number;
  cycles: number;
  themeCount: number;
} {
  const base = kind === 'imported' ? DEFAULT_LENGTHS.phrases : DEFAULT_LENGTHS[kind];
  return kind === 'drills' ? { ...base, cycles: drillById(drillId).cycles } : base;
}

/**
 * How far past a block boundary the music keeps open notes out of the way.
 *
 * Carrying on playing is how a player takes the offer of more music without
 * lifting a hand off the instrument — and with buttons, an open note is
 * indistinguishable from an abandoned one, so a boundary that opened with
 * open notes would leave them pressing a button after all. A preference
 * rather than a rule: a pattern's notes are fixed by its contour and a
 * theme's by whoever wrote it, so this can only ask where the material is
 * free to answer.
 *
 * Matches `GRACE_BEATS` in `session.ts`, which is how long the offer stays
 * open; the two are the same stretch of music seen from either end.
 */
const VALVED_BEATS = 4;

/**
 * Which end of the instrument a pattern is practised in.
 *
 * Only ever a preference between the starting notes that actually fit: a
 * two-octave scale takes most of a brass compass and usually has exactly one
 * place it can go, so asking for it high changes nothing and says nothing
 * untrue. Where there is a choice — a fifth, an octave — this is the whole
 * difference between drilling the register you are weak in and drilling the
 * one that happens to sit nearest the middle.
 */
export type PatternRegister = 'low' | 'middle' | 'high';

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
  /** Length of free material. Patterns and themes have units of their own. */
  bars: number;
  /**
   * Whole themes played end to end, for the Themes kind.
   *
   * A count rather than a length, for the same reason a pattern is measured in
   * cycles: a theme is a written shape and how many bars it occupies is its
   * own business. Asking for twelve bars of themes asks for one and a half of
   * something meant to be played whole.
   */
  themeCount: number;
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
   * Crotchets per minute the session will run at.
   *
   * The generator has no use for a speed — nothing about the notes depends on
   * it — except when `variableTempo` asks it to write tempo marks, which are
   * stored absolute so the page says what the player will actually hear.
   */
  tempo?: number;
  /** Whether the tempo moves at the material's boundaries; see `tempo-plan.ts`. */
  variableTempo?: boolean;
  /**
   * Where a scale or arpeggio should sit in the instrument, when there is a
   * choice. Defaults to the middle. See `PatternRegister`.
   */
  register?: PatternRegister;
  /**
   * Which drill the Drills kind plays — the player's pick from `DRILLS`, never
   * a dice roll. Absent means the major scale, which keeps every caller that
   * predates the picker meaning what it always meant. Ignored by other kinds.
   */
  drillId?: DrillId;
  /**
   * Written notes the free material is drawn from, lowest and highest.
   *
   * Absent lets the difficulty choose a band in the middle of the compass,
   * which is what it always did. Present, it is taken literally — see
   * `candidatePitches`.
   *
   * Free material only. A scale is placed by its tonic and its span, and asks
   * `register` where it should sit; a theme is written in degrees and finds its
   * own octave. Both would have to mean something different by a range, so
   * neither is asked.
   */
  range?: { low: number; high: number };
  /**
   * Bars to generate past the chosen length, as a cap on the whole.
   *
   * The horizon: the music carries on in grey past the length the player
   * asked for, and playing into it turns it white. Only the app passes this —
   * tools, figures and tests ask for exact lengths, which is what keeps every
   * committed snapshot byte-identical. Each material fills to the cap in its
   * own unit: bars of free material, whole cycles of a pattern, whole themes.
   */
  horizonBars?: number;
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
  /*
   * The division a rest may not straddle: the pulse in compound time, the
   * middle of the bar in simple.
   *
   * Half of a bar of 6/8 is a beat and a half, which is not a whole number of
   * crotchets — so the old test for one gave up and left compound time with
   * no division to respect at all, and a two-beat rest laid straight across
   * the dotted-crotchet beat. In compound time the pulse is the answer, and
   * it always divides the bar exactly.
   */
  const division = metre.isCompound ? metre.pulseBeats : barBeats / 2;
  const respected = metre.isCompound || Number.isInteger(division);

  const slots: Slot[] = [];
  let at = from;
  let left = beats;

  while (left > 1e-9) {
    // How much may be spent before the next division worth respecting.
    const toBoundary = respected ? division - (at % division) : Infinity;
    const room = Math.min(left, toBoundary > 1e-9 ? toBoundary : division);
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
  /*
   * Scales and arpeggios are practised in four-four, whatever else is set.
   *
   * A scale is not a piece of music with a metre; it is a shape played
   * against a click, and every method book prints it in four with the
   * barlines falling where they fall. Reading one in three or in six adds a
   * metre the exercise does not have and takes attention from the fingering,
   * which is the whole point of it — and it comes out even besides, two
   * cycles of an octave being seven bars of four-four exactly.
   *
   * Forced here rather than on the settings screen alone, so a stored
   * setting or a change of material cannot leave a pattern in a metre it
   * never wanted. The player's chosen signature is untouched and comes back
   * the moment they choose material that has one.
   */
  const metre = isPattern(options.kind) ? metreFor(4, 4) : options.metre;

  /*
   * Themes are their own kind rather than a better sight-reading.
   *
   * They were wired into sight-reading first, and the join never sat right: a
   * theme is a fixed length, so asking for twelve bars of them means one and a
   * half of something written to be played whole. Kept apart, each mode is
   * measured in the unit it actually has — bars of generated material, or
   * whole themes — and neither has to apologise for the other. Sight-reading
   * keeps the random walk it always had.
   *
   * A fall back to generated material stays, for a difficulty or metre the
   * corpus has nothing for. It is the same shape as a pattern that will not fit
   * an instrument, and while the corpus is small it is the ordinary case.
   */
  if (options.kind === 'themes') {
    const stitched = stitchThemes({
      instrument: options.instrument,
      clef: options.clef,
      fifths: options.fifths,
      difficulty: options.difficulty.id,
      keys: orderByCloseness(options.fifths, options.keySet ?? [options.fifths]),
      metre,
      count: options.themeCount,
      horizonBeats: options.horizonBars ? options.horizonBars * metre.barBeats : undefined,
      rng,
    });
    if (stitched) {
      /*
       * The joins are the boundaries the tempo plan is allowed to use, and
       * the plan draws from the same rng *after* stitching has finished with
       * it — so turning variable tempo on or off cannot change which themes
       * were chosen, only what is written over the joins.
       */
      const tempo =
        options.variableTempo && options.tempo
          ? planTempo({
              starts: stitched.starts,
              totalBeats: stitched.totalBeats,
              metre,
              bpm: options.tempo,
              rng,
            })
          : [];
      return assembleExercise(stitched.slots, stitched.pitches, {
        instrument: options.instrument,
        clef: options.clef,
        keys: stitched.keys,
        metres: [{ fromBeat: 0, metre }],
        totalBeats: stitched.totalBeats,
        chosenBeats: stitched.chosenBeats,
        seed: options.seed,
        kind: options.kind,
        tempo,
      });
    }
  }

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
  const drill = drillById(options.drillId);
  const contourFor = new Map<number, SpelledPitch[]>();
  if (isPattern(options.kind)) {
    for (const fifths of ordered) {
      const shape = patternContour({ ...options, fifths }, candidates, drill);
      if (shape) contourFor.set(fifths, shape);
    }
  }

  // Every key has to have produced a shape, or the blocks below would fall
  // back mid-exercise and the notes would stop being the pattern.
  const patterned = isPattern(options.kind) && contourFor.size === ordered.length;

  // Which key a cycle is played in, touring the set for as long as the
  // player keeps going; see `tourKey`.
  const dealKey = (cycle: number) => tourKey(ordered, cycle, options.cycles);

  /*
   * The horizon, in each material's own unit: bars of free material — a
   * pattern that failed to fit having fallen back to exactly that — or whole
   * cycles of a pattern. The chosen length stays what the player asked for;
   * the cap is how far the paper runs.
   */
  const freeHorizonBars =
    !patterned && options.horizonBars && options.horizonBars > options.bars
      ? options.horizonBars
      : undefined;

  const built = patterned
    ? patternSlots(
        rng,
        options,
        metre,
        (cycle) => contourFor.get(dealKey(cycle))!.length,
        options.cycles,
        (cycle) => dealKey(cycle + 1) !== dealKey(cycle),
        options.horizonBars ? options.horizonBars * metre.barBeats : undefined,
      )
    : {
        slots: generateRhythm(
          rng,
          freeHorizonBars ? { ...options, bars: freeHorizonBars } : options,
          metre,
          isPattern(options.kind),
        ),
        totalBeats: (freeHorizonBars ?? options.bars) * metre.barBeats,
        cycleStarts: [] as number[],
        cycles: 0,
        chosenBeats: options.bars * metre.barBeats,
      };
  const { slots, totalBeats, chosenBeats } = built;

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
    ? keysFromCycles(
        Array.from({ length: built.cycles }, (_, i) => dealKey(i)),
        built.cycleStarts,
      )
    : planKeyChanges(ordered, chosenBeats, totalBeats, metre);

  // A tie continuation is not a choice of pitch — it is the note before it,
  // held — so the pitch generators are asked for one fewer note per tie.
  const soundedSlots = slots.filter((s) => !s.isRest && !s.tiedFromPrevious);
  const keyForNote = (index: number) => keyAt(keys, soundedSlots[index]?.startBeat ?? 0);

  const pitches: SlotPitch[] = patterned
    ? patternPitches(soundedSlots, keys, contourFor)
    : generatePitches(
        rng,
        options,
        candidates,
        soundedSlots.length,
        freshStarts(slots),
        keyForNote,
        /*
         * The notes just past each block boundary, which is where a player
         * carrying on into the grey needs a valve to put down; see
         * `VALVED_BEATS`. Empty without a horizon, since then there is no
         * boundary to play through.
         */
        new Set(
          chosenBeats >= totalBeats
            ? []
            : soundedSlots
                .map((slot, index) => ({ slot, index }))
                .filter(({ slot }) => {
                  const past = slot.startBeat % chosenBeats;
                  return slot.startBeat >= chosenBeats - 1e-9 && past < VALVED_BEATS - 1e-9;
                })
                .map(({ index }) => index),
        ),
      );

  /*
   * Every material kind has the one boundary everything has — its end — and
   * what a band does at an end is broaden into it. Drawn from the rng after
   * every note is settled, so the switch changes what is written over the
   * music and never the music itself.
   *
   * With a horizon, the chosen end is a boundary too — the double bar the
   * player may or may not play through — so it takes the same treatment a
   * theme join does: perhaps a rit into it, a new tempo beyond it. The
   * closing rit moves to the cap, where the paper genuinely ends.
   */
  const tempo =
    options.variableTempo && options.tempo
      ? planTempo({
          starts: chosenBeats < totalBeats ? [0, chosenBeats] : [0],
          totalBeats,
          metre,
          bpm: options.tempo,
          rng,
        })
      : [];

  return assembleExercise(slots, pitches, {
    instrument: options.instrument,
    clef: options.clef,
    keys,
    metres: [{ fromBeat: 0, metre }],
    totalBeats,
    chosenBeats,
    seed: options.seed,
    kind: options.kind,
    tempo,
  });
}

/**
 * Every note the instrument can actually play, within the range in force.
 *
 * **A range the player asked for is taken literally.** All of it, none of it
 * favoured: someone who says they want the bottom fifth of the horn has said
 * something specific, and quietly pulling the notes back towards the middle
 * would be the app disagreeing with them about the one thing they came to
 * practise. Difficulty still governs everything else it governs — how far a
 * leap may go, how often an accidental turns up, the rhythms and the rests —
 * but it does not narrow this.
 *
 * **Where no range is asked for, the middle is favoured**, which is what an
 * exercise wants when nobody has said otherwise: a band as wide as the
 * difficulty allows, centred on the middle of the compass rather than on an
 * absolute pitch, so "one octave" means a comfortable octave on a tuba as well
 * as on a cornet.
 *
 * Ruled by the player on 2026-08-13.
 */
function candidatePitches(options: GenerateOptions): Candidate[] {
  const [lowest, highest] = writtenRange(options.instrument, options.clef);

  let low: number;
  let high: number;
  if (options.range) {
    low = Math.max(lowest, Math.min(options.range.low, options.range.high));
    high = Math.min(highest, Math.max(options.range.low, options.range.high));
  } else {
    const centre = Math.round((lowest + highest) / 2);
    const half = Math.floor(options.difficulty.rangeSemitones / 2);
    low = Math.max(lowest, centre - half);
    high = Math.min(highest, centre + half);
  }

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

/** The drills — scales and arpeggios — which work differently from free material. */
export function isPattern(kind: ExerciseKind): boolean {
  return kind === 'drills';
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
  drill?: Drill,
): number {
  const [low, high] = writtenRange(instrument, clef);
  // From the drill's own root, not the tonic: a dominant drill in Eb starts on
  // Bb, and whether two octaves fit depends on where *that* sits in the compass.
  const rootClass = pitchClass(tonicPitchClass(fifths) + (drill?.rootDegree ?? 0));
  const fitted = fitSpan(low, high, rootClass, difficulty.patterns.spanSemitones);
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
/**
 * The values that fit compound time: those that divide the pulse exactly, or
 * failing that the pulse itself. See the note in `patternSlots`.
 */
function dividingThePulse(
  pool: ReadonlyArray<{ duration: Duration; weight: number }>,
  metre: Metre,
): ReadonlyArray<{ duration: Duration; weight: number }> {
  const divides = pool.filter((r) => {
    const times = metre.pulseBeats / durationBeats(r.duration);
    return Math.abs(times - Math.round(times)) < 1e-9;
  });
  if (divides.length > 0) return divides;
  const beat = durationFromBeats(metre.pulseBeats);
  return beat ? [{ duration: beat, weight: 1 }] : pool;
}

/**
 * The ways one pulse of compound time can be filled, drawn from what the
 * difficulty allows.
 *
 * Compound time is not simple time with a different bar length. Its beat is
 * the dotted crotchet and everything is felt in threes against it, so a bar
 * of 6/8 filled with whatever happens to fit — three crotchets, say — is a
 * bar of 3/4 wearing the wrong signature. Notes are therefore chosen a whole
 * pulse at a time, from figures that fill one exactly: the beat as a single
 * note, and every ordering of shorter values that adds up to it. Long-short
 * and short-long are separate figures on purpose, since they are separate
 * rhythms.
 *
 * **The beat itself is always available**, whatever the pool holds. A
 * beginner's pool is minims and crotchets, neither of which can fill a
 * dotted-crotchet pulse in any combination — and a beginner meeting 6/8
 * should be playing the beat, which is exactly what that leaves them with.
 */
function compoundFigures(
  pool: ReadonlyArray<{ duration: Duration; weight: number }>,
  pulseBeats: number,
): Array<{ durations: Duration[]; weight: number }> {
  const usable = pool.filter((r) => durationBeats(r.duration) <= pulseBeats + 1e-9);
  const figures: Array<{ durations: Duration[]; weight: number }> = [];

  // The pulse as one note. Weighted middlingly — common but not the only
  // thing anyone plays — and the sole option where nothing else fits.
  const whole = durationFromBeats(pulseBeats);
  if (whole) {
    const mean = pool.reduce((sum, r) => sum + r.weight, 0) / Math.max(1, pool.length);
    figures.push({ durations: [whole], weight: mean });
  }

  const build = (left: number, taken: Duration[], weights: number[]): void => {
    if (Math.abs(left) < 1e-9) {
      if (taken.length > 1) {
        // The geometric mean, so a figure of six semiquavers is weighed
        // against one of two notes rather than being buried by the product.
        const weight = Math.exp(
          weights.reduce((sum, w) => sum + Math.log(w), 0) / weights.length,
        );
        figures.push({ durations: [...taken], weight });
      }
      return;
    }
    // Six is a pulse of semiquavers, which is as busy as compound time gets
    // in any of the pools here.
    if (taken.length >= 6) return;
    for (const entry of usable) {
      const beats = durationBeats(entry.duration);
      if (beats > left + 1e-9) continue;
      taken.push(entry.duration);
      weights.push(entry.weight);
      build(left - beats, taken, weights);
      taken.pop();
      weights.pop();
    }
  };
  build(pulseBeats, [], []);

  return figures;
}

/**
 * Slots for a run of bars in compound time, filled a pulse at a time.
 *
 * Ties keep working and keep their meaning: the figure that crosses a bar
 * line here is the beat held over it, written as a dotted crotchet on each
 * side of the line and joined — which is what a part actually prints, and
 * the only overrun compound time has any use for.
 */
function compoundRhythm(
  rng: Rng,
  options: GenerateOptions,
  metre: Metre,
  pattern: boolean,
): Slot[] {
  const { difficulty } = options;
  const pool = (pattern && difficulty.patterns.rhythms) || difficulty.rhythms;
  const restChance =
    pattern && difficulty.patterns.restChance !== undefined
      ? difficulty.patterns.restChance
      : difficulty.restChance;
  const tieChance = pattern ? 0 : difficulty.tieChance;

  const { pulseBeats, barBeats } = metre;
  const figures = compoundFigures(pool, pulseBeats);
  const held = durationFromBeats(pulseBeats);
  const totalBeats = options.bars * barBeats;
  const slots: Slot[] = [];

  // Nothing can fill a pulse, which no shipped difficulty manages; a bar of
  // rests beats a loop that never advances.
  if (figures.length === 0) return restsFilling(0, totalBeats, metre);

  let beat = 0;
  while (beat < totalBeats - 1e-9) {
    const lastPulseOfBar = Math.abs((beat % barBeats) - (barBeats - pulseBeats)) < 1e-9;
    const roomBeyond = beat + pulseBeats * 2 <= totalBeats + 1e-9;

    if (held && lastPulseOfBar && roomBeyond && tieChance > 0 && rng.chance(tieChance)) {
      slots.push({ startBeat: beat, duration: held, isRest: false, tiedFromPrevious: false });
      slots.push({
        startBeat: beat + pulseBeats,
        duration: held,
        isRest: false,
        tiedFromPrevious: true,
      });
      beat += pulseBeats * 2;
      continue;
    }

    const figure = rng.weighted(figures, (f) => f.weight);
    for (const duration of figure.durations) {
      // Rests stay off the downbeat, and off the beat itself: a rest where
      // the pulse falls is the one thing that makes compound time unreadable.
      const onPulse = Math.abs(beat % pulseBeats) < 1e-9;
      slots.push({
        startBeat: beat,
        duration,
        isRest: !onPulse && rng.chance(restChance),
        tiedFromPrevious: false,
      });
      beat += durationBeats(duration);
    }
  }

  return slots;
}

function generateRhythm(
  rng: Rng,
  options: GenerateOptions,
  metre: Metre,
  pattern: boolean,
): Slot[] {
  // Compound time is felt in threes against a dotted beat and is filled a
  // whole pulse at a time; see `compoundRhythm`.
  if (metre.isCompound) return compoundRhythm(rng, options, metre, pattern);

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
  contourFor: ReadonlyMap<number, SpelledPitch[]>,
): SpelledPitch[] {
  const pitches: SpelledPitch[] = [];
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

/**
 * Where the key changes, and to what.
 *
 * Each key holds for an equal share of **the length the player asked for**,
 * never less than `MIN_BARS_PER_KEY`, and the tour then carries on round the
 * set for as far as the paper runs. Sharing out the paper instead is what
 * this did when the paper was the exercise, and the horizon quietly broke
 * it: two keys across two hundred generated bars put the change at bar a
 * hundred, so a player who asked for sixteen bars in two keys never saw a
 * second one — not in the white, and not in any grey they were likely to
 * reach either.
 *
 * A set too large for the chosen length still simply uses fewer of its keys
 * rather than hurrying through them; the rest arrive if the player carries
 * on, which is the same bargain `tourKey` makes for cycles and themes.
 */
function planKeyChanges(
  ordered: readonly number[],
  chosenBeats: number,
  totalBeats: number,
  metre: Metre,
): KeyChange[] {
  const opening: KeyChange = { fromBeat: 0, fifths: ordered[0] };
  if (ordered.length < 2) return [opening];

  const { barBeats } = metre;
  const chosenBars = Math.max(1, Math.round(chosenBeats / barBeats));
  const totalBars = Math.max(1, Math.round(totalBeats / barBeats));
  const barsPerKey = Math.max(MIN_BARS_PER_KEY, Math.floor(chosenBars / ordered.length));

  const changes: KeyChange[] = [opening];
  for (let bar = barsPerKey, i = 1; bar < totalBars; bar += barsPerKey, i++) {
    changes.push({ fromBeat: bar * barBeats, fifths: ordered[i % ordered.length] });
  }
  return changes;
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
  /** Notes in a given cycle, since a cycle in another key may be a different
      length — asked per cycle because with a horizon the count of cycles is
      only known once the rhythms have been drawn. */
  notesFor: (cycle: number) => number,
  /** Cycles the player asked for; where the white ends. */
  chosenCycles: number,
  /** Whether the cycle after this one is in a different key. */
  changesKeyAfter: (cycle: number) => boolean,
  /** Fill whole cycles at least this far, when the material has a horizon. */
  minBeats?: number,
): {
  slots: Slot[];
  totalBeats: number;
  cycleStarts: number[];
  cycles: number;
  chosenBeats: number;
} {
  const slots: Slot[] = [];
  const cycleStarts: number[] = [];
  const { barBeats } = metre;
  const declared = options.difficulty.patterns.rhythms ?? options.difficulty.rhythms;

  /*
   * In compound time a pattern may only use values that divide the pulse.
   *
   * A scale in crotchets is fine in 4/4 and nonsense in 6/8, where the second
   * one straddles the dotted-crotchet beat — the same fault the free material
   * had, arriving by a different door, because a pattern lays its notes end to
   * end without ever asking where the beat is. Quavers three to a beat are how
   * a method book writes a scale in six, and where a difficulty's pool holds
   * nothing that divides the pulse, the beat itself always does.
   */
  const pool = metre.isCompound ? dividingThePulse(declared, metre) : declared;
  let beat = 0;
  let chosenBeats: number | undefined;

  const roomInBar = () => barBeats - (beat % barBeats);
  /*
   * How much a note may take from here.
   *
   * The bar, and in compound time the pulse as well — values that divide the
   * beat are not enough on their own, because a run of them lands wherever it
   * lands: a quaver beginning a semiquaver late crosses the beat as surely as
   * a crotchet does. The pulse is a ceiling, not just a vocabulary.
   */
  const roomNow = () =>
    metre.isCompound
      ? Math.min(roomInBar(), metre.pulseBeats - (beat % metre.pulseBeats))
      : roomInBar();
  const fitting = (room: number) =>
    pool.filter((r) => durationBeats(r.duration) <= room + 1e-9);

  const emitNote = () => {
    let affordable = fitting(roomNow());
    if (affordable.length === 0) {
      // Nothing in the pool fits what is left. Rest it out and start the note
      // on the next boundary rather than overrunning: a pattern is never
      // tied, so there is no honest way to spill.
      const room = roomNow();
      slots.push(...restsFilling(beat, room, metre));
      beat += room;
      affordable = fitting(roomNow());
    }

    const duration = rng.weighted(affordable, (r) => r.weight).duration;
    slots.push({ startBeat: beat, duration, isRest: false, tiedFromPrevious: false });
    beat += durationBeats(duration);
  };

  for (let cycle = 0; ; cycle++) {
    cycleStarts.push(beat);
    for (let i = 0; i < notesFor(cycle); i++) emitNote();

    /*
     * Whether another cycle follows: the chosen count first, then whole
     * cycles until the cap is met. Judged against where this cycle's bar
     * line will fall, so a cycle is never started only to cross the cap by
     * a note — the cap is a floor for whole units, not a ceiling.
     */
    const padded = beat + (roomInBar() % barBeats);
    const more =
      cycle + 1 < chosenCycles || (minBeats !== undefined && padded < minBeats - 1e-9);

    if (!more) {
      /*
       * The closing tonic, held to the bar line.
       *
       * A cycle omits the tonic it would repeat at each join, which leaves
       * the last one hanging on the second degree — so it is added back
       * once, exactly as the second-time bar of a scale in any method book
       * does. Held rather than played short and rested after: a scale that
       * ends on a long tonic is how every method book prints one, and it is
       * what leaves the exercise with no rest in it anywhere.
       */
      const room = roomInBar() % barBeats;
      const held = durationFromBeats(room > 1e-9 ? room : barBeats);
      if (held) {
        slots.push({ startBeat: beat, duration: held, isRest: false, tiedFromPrevious: false });
        beat += durationBeats(held);
      } else {
        emitNote();
        const leftover = roomInBar() % barBeats;
        if (leftover > 1e-9) {
          slots.push(...restsFilling(beat, leftover, metre));
          beat += leftover;
        }
      }
    } else if (changesKeyAfter(cycle)) {
      /*
       * Out to the bar line, but only where the next cycle is in a new key.
       *
       * That padding is what makes a cycle boundary a bar line, and a key
       * change may land nowhere else. Where the key does not move there is
       * nothing to protect and a rest in the middle of a scale is simply a
       * gap in it: two cycles of an octave are twenty-eight crotchets, which
       * is seven bars of four-four exactly, and running them together is
       * both what a player does against a metronome and what makes the
       * arithmetic come out.
       */
      const leftover = roomInBar() % barBeats;
      if (leftover > 1e-9) {
        slots.push(...restsFilling(beat, leftover, metre));
        beat += leftover;
      }
    }

    if (!more) {
      return {
        slots,
        totalBeats: beat,
        cycleStarts,
        cycles: cycle + 1,
        chosenBeats: chosenBeats ?? beat,
      };
    }
    // The white ends where the chosen cycles do, on the bar line just laid.
    if (cycle + 1 === chosenCycles) chosenBeats = beat;
  }
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
  /** Notes just past a block boundary, which should not be open. */
  needValve: ReadonlySet<number>,
): number[] {
  /*
   * One way of writing free material, since v2.14.0.
   *
   * There were two. The other was a walk that leapt freely inside the
   * difficulty's maximum interval, offered as its own mode — *Random notes* —
   * and dropped on the player's verdict that it was not different enough from
   * sight-reading to be worth a choice. With the mode gone the walk had one
   * caller left: a scale or arpeggio whose shape will not fit the instrument's
   * compass, which falls back to free material. Handing that player the mode
   * that no longer exists made no sense, so the fallback is phrases too.
   *
   * What the walk was actually for is worth keeping in mind if unpredictable
   * intervals are ever wanted again: it is a question of *how far a line may
   * leap and how often*, which belongs to difficulty rather than to a mode of
   * its own — and the player has asked for that to be reconsidered against what
   * is plausible on a given instrument.
   */
  return phrasePitches(rng, options, candidates, count, freshStarts, keyFor, needValve);
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
  needValve: ReadonlySet<number>,
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

    const rules = {
      previousMask,
      freshStart: freshStarts.has(i),
      needsValve: needValve.has(i),
    };

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

    /*
     * Where nothing of the wanted kind lies in the phrase's direction, a wanted
     * accidental is simply dropped — but a wanted *diatonic* note is not
     * traded for a chromatic one. That happened at the edge of the range band,
     * where the one reachable step down from D was D flat: Beginner, which
     * allows no accidentals at all, wrote one every few lines. The line turns
     * instead — `chooseNext` looks in every direction and prefers the key.
     */
    const usable = preferred.length > 0 ? preferred : wantChromatic ? reachable : [];
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
 * The drills: scale and arpeggio shapes, each note as semitones above the
 * drill's own root *and* the letter it is written on, paired with the scale
 * degree that root sits on. The player picks one on the settings screen;
 * nothing here is chosen by a dice roll, because selecting "C major" and being
 * handed F-A-C is not what anyone means by a C major arpeggio.
 *
 * Every one of these is diatonic to the key, or is one of the two minor scales
 * a book prints under the key's relative minor. That is the point: a drill in
 * Eb should contain the notes of Eb and nothing else. Patterns built on the
 * tonic but borrowed from another mode — a parallel minor, or a flat-seventh
 * chord on the tonic — look like heavy chromaticism against the key signature,
 * which is not what anyone means by "scales and arpeggios".
 *
 * The dominant seventh is diatonic precisely because it is built on the fifth
 * degree, not the first: in Eb that is Bb D F Ab, all in key. The minor
 * arpeggio and the minor scales likewise sit on the sixth degree — the
 * relative minor's tonic — and take the key's own signature, which is how a
 * book prints them: D minor is written with F major's one flat.
 *
 * **Which letter, not only which semitone.** The harmonic minor's raised
 * seventh in D minor is C sharp, and the key's flat would spell that sound as
 * D flat. A scale is one note per letter, so each note here carries its letter
 * step above the root and the spelling follows it — see `spellDrillNote`. For
 * every diatonic drill that comes out exactly as the signature would have
 * spelled it, so nothing changed for them.
 *
 * `cycles` is how many times through — up and back down — one sitting opens
 * on: a judgement, not a derivation, pinned by a test. A chord's cycle is
 * half the notes of a scale's, so the chords get twice as many.
 */

/** One note of a drill's shape, within an octave of the root. */
export interface DrillNote {
  /** Semitones above the root. */
  semitones: number;
  /** Letter steps above the root's letter, 0–6, which decides the spelling. */
  step: number;
}

export type DrillId =
  | 'major-scale'
  | 'harmonic-minor-scale'
  | 'melodic-minor-scale'
  | 'tonic-arpeggio'
  | 'subdominant-arpeggio'
  | 'dominant-arpeggio'
  | 'dominant-7th'
  | 'relative-minor-arpeggio';

export interface Drill {
  id: DrillId;
  /** What the picker calls it, inside a box already framed by the chosen key. */
  name: string;
  /** Semitones from the key's tonic to this drill's root. */
  rootDegree: number;
  /** The shape going up, one octave of it, from the root. */
  up: readonly DrillNote[];
  /**
   * The shape coming down, where it differs — the melodic minor, whose sixth
   * and seventh are raised on the way up and natural on the way back. Given
   * ascending like `up`, and reversed by the contour. Absent means the way
   * down is the way up, reversed.
   */
  down?: readonly DrillNote[];
  /**
   * Whether the drill's root is a minor tonic, so the key is named for the
   * player as the relative minor: D minor, not F major. The signature
   * underneath is the same either way.
   */
  minor?: boolean;
  /** Times through, up and back down, that one sitting opens on. */
  cycles: number;
}

/** A scale: seven notes, one per letter, from semitones above the root. */
const scale = (semitones: readonly number[]): DrillNote[] =>
  semitones.map((s, step) => ({ semitones: s, step }));

/** A chord in thirds: root, third, fifth, and a seventh if there is one. */
const chord = (semitones: readonly number[]): DrillNote[] =>
  semitones.map((s, i) => ({ semitones: s, step: i * 2 }));

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const MELODIC_MINOR_UP = [0, 2, 3, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

/**
 * The relative minor's tonic: nine semitones above the major's, the sixth
 * degree. Every minor drill sits here and takes the major's signature.
 */
const RELATIVE_MINOR = 9;

export const DRILLS: readonly Drill[] = [
  { id: 'major-scale', name: 'Major scale', rootDegree: 0, up: scale(MAJOR), cycles: 4 },
  {
    id: 'harmonic-minor-scale',
    name: 'Harmonic minor scale',
    rootDegree: RELATIVE_MINOR,
    up: scale(HARMONIC_MINOR),
    minor: true,
    cycles: 4,
  },
  {
    // Ruled before it was built: ascending melodic, descending natural.
    id: 'melodic-minor-scale',
    name: 'Melodic minor scale',
    rootDegree: RELATIVE_MINOR,
    up: scale(MELODIC_MINOR_UP),
    down: scale(NATURAL_MINOR),
    minor: true,
    cycles: 4,
  },
  { id: 'tonic-arpeggio', name: 'Tonic arpeggio', rootDegree: 0, up: chord([0, 4, 7]), cycles: 8 },
  {
    id: 'subdominant-arpeggio',
    name: 'Subdominant arpeggio',
    rootDegree: 5,
    up: chord([0, 4, 7]),
    cycles: 8,
  },
  {
    id: 'dominant-arpeggio',
    name: 'Dominant arpeggio',
    rootDegree: 7,
    up: chord([0, 4, 7]),
    cycles: 8,
  },
  { id: 'dominant-7th', name: 'Dominant 7th', rootDegree: 7, up: chord([0, 4, 7, 10]), cycles: 8 },
  {
    // The id predates the minor scales, when it was named for the major key
    // it is relative to; kept so a stored choice still names it.
    id: 'relative-minor-arpeggio',
    name: 'Minor arpeggio',
    rootDegree: RELATIVE_MINOR,
    up: chord([0, 3, 7]),
    minor: true,
    cycles: 8,
  },
];

/**
 * The drill an id names, or the major scale for an id from nobody — which is
 * the drill the old Scales box always played, so an absent or stale choice
 * degrades to the most familiar thing rather than to a surprise.
 */
export function drillById(id: DrillId | undefined): Drill {
  return DRILLS.find((d) => d.id === id) ?? DRILLS[0];
}

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
  options: GenerateOptions,
  candidates: Candidate[],
  drill: Drill,
): SpelledPitch[] | null {
  const tonic = tonicPitchClass(options.fifths);
  const rootClass = pitchClass(tonic + drill.rootDegree);

  const [instrumentLow, instrumentHigh] = writtenRange(options.instrument, options.clef);

  const fitted = fitSpan(
    instrumentLow,
    instrumentHigh,
    rootClass,
    options.difficulty.patterns.spanSemitones,
  );
  if (!fitted) return null;

  /*
   * Where among the roots that fit the pattern actually starts.
   *
   * Asking for low or high means exactly that — the lowest or highest place
   * the pattern will go — because a player who picks a register has picked
   * it, and a control that quietly declined to leave the comfortable middle
   * would be no control at all.
   *
   * The middle is where the care goes. At the two easiest levels it is kept
   * inside the window a theme's tonic uses — written G to G on a treble-clef
   * tuba part, the octave from just below the stave to just inside it —
   * because a beginner asked for a scale should be reading the scale rather
   * than counting ledger lines to find where it starts. A preference rather
   * than a rule: where nothing in the window fits, the pattern goes where it
   * can.
   *
   * Wide spans often leave exactly one root, and then all three answers are
   * the same. That is honest: a two-octave scale takes most of a brass
   * compass and there is genuinely nowhere else to put it.
   */
  const register = options.register ?? 'middle';
  const window = options.difficulty.patterns.keepReadable
    ? tonicWindow(options.instrument, options.clef)
    : null;
  const inside = window ? fitted.roots.filter((r) => r >= window[0] && r <= window[1]) : [];
  const readable = inside.length > 0 ? inside : fitted.roots;
  const centre = middleOf(candidates);

  const root =
    register === 'low'
      ? Math.min(...fitted.roots)
      : register === 'high'
        ? Math.max(...fitted.roots)
        : readable.reduce((best, r) =>
            Math.abs(r - centre) < Math.abs(best - centre) ? r : best,
          );

  /*
   * Every note of the shape from the root up to the top of the span, octave
   * by octave. Working in semitones rather than whole octaves is what lets a
   * pattern stop on the fifth rather than always having to complete an octave.
   * The letter step climbs with the octave — seven letters to each — which is
   * what the spelling reads.
   */
  const climb = (shape: readonly DrillNote[]) => {
    const notes: Array<{ midi: number; step: number }> = [];
    for (let octave = 0; ; octave++) {
      let any = false;
      for (const note of shape) {
        const offset = octave * 12 + note.semitones;
        if (offset > fitted.span) continue;
        notes.push({ midi: root + offset, step: octave * 7 + note.step });
        any = true;
      }
      if (!any) break;
    }
    return notes;
  };

  const ascending = climb(drill.up);
  if (ascending.length < 2) return null;
  const top = ascending[ascending.length - 1].midi;

  /*
   * Back down without sounding the turning notes twice: everything strictly
   * below the top and above the root, in reverse. From the way-down shape
   * where the drill has one — the melodic minor comes down natural — and
   * otherwise from the way up, which is what a plain reversal always was.
   */
  const descending = climb(drill.down ?? drill.up)
    .filter((note) => note.midi < top && note.midi > root)
    .reverse();

  const rootLetter = spellInKey(root, options.fifths).letter;
  return [...ascending, ...descending].map((note) =>
    spellDrillNote(note.midi, rootLetter, note.step, options.fifths),
  );
}

/**
 * How a note of a drill is written: on the letter its step names, altered as
 * far as it takes to reach the pitch.
 *
 * A scale is one note per letter, and this is what makes the harmonic minor's
 * seventh come out as C sharp in D minor rather than the D flat the signature's
 * direction would choose. For a diatonic note the letter step lands on the very
 * letter the signature spells it with, so every drill that was right before is
 * unchanged.
 *
 * Where the letter would need a double accidental — the raised seventh of G
 * sharp, D sharp and A sharp minor, which a publisher prints as a double sharp
 * — it falls back to the key's own spelling, which writes the same sound as
 * the natural above. This app never prints a double accidental; see
 * `spellInKey`, whose rule that is. Three keys no brass band part is written
 * in, and the settings screen says so beside them.
 */
function spellDrillNote(
  midi: number,
  rootLetter: SpelledPitch['letter'],
  step: number,
  fifths: number,
): SpelledPitch {
  const letter = LETTERS[(LETTERS.indexOf(rootLetter) + step) % LETTERS.length];
  return spellWithLetter(midi, letter) ?? spellInKey(midi, fifths);
}

function chooseNext(
  rng: Rng,
  options: GenerateOptions,
  candidates: Candidate[],
  previous: number,
  wantChromatic: boolean,
  first: boolean,
  fingering: { previousMask: number; freshStart: boolean; needsValve?: boolean },
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
 *
 * **Not open just past a block boundary.** The same thought, for the moment
 * it matters most: carrying on playing into the grey is how the offer of
 * more music is taken, and a valve going down is the only unambiguous way a
 * set of buttons can say so. Open notes there would leave a player who *is*
 * playing looking exactly like one who has stopped.
 */
function applyFingeringRules(
  pool: Candidate[],
  fingering: { previousMask: number; freshStart: boolean; needsValve?: boolean },
): Candidate[] {
  let narrowed = pool;
  if (fingering.previousMask >= 0) {
    narrowed = prefer(narrowed, (c) => c.mask !== fingering.previousMask);
  }
  if (fingering.freshStart || fingering.needsValve) {
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
