import { describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { keyAt } from '../domain/keys';
import { barAt, beatOfBar, metreFor } from '../domain/metre';
import { durationBeats } from '../domain/rhythm';
import { difficultyById } from './difficulty';
import { generateExercise } from './generate';
import { barLineAtOrAfter, canRekey, canRekeyKind, rekeyFrom } from './rekey';
import type { Exercise, ExerciseKind } from './types';

function build(
  fifths: number,
  seed: number,
  over: { kind?: ExerciseKind; bars?: number; keySet?: number[] } = {},
): Exercise {
  return generateExercise({
    instrument: instrumentById('eb-bass'),
    clef: 'treble',
    fifths,
    keySet: over.keySet ?? [fifths],
    difficulty: difficultyById('medium'),
    kind: over.kind ?? 'phrases',
    bars: over.bars ?? 8,
    cycles: 2,
    themeCount: 2,
    metre: metreFor(4, 4),
    seed,
  });
}

describe('canRekey', () => {
  it('accepts two runs of the generator at the same settings in different keys', () => {
    expect(canRekey(build(-3, 1), build(2, 9))).toBe(true);
  });

  it('refuses paper of a different length', () => {
    const live = build(-3, 1);
    const shorter: Exercise = { ...live, totalBeats: live.totalBeats - 4 };
    expect(canRekey(live, shorter)).toBe(false);
  });

  /**
   * The material rule, which is structural rather than a matter of taste: a
   * pattern's length falls out of how many cycles of its shape fit, so it is
   * not the same shape of paper from one key to the next.
   */
  it('offers the dial to free material and nothing else', () => {
    expect(canRekeyKind('phrases')).toBe(true);
    expect(canRekeyKind('scales')).toBe(false);
    expect(canRekeyKind('arpeggios')).toBe(false);
    expect(canRekeyKind('themes')).toBe(false);
    expect(canRekeyKind('imported')).toBe(false);
  });
});

describe('barLineAtOrAfter', () => {
  it('stays put on a bar line and rounds up off one', () => {
    const exercise = build(-3, 1);
    expect(barLineAtOrAfter(exercise, 0)).toBe(0);
    expect(barLineAtOrAfter(exercise, 4)).toBe(4);
    expect(barLineAtOrAfter(exercise, 4.25)).toBe(8);
    // Before the music is where the count-in lives; the first bar line is 0.
    expect(barLineAtOrAfter(exercise, -3)).toBe(0);
  });
});

describe('rekeyFrom', () => {
  it('leaves the head alone and writes the tail in the new key', () => {
    const live = build(-3, 1);
    const fresh = build(2, 9);
    const before = live.notes.slice(0, 4).map((note) => ({ ...note }));

    const done = rekeyFrom(live, fresh, 8);
    expect(done, 'the splice happened').not.toBeNull();
    expect(done?.fifths).toBe(2);
    expect(done?.changeBeat).toBe(8);

    // Nothing at all has moved below the splice — not the pitches, not the
    // spelling, not the indices. This is the invariant the whole feature stands
    // on: judgements are held by note index.
    expect(live.notes.slice(0, 4)).toEqual(before);

    const from = done!.fromNoteIndex;
    expect(live.notes[from - 1].startBeat, 'the head ends before the change').toBeLessThan(8);
    expect(live.notes[from].startBeat, 'and the tail starts at it').toBeGreaterThanOrEqual(8);

    // Every note of the tail is the fresh exercise's, in its key.
    const tail = fresh.notes.filter((note) => note.startBeat >= 8);
    expect(live.notes.slice(from)).toEqual(tail);
    expect(keyAt(live.keys, 8)).toBe(2);
    expect(keyAt(live.keys, 7.99)).toBe(-3);
  });

  it('keeps the paper the same length, so the horizon and the offer still hold', () => {
    const live = build(-3, 1);
    const wasTotal = live.totalBeats;
    const wasChosen = live.chosenBeats;
    rekeyFrom(live, build(2, 9), 8);
    expect(live.totalBeats).toBe(wasTotal);
    expect(live.chosenBeats).toBe(wasChosen);
  });

  it('cuts a tie that would otherwise hang across the join', () => {
    const live = build(-3, 1);
    const fresh = build(2, 9);
    const changeBeat = 8;
    // Force the case rather than hunt for it: the note before the join is made
    // to claim a partner that the splice is about to take away.
    const last = live.notes.filter((note) => note.startBeat < changeBeat).length - 1;
    live.notes[last] = { ...live.notes[last], tiedToNext: true };

    rekeyFrom(live, fresh, changeBeat);
    expect(live.notes[last].tiedToNext, 'no tie may point into the new key').toBe(false);
  });

  it('leaves everything alone when the key asked for is the one already playing', () => {
    const live = build(-3, 1);
    const notes = live.notes.slice();
    expect(rekeyFrom(live, build(-3, 9), 8)).toBeNull();
    expect(live.notes).toEqual(notes);
  });

  it('refuses a change that would land past the end of the paper', () => {
    const live = build(-3, 1);
    expect(rekeyFrom(live, build(2, 9), live.totalBeats)).toBeNull();
    expect(keyAt(live.keys, live.totalBeats - 1)).toBe(-3);
  });

  it('refuses material whose paper is a different shape', () => {
    const live = build(-3, 1);
    const notes = live.notes.slice();
    const odd: Exercise = { ...build(2, 9), totalBeats: live.totalBeats + 4 };
    expect(rekeyFrom(live, odd, 8)).toBeNull();
    expect(live.notes).toEqual(notes);
  });

  /**
   * A key tour ends where the player names their own key — ruled by the player
   * on 2026-08-14. The tour's later changes are the score's instruction and the
   * dial is theirs, so from the splice on there is one key and no more changes.
   */
  it('ends a key tour', () => {
    const live = build(-3, 5, { bars: 24, keySet: [-3, -2, -1] });
    expect(live.keys.length, 'a tour to begin with').toBeGreaterThan(1);

    const done = rekeyFrom(live, build(2, 9, { bars: 24 }), 8);
    expect(done, 'and canRekey is about shape, which a tour does not change').not.toBeNull();
    expect(live.keys.filter((change) => change.fromBeat > 8)).toEqual([]);
    expect(keyAt(live.keys, live.totalBeats - 1)).toBe(2);
  });

  /**
   * The reason the splice has to land on a bar line, checked from the other
   * end: no note may straddle the join, or one bar would hold two keys' worth
   * of accidentals and the tie and beam arithmetic would read across it.
   */
  it('joins where no note is sounding', () => {
    const live = build(-3, 3);
    const changeBeat = barLineAtOrAfter(live, 9);
    const done = rekeyFrom(live, build(4, 11), changeBeat);
    expect(done).not.toBeNull();

    const from = done!.fromNoteIndex;
    const last = live.notes[from - 1];
    expect(last.startBeat + durationBeats(last.duration)).toBeLessThanOrEqual(changeBeat + 1e-9);
    expect(barAt(live.metres, changeBeat), 'and the join is a bar line').toBe(
      barAt(live.metres, beatOfBar(live.metres, barAt(live.metres, changeBeat))),
    );
  });

  it('rewrites the rests as well as the notes', () => {
    const live = build(-3, 1);
    const fresh = build(2, 9);
    rekeyFrom(live, fresh, 8);
    expect(live.rests.filter((rest) => rest.startBeat >= 8)).toEqual(
      fresh.rests.filter((rest) => rest.startBeat >= 8),
    );
    expect(live.rests.every((rest) => rest.startBeat < live.totalBeats)).toBe(true);
  });
});
