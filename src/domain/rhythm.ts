/**
 * Note durations.
 *
 * Everything is measured in beats, where one beat is a crotchet. Tempo in bpm
 * therefore converts to seconds with a single division, and the scrolling
 * display can work purely in beats without knowing the tempo at all.
 */

export type NoteValue = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';

export const NOTE_VALUES: readonly NoteValue[] = [
  'whole',
  'half',
  'quarter',
  'eighth',
  'sixteenth',
];

/** Crotchet beats for each undotted value. */
export const NOTE_VALUE_BEATS: Record<NoteValue, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
};

/** How many flags or beams the value carries. */
export const NOTE_VALUE_FLAGS: Record<NoteValue, number> = {
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  sixteenth: 2,
};

export interface Duration {
  value: NoteValue;
  dotted: boolean;
}

export function durationBeats(duration: Duration): number {
  const base = NOTE_VALUE_BEATS[duration.value];
  return duration.dotted ? base * 1.5 : base;
}

export function quarterNote(): Duration {
  return { value: 'quarter', dotted: false };
}

/** Nearest exact duration for a beat count, or null if it isn't representable. */
export function durationFromBeats(beats: number): Duration | null {
  for (const value of NOTE_VALUES) {
    for (const dotted of [false, true]) {
      if (Math.abs(durationBeats({ value, dotted }) - beats) < 1e-9) {
        return { value, dotted };
      }
    }
  }
  return null;
}

/** Values that carry beams, i.e. can be grouped rather than flagged. */
export function isBeamable(duration: Duration): boolean {
  return NOTE_VALUE_FLAGS[duration.value] > 0;
}
