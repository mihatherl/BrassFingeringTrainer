/**
 * Tempo: what speed is in force at a beat, and the arithmetic that turns a
 * varying tempo into seconds.
 *
 * The same shape as `metre.ts` and `keys.ts` on purpose — "what is in force
 * at beat b" is a question a part asks of its tempo as well as its key and
 * its metre. The events are plain data a generator settles once; the compiled
 * map answers questions. The transport consumes a map; it does not define one.
 *
 * With tempo varying linearly across a span, both directions are closed form:
 * no numeric integration, no accumulated drift, and the inverse is a real
 * inverse rather than a search — which matters, because the render loop asks
 * time → beat sixty times a second while the scheduler asks beat → time.
 *
 * Where `bpm(b) = bpm₀ + m·(b − b₀)` across a span starting at `b₀`:
 *
 *   seconds(b) = (60/m)·ln(bpm(b) / bpm₀)
 *   beats(s)   = (bpm₀/m)·(e^(m·s/60) − 1)
 *
 * `m = 0` degenerates to a multiplication and is branched on, so a constant
 * tempo costs what it always cost.
 *
 * Three properties every caller leans on:
 *
 *  - **Total over negative beats.** The count-in lives there, at the opening
 *    tempo — which is also what a real count-in does. Events before or on
 *    beat 0 are refused, so the region behind the music is always flat.
 *  - **A hold sits between the beats.** A `hold` is a dwell: the beat stands
 *    still while a fixed number of seconds pass. Time on the far side of the
 *    dwell includes it, so a note on the boundary beat sounds — and is judged
 *    — at the release, not the arrival. The inverse plateaus at the held
 *    beat, which is the display honestly standing still.
 *  - **Monotone both ways.** Never strictly so through a dwell, and no caller
 *    requires that; the transport's scheduling horizon plateaus at a hold and
 *    scheduling pauses by itself.
 */

/** A change of tempo, a rit./accel., or a fermata's dwell. Beats > 0 only. */
export type TempoEvent =
  /** A step: this many crotchets per minute from this beat on. */
  | { kind: 'tempo'; atBeat: number; bpm: number }
  /**
   * A linear glide from the tempo in force at `fromBeat` to `toBpm` at
   * `toBeat`, which then stays in force — a rit. never resumes by itself,
   * and an "a tempo" is written as the step it is.
   */
  | { kind: 'ramp'; fromBeat: number; toBeat: number; toBpm: number }
  /**
   * A fermata's dwell: the beat stands still for this many seconds. Chosen
   * by the app when the exercise is built — the app is the conductor, so it
   * knows the length of its own hold; see the plan for why the open-ended
   * kind waits for the microphone.
   */
  | { kind: 'hold'; atBeat: number; seconds: number };

/** A stretch of beats with linearly varying tempo. `slope` is bpm per beat. */
interface Span {
  kind: 'span';
  fromBeat: number;
  /** Seconds from beat zero to `fromBeat`, dwells included. */
  t0: number;
  bpm0: number;
  slope: number;
}

/** A hold: zero beats wide, `seconds` long. */
interface Dwell {
  kind: 'dwell';
  atBeat: number;
  t0: number;
  seconds: number;
}

/**
 * The compiled form: segments in beat order with cumulative times, so both
 * directions are a lookup and one closed-form step. The first span always
 * starts at beat 0 with the nominal tempo and no slope, which is what makes
 * the map total over the count-in's negative beats.
 */
export interface TempoMap {
  nominalBpm: number;
  segments: ReadonlyArray<Span | Dwell>;
}

/**
 * Below this slope a ramp is arithmetically constant. The log form divides
 * by the slope, and at a millionth of a bpm per beat the two branches agree
 * to more places than a clock has; branching keeps the degenerate case exact.
 */
const FLAT = 1e-9;

const EPSILON = 1e-9;

function secondsAcross(bpm0: number, slope: number, beats: number): number {
  if (Math.abs(slope) < FLAT) return beats * (60 / bpm0);
  // log1p and expm1 rather than log and exp: a gentle ramp is a logarithm of
  // one-plus-almost-nothing, and the naive forms throw that "almost nothing"
  // away before taking it, which the inverse then amplifies by 60/slope.
  return (60 / slope) * Math.log1p((slope * beats) / bpm0);
}

function beatsAcross(bpm0: number, slope: number, seconds: number): number {
  if (Math.abs(slope) < FLAT) return seconds / (60 / bpm0);
  return (bpm0 / slope) * Math.expm1((slope * seconds) / 60);
}

/**
 * Compiles events into a map, validating as it goes.
 *
 * Refusals are thrown rather than collected: events come from this app's own
 * plan generator, never from a user or a file, so a bad one is a programming
 * error and the loudest possible failure is the kindest. Events at the same
 * beat resolve in musical order — the hold happens in the old tempo, then
 * the new tempo takes force — which is the rit-into-fermata-into-new-tempo
 * cliché every band knows, stated as an ordering rule.
 */
