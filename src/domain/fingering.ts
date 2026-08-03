/**
 * The fingering engine.
 *
 * A valved brass instrument is a tube with a harmonic series, plus valves that
 * each add a fixed length of tubing and so lower the pitch by a fixed number of
 * semitones. To finger a note you pick a harmonic at or above it and press the
 * valves whose combined drop closes the gap.
 *
 * That is the whole algorithm, and it generates correct fingerings for every
 * instrument from a single number (the fundamental) rather than needing a chart
 * per instrument.
 */

import type { Instrument } from './instruments';

/** How far each valve lowers the pitch, in semitones. */
export const VALVE_SEMITONES: Record<number, number> = { 1: 2, 2: 1, 3: 3, 4: 5 };

/**
 * Harmonics that are actually usable.
 *
 * The 7th partial is omitted deliberately: it sits about a third of a semitone
 * flat and no player uses it. Including it silently corrupts the upper register
 * — written high A would come out as valve 2 instead of 1-2.
 */
export const USABLE_PARTIALS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 9, 10];

/** Semitones of the nth harmonic above the fundamental. */
export function partialSemitones(n: number): number {
  return Math.round(12 * Math.log2(n));
}

/**
 * Bit mask of the three on-screen buttons: bit 0 = valve 1, bit 1 = valve 2,
 * bit 2 = valve 3. A 4th valve contributes no bit, so masking is automatic.
 */
export function maskOf(valves: readonly number[]): number {
  let mask = 0;
  for (const v of valves) {
    if (v >= 1 && v <= 3) mask |= 1 << (v - 1);
  }
  return mask;
}

export function maskToValves(mask: number): number[] {
  const valves: number[] = [];
  for (let v = 1; v <= 3; v++) {
    if (mask & (1 << (v - 1))) valves.push(v);
  }
  return valves;
}

/** "1-2", "open", … for display. */
export function formatMask(mask: number): string {
  const valves = maskToValves(mask);
  return valves.length === 0 ? 'open' : valves.join('-');
}

export interface Fingering {
  /** The true fingering, which may include valve 4. */
  valves: number[];
  /** What the player must hold on three buttons — valve 4 masked out. */
  mask: number;
  /** Which harmonic this fingering sits on. */
  partial: number;
  /** Semitones below that harmonic. */
  offset: number;
  /** True when the real fingering needs a 4th valve the buttons don't show. */
  usesFourth: boolean;
}

/**
 * Every valve combination whose total drop equals `offset`.
 *
 * Iterating in ascending bit order happens to yield the conventional fingering
 * first: for a 3-semitone drop it produces 1-2 before 3, and for 5 it produces
 * 1-3 before 4 — which is what players are taught.
 */
function combosForOffset(offset: number, includeFourth: boolean): number[][] {
  const available = includeFourth ? [1, 2, 3, 4] : [1, 2, 3];
  const combos: number[][] = [];
  for (let bits = 0; bits < 1 << available.length; bits++) {
    const combo: number[] = [];
    let drop = 0;
    for (let i = 0; i < available.length; i++) {
      if (bits & (1 << i)) {
        combo.push(available[i]);
        drop += VALVE_SEMITONES[available[i]];
      }
    }
    if (drop === offset) combos.push(combo);
  }
  return combos;
}

/**
 * All fingerings for a sounding pitch, best first.
 *
 * Three-valve fingerings are found first, across every usable harmonic — that
 * naturally yields both the standard fingering and the genuine alternates (top
 * G is open, but also 1-3 from the harmonic above).
 *
 * Only when a note is unreachable with three valves does the virtual 4th come
 * into play. That ordering matters: a 4th-valve combination such as {4} alone
 * masks down to "no buttons", so if it were offered as an alternate for a note
 * normally fingered 1-3, the app would accept open valves as correct. Reserving
 * the 4th for notes that have no three-valve fingering at all makes that
 * impossible.
 */
export function fingeringsFor(soundingMidi: number, instrument: Instrument): Fingering[] {
  const found: Fingering[] = [];

  for (const partial of USABLE_PARTIALS) {
    const partialMidi = instrument.fundamentalMidi + partialSemitones(partial);
    const offset = partialMidi - soundingMidi;
    if (offset < 0 || offset > 6) continue;
    for (const valves of combosForOffset(offset, false)) {
      found.push({ valves, mask: maskOf(valves), partial, offset, usesFourth: false });
    }
  }
  if (found.length > 0) return found;

  if (!instrument.allowVirtualFourth) return found;

  for (const partial of USABLE_PARTIALS) {
    const partialMidi = instrument.fundamentalMidi + partialSemitones(partial);
    const offset = partialMidi - soundingMidi;
    if (offset < 7 || offset > 11) continue;
    for (const valves of combosForOffset(offset, true)) {
      if (!valves.includes(4)) continue;
      found.push({ valves, mask: maskOf(valves), partial, offset, usesFourth: true });
    }
    // Only the lowest reachable harmonic; higher ones are not real fingerings here.
    if (found.length > 0) break;
  }
  return found;
}

/** The fingering a player would be taught, or null if the note is unplayable. */
export function primaryFingering(
  soundingMidi: number,
  instrument: Instrument,
): Fingering | null {
  return fingeringsFor(soundingMidi, instrument)[0] ?? null;
}

/**
 * Every button state that should be accepted as correct for a note.
 *
 * Judging against this set rather than a single answer means a player using a
 * legitimate alternate fingering is not marked wrong.
 */
export function acceptedMasks(soundingMidi: number, instrument: Instrument): Set<number> {
  return new Set(fingeringsFor(soundingMidi, instrument).map((f) => f.mask));
}

export function isPlayable(soundingMidi: number, instrument: Instrument): boolean {
  return fingeringsFor(soundingMidi, instrument).length > 0;
}
