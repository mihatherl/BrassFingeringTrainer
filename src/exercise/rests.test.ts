import { describe, expect, it } from 'vitest';
import { barAt, metreFor } from '../domain/metre';
import { spellInKey } from '../domain/keys';
import {
  insideMultiRest,
  isMultiRest,
  multiRestSpans,
  nextBreakableBar,
  suppressedBarLines,
} from './rests';
import type { Exercise, NoteEvent } from './types';

/**
 * Multi-bar rests: the thing a brass band bass part is mostly made of.
 *
 * The rules being pinned here are all consequences of one decision — that a
 * multi-bar rest is *not* expanded into that many bars of silence, because the
 * count is the notation. See `rests.ts`.
 */

function note(startBeat: number): NoteEvent {
  return {
    writtenMidi: 67,
    pitch: spellInKey(67, 0),
    soundingMidi: 46,
    startBeat,
    duration: { value: 'quarter', dotted: false },
    acceptedMasks: [0],
    primaryMask: 0,
    beamGroup: -1,
    tupletGroup: -1,
    tiedToNext: false,
    showAccidental: false,
  };
}

/** Two bars of crotchets, then `bars` off, then two bars more. */
function withRest(bars: number, beatsPerBar = 4): Exercise {
  const restBeats = bars * beatsPerBar;
  const after = 8 + restBeats;
  return {
    notes: [0, 1, 2, 3, 4, 5, 6, 7, after, after + 1].map(note),
    rests: [{ startBeat: 8, duration: { value: 'whole', dotted: false }, bars }],
    instrumentId: 'eb-bass',
    clef: 'treble',
    keys: [{ fromBeat: 0, fifths: 0 }],
    metres: [{ fromBeat: 0, metre: metreFor(beatsPerBar, 4) }],
    tempo: [],
    totalBeats: after + 8,
    chosenBeats: after + 8,
    seed: 1,
    kind: 'phrases',
  };
}

describe('finding a multi-bar rest', () => {
  it('tells one from an ordinary rest', () => {
    expect(isMultiRest({ startBeat: 0, duration: { value: 'whole', dotted: false } })).toBe(false);
    // One bar off is a plain whole-bar rest, not the symbol.
    expect(
      isMultiRest({ startBeat: 0, duration: { value: 'whole', dotted: false }, bars: 1 }),
    ).toBe(false);
    expect(
      isMultiRest({ startBeat: 0, duration: { value: 'whole', dotted: false }, bars: 8 }),
    ).toBe(true);
  });

  it('locates it in bars and in beats', () => {
    const [span] = multiRestSpans(withRest(20));
    expect(span.fromBar).toBe(2);
    expect(span.toBar).toBe(22);
    expect(span.fromBeat).toBe(8);
    expect(span.toBeat).toBe(88);
    expect(span.bars).toBe(20);
  });

  it('measures it in bars, not in crotchets', () => {
    // Twenty bars of 3/4 is sixty crotchets, not eighty. `bars` is the count
    // printed over the rest and `duration` says only what one of those bars is
    // written as — a semibreve rest, whatever the metre.
    const [span] = multiRestSpans(withRest(20, 3));
    expect(span.toBeat - span.fromBeat).toBe(60);
    expect(span.toBar - span.fromBar).toBe(20);
  });
});

describe('what a multi-bar rest hides', () => {
  const spans = multiRestSpans(withRest(20));

  it('keeps the bar lines at its two ends and drops the rest', () => {
    // The ends are the rest's own edges and are drawn. The nineteen between
    // would contradict the count printed over them.
    expect(insideMultiRest(spans, 8)).toBe(false);
    expect(insideMultiRest(spans, 88)).toBe(false);
    expect(insideMultiRest(spans, 12)).toBe(true);
    expect(insideMultiRest(spans, 84)).toBe(true);
  });

  it('names exactly the interior bar lines', () => {
    const hidden = suppressedBarLines([{ fromBeat: 0, metre: metreFor(4, 4) }], spans);
    expect(hidden.size).toBe(19);
    expect(hidden.has(8)).toBe(false);
    expect(hidden.has(12)).toBe(true);
    expect(hidden.has(88)).toBe(false);
  });
});

describe('breaking a line', () => {
  const spans = multiRestSpans(withRest(20));

  it('pushes a break out of a rest rather than into it', () => {
    // Half a symbol at the end of a line means nothing, so a candidate landing
    // inside is moved to the far side.
    expect(nextBreakableBar(spans, 10)).toBe(22);
    expect(nextBreakableBar(spans, 21)).toBe(22);
  });

  it('leaves a break at either end alone', () => {
    expect(nextBreakableBar(spans, 2)).toBe(2);
    expect(nextBreakableBar(spans, 22)).toBe(22);
    expect(nextBreakableBar(spans, 30)).toBe(30);
  });
});

describe('counting through a rest', () => {
  it('still numbers the bars inside it', () => {
    /*
     * The whole point of counting a multi-bar rest is that the bars go by. So
     * the music after twenty bars off resumes at bar 23 as a player counts it,
     * and the bar numbers on the page have to agree or the count is useless.
     */
    const exercise = withRest(20);
    expect(barAt(exercise.metres, 88)).toBe(22);
    expect(barAt(exercise.metres, 8)).toBe(2);
  });
});
