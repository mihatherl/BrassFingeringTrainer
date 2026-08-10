/**
 * Instrument definitions.
 *
 * Each instrument is described by two facts that are deliberately kept apart:
 *
 *  1. `fundamentalMidi` — the sounding pitch of its open harmonic series. This,
 *     and only this, determines fingering.
 *  2. `transposition` — how written pitch maps to sounding pitch, per clef.
 *
 * Keeping them apart is what lets one fingering engine serve the whole brass
 * band. Brass band treble-clef transpositions are chosen so that written C
 * always lands on the instrument's 2nd partial, which is why a cornet player and
 * an Eb bass player use identical fingerings for identical written notes. That
 * falls out of the arithmetic here rather than being special-cased.
 *
 * Bass clef is concert pitch (offset 0), which is precisely why its fingerings
 * are instrument-specific — and it needs no special-casing either.
 */

export type Clef = 'treble' | 'bass';

/**
 * Which recorded voice stands in for an instrument.
 *
 * General MIDI has no cornet, flugel, tenor horn, baritone or euphonium, so
 * each is mapped to the nearest thing it does have — matched on bore and
 * register rather than on name. A tenor horn is conical and mellow, so the horn
 * suits it far better than the trumpet its range might suggest.
 */
export type SampleSet = 'trumpet' | 'french_horn' | 'trombone' | 'tuba';

export interface Instrument {
  id: string;
  name: string;
  /** Sounding MIDI pitch of the open harmonic series fundamental. */
  fundamentalMidi: number;
  /** Practical sounding range, inclusive [low, high]. */
  soundingRange: [number, number];
  /** Written -> sounding offset in semitones. Missing clef means unsupported. */
  transposition: Partial<Record<Clef, number>>;
  /**
   * Whether notes below the three-valve floor may fall back to a virtual 4th
   * valve. True for instruments that really have one (euphonium, tubas); the
   * 4th is masked out of what the player is asked to hold — see fingering.ts.
   */
  allowVirtualFourth: boolean;
  /** The recorded voice that stands in for this instrument. */
  sampleSet: SampleSet;
}

/*
 * Tops, and why the low brass reach higher than band parts do.
 *
 * The three instruments with a fourth valve are written up to C6 in treble
 * clef — concert Eb4 on an Eb bass, Bb3 on a BBb, Bb4 on a euphonium. That is
 * above where band parts usually stop, and deliberately: a two-octave scale
 * takes twenty-four of a compass's semitones, so where the compass is barely
 * wider than that the scale has nowhere to sit but the very bottom. An Eb
 * bass capped at written G5 could only ever play its two-octave scales from
 * four ledger lines below the stave, which is neither where anyone practises
 * them nor anything anyone wants to read. The top is a practice ceiling, not
 * a claim about repertoire.
 */
export const INSTRUMENTS: readonly Instrument[] = [
  {
    id: 'cornet',
    name: 'Bb Cornet / Trumpet',
    fundamentalMidi: 46, // Bb2
    soundingRange: [52, 82], // E3 - Bb5
    transposition: { treble: -2 },
    allowVirtualFourth: false,
    sampleSet: 'trumpet',
  },
  {
    id: 'flugel',
    name: 'Bb Flugel Horn',
    fundamentalMidi: 46, // Bb2
    soundingRange: [52, 80], // E3 - Ab5
    transposition: { treble: -2 },
    allowVirtualFourth: false,
    sampleSet: 'trumpet',
  },
  {
    id: 'tenor-horn',
    name: 'Eb Tenor Horn',
    fundamentalMidi: 39, // Eb2
    soundingRange: [45, 72], // A2 - C5
    transposition: { treble: -9 },
    allowVirtualFourth: false,
    sampleSet: 'french_horn',
  },
  {
    id: 'baritone',
    name: 'Bb Baritone',
    fundamentalMidi: 34, // Bb1
    soundingRange: [40, 68], // E2 - Ab4
    transposition: { treble: -14, bass: 0 },
    allowVirtualFourth: false,
    sampleSet: 'trombone',
  },
  {
    id: 'euphonium',
    name: 'Bb Euphonium',
    fundamentalMidi: 34, // Bb1
    soundingRange: [35, 70], // B1 - Bb4, which is written C6 in treble clef
    transposition: { treble: -14, bass: 0 },
    allowVirtualFourth: true,
    sampleSet: 'trombone',
  },
  {
    id: 'eb-bass',
    name: 'Eb Bass (Tuba)',
    fundamentalMidi: 27, // Eb1
    soundingRange: [28, 63], // E1 - Eb4, which is written C6 in treble clef
    transposition: { treble: -21, bass: 0 },
    allowVirtualFourth: true,
    sampleSet: 'tuba',
  },
  {
    id: 'bb-bass',
    name: 'Bb Bass (Tuba)',
    fundamentalMidi: 22, // Bb0
    soundingRange: [23, 58], // B0 - Bb3, which is written C6 in treble clef
    transposition: { treble: -26, bass: 0 },
    allowVirtualFourth: true,
    sampleSet: 'tuba',
  },
];

export function instrumentById(id: string): Instrument {
  const found = INSTRUMENTS.find((i) => i.id === id);
  if (!found) throw new Error(`Unknown instrument: ${id}`);
  return found;
}

export function supportsClef(instrument: Instrument, clef: Clef): boolean {
  return instrument.transposition[clef] !== undefined;
}

export function availableClefs(instrument: Instrument): Clef[] {
  return (['treble', 'bass'] as const).filter((c) => supportsClef(instrument, c));
}

export function transpositionFor(instrument: Instrument, clef: Clef): number {
  const t = instrument.transposition[clef];
  if (t === undefined) {
    throw new Error(`${instrument.name} does not read ${clef} clef`);
  }
  return t;
}

export function soundingFromWritten(
  writtenMidi: number,
  instrument: Instrument,
  clef: Clef,
): number {
  return writtenMidi + transpositionFor(instrument, clef);
}

export function writtenFromSounding(
  soundingMidi: number,
  instrument: Instrument,
  clef: Clef,
): number {
  return soundingMidi - transpositionFor(instrument, clef);
}

/** The instrument's playable range expressed in written pitch for a given clef. */
export function writtenRange(instrument: Instrument, clef: Clef): [number, number] {
  const t = transpositionFor(instrument, clef);
  return [instrument.soundingRange[0] - t, instrument.soundingRange[1] - t];
}

/**
 * The middle of the instrument's compass, as a sounding pitch.
 *
 * Used as the fallback when a player is making a sound the app cannot otherwise
 * account for. Expressed relative to each instrument's own range rather than as
 * a fixed pitch, so it means "somewhere comfortable" on a tuba as much as on a
 * cornet — for an Eb bass reading treble clef it lands on written E4.
 */
export function middleSounding(instrument: Instrument, clef: Clef): number {
  const [low, high] = writtenRange(instrument, clef);
  return soundingFromWritten(Math.round((low + high) / 2), instrument, clef);
}