export function compileTempo(
  nominalBpm: number,
  events: readonly TempoEvent[] = [],
): TempoMap {
  if (!Number.isFinite(nominalBpm) || nominalBpm <= 0) {
    throw new Error(`A tempo must be a positive number of bpm, not ${nominalBpm}`);
  }

  const beatOf = (event: TempoEvent) => ('atBeat' in event ? event.atBeat : event.fromBeat);
  // Holds before steps before ramps at the same beat; see above.
  const rank = { hold: 0, tempo: 1, ramp: 2 } as const;
  const ordered = [...events].sort(
    (a, b) => beatOf(a) - beatOf(b) || rank[a.kind] - rank[b.kind],
  );

  const segments: Array<Span | Dwell> = [];
  let beat = 0;
  let t = 0;
  let bpm = nominalBpm;

  for (const event of ordered) {
    const at = beatOf(event);
    if (!Number.isFinite(at) || at <= EPSILON) {
      throw new Error(`A tempo event at beat ${at} sits on or before the music's start`);
    }
    if (at < beat - EPSILON) {
      throw new Error(`A tempo event at beat ${at} overlaps the one before it`);
    }
    if (at > beat + EPSILON) {
      segments.push({ kind: 'span', fromBeat: beat, t0: t, bpm0: bpm, slope: 0 });
      t += secondsAcross(bpm, 0, at - beat);
      beat = at;
    }

    switch (event.kind) {
      case 'tempo': {
        if (!Number.isFinite(event.bpm) || event.bpm <= 0) {
          throw new Error(`A tempo must be a positive number of bpm, not ${event.bpm}`);
        }
        bpm = event.bpm;
        break;
      }
      case 'ramp': {
        if (!Number.isFinite(event.toBpm) || event.toBpm <= 0) {
          throw new Error(`A ramp must reach a positive bpm, not ${event.toBpm}`);
        }
        if (!(event.toBeat > event.fromBeat + EPSILON)) {
          throw new Error(`A ramp from beat ${event.fromBeat} to ${event.toBeat} has no width`);
        }
        const slope = (event.toBpm - bpm) / (event.toBeat - beat);
        segments.push({ kind: 'span', fromBeat: beat, t0: t, bpm0: bpm, slope });
        t += secondsAcross(bpm, slope, event.toBeat - beat);
        beat = event.toBeat;
        bpm = event.toBpm;
        break;
      }
      case 'hold': {
        if (!Number.isFinite(event.seconds) || event.seconds < 0) {
          throw new Error(`A hold must last a non-negative time, not ${event.seconds}s`);
        }
        segments.push({ kind: 'dwell', atBeat: beat, t0: t, seconds: event.seconds });
        t += event.seconds;
        break;
      }
    }
  }

  segments.push({ kind: 'span', fromBeat: beat, t0: t, bpm0: bpm, slope: 0 });
  return { nominalBpm, segments };
}

/** The last span at or before a beat. Before beat 0 that is the opening one. */
function spanAt(map: TempoMap, beat: number): Span {
  let found: Span | null = null;
  for (const segment of map.segments) {
    if (segment.kind !== 'span') continue;
    if (segment.fromBeat > beat) break;
    found = segment;
  }
  // Only a query before beat 0 lands here, and the opening span extrapolates
  // backwards exactly because its slope is zero.
  return found ?? (map.segments.find((s) => s.kind === 'span') as Span);
}

/**
 * Seconds from beat zero to a beat. Negative during the count-in.
 *
 * A beat on the far side of a dwell answers *after* it — the re-entry note
 * is scheduled, and judged, at the release.
 */
export function timeAt(map: TempoMap, beat: number): number {
  const span = spanAt(map, beat);
  return span.t0 + secondsAcross(span.bpm0, span.slope, beat - span.fromBeat);
}

/**
 * The beat reached after so many seconds — the inverse of `timeAt`, except
 * across a dwell, where it holds the boundary beat until the dwell is spent.
 */
export function beatAt(map: TempoMap, seconds: number): number {
  let found: Span | Dwell | null = null;
  for (const segment of map.segments) {
    if (segment.t0 > seconds) break;
    found = segment;
  }
  const segment = found ?? map.segments[0];
  if (segment.kind === 'dwell') return segment.atBeat;
  return segment.fromBeat + beatsAcross(segment.bpm0, segment.slope, seconds - segment.t0);
}

/**
 * The tempo in force at a beat, in crotchets per minute.
 *
 * On a boundary the new tempo has taken force, matching `keyAt`. Nothing in
 * the clock needs this — it is for whatever tells the player: the printed
 * metronome mark, and the orb's sense of how much energy is in the music.
 */
export function tempoAt(map: TempoMap, beat: number): number {
  const span = spanAt(map, beat);
  return span.bpm0 + span.slope * (beat - span.fromBeat);
}
