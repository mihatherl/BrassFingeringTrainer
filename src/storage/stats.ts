/**
 * Per-note accuracy history, which is what makes weak-note drilling possible.
 *
 * Statistics are kept per instrument and clef, since the same written note is a
 * different problem on a different instrument, and the same fingering problem
 * appears at a different written pitch in bass clef.
 */

import type { Clef } from '../domain/instruments';

export interface NoteStat {
  attempts: number;
  correct: number;
}

export type NoteStats = Map<number, NoteStat>;

const STORAGE_PREFIX = 'brass-trainer:stats:';

/**
 * Older results are worth less than recent ones — otherwise a note drilled to
 * death months ago keeps its weight forever. Decaying on write keeps the store
 * small and makes recent practice dominate.
 */
const DECAY = 0.98;
const MAX_ATTEMPTS = 60;

function keyFor(instrumentId: string, clef: Clef): string {
  return `${STORAGE_PREFIX}${instrumentId}:${clef}`;
}

export function loadStats(instrumentId: string, clef: Clef): NoteStats {
  try {
    const raw = localStorage.getItem(keyFor(instrumentId, clef));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, NoteStat>;
    return new Map(
      Object.entries(parsed)
        .map(([midi, stat]) => [Number(midi), stat] as const)
        .filter(([midi, stat]) => Number.isFinite(midi) && stat.attempts > 0),
    );
  } catch {
    return new Map();
  }
}

export function saveStats(instrumentId: string, clef: Clef, stats: NoteStats): void {
  try {
    const record: Record<string, NoteStat> = {};
    for (const [midi, stat] of stats) record[midi] = stat;
    localStorage.setItem(keyFor(instrumentId, clef), JSON.stringify(record));
  } catch {
    // Not worth breaking a practice session over.
  }
}

export function mergeSessionStats(
  existing: NoteStats,
  session: ReadonlyMap<number, NoteStat>,
): NoteStats {
  const merged: NoteStats = new Map();

  for (const [midi, stat] of existing) {
    merged.set(midi, { attempts: stat.attempts * DECAY, correct: stat.correct * DECAY });
  }
  for (const [midi, stat] of session) {
    const current = merged.get(midi) ?? { attempts: 0, correct: 0 };
    merged.set(midi, {
      attempts: Math.min(MAX_ATTEMPTS, current.attempts + stat.attempts),
      correct: Math.min(MAX_ATTEMPTS, current.correct + stat.correct),
    });
  }
  return merged;
}

export function recordSession(
  instrumentId: string,
  clef: Clef,
  session: ReadonlyMap<number, NoteStat>,
): NoteStats {
  const merged = mergeSessionStats(loadStats(instrumentId, clef), session);
  saveStats(instrumentId, clef, merged);
  return merged;
}

/** Below this, a note has not been seen often enough to call it weak. */
export const MIN_ATTEMPTS_TO_JUDGE = 2;

/**
 * Turns accuracy history into generator weights.
 *
 * Notes that are reliably correct are damped rather than excluded — they still
 * need to appear, or the exercise stops resembling music — and notes that are
 * missed are boosted sharply.
 */
export function noteWeights(stats: NoteStats): Map<number, number> {
  const weights = new Map<number, number>();
  for (const [midi, stat] of stats) {
    if (stat.attempts < MIN_ATTEMPTS_TO_JUDGE) continue;
    const accuracy = stat.correct / stat.attempts;
    const weight = accuracy >= 0.95 ? 0.6 : 1 + 3 * (1 - accuracy) ** 1.5;
    weights.set(midi, Math.min(4, Math.max(0.4, weight)));
  }
  return weights;
}

/** The notes most in need of work, worst first. */
export function weakestNotes(stats: NoteStats, limit = 5): Array<{ midi: number; accuracy: number }> {
  return [...stats]
    .filter(([, stat]) => stat.attempts >= MIN_ATTEMPTS_TO_JUDGE)
    .map(([midi, stat]) => ({ midi, accuracy: stat.correct / stat.attempts }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, limit);
}
