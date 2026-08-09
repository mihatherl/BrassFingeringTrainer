/*
 * The theme corpus.
 *
 * Written by hand to prove the format before there is a hundred of anything.
 * These are deliberately plain: the point of the first few is that the path
 * works end to end — degrees in, spelled into the player's key, engraved,
 * playable — not that the tunes are memorable.
 *
 * Each one is built the way a phrase is built rather than the way a sequence
 * is: a figure, then the same figure answered, then a cadence. That structure
 * is the whole reason this corpus exists, since a random walk cannot produce
 * it, and it is what makes material readable at sight.
 *
 * Rules every theme here obeys, all of them checked by `validateTheme`:
 * both ends sit on a stable degree so any two themes can abut; nothing crosses
 * a bar line except as a tie; and the beats add up to the bars declared.
 */

import type { Theme } from './theme';

/** Shorthand: a note of `beats` on `degree`, with the options a few need. */
function n(
  degree: number,
  beats: number,
  extra: { alter?: number; octave?: number; tied?: boolean } = {},
) {
  return { degree, beats, ...extra };
}

/** Shorthand: a rest. */
function r(beats: number) {
  return { rest: true as const, beats };
}

const FIRST_BATCH: readonly Theme[] = [
  {
    id: 'plain-answer',
    name: 'Plain answer',
    difficulty: 'beginner',
    metres: [[4, 4]],
    bars: 8,
    /*
     * Four bars that rise to the fifth and four that come back, in crotchets
     * and minims and nothing else. The second phrase is the first with its
     * ending changed, which is the smallest complete piece of musical grammar
     * there is and the first thing a reader learns to see coming.
     */
    events: [
      n(1, 1), n(2, 1), n(3, 1), n(2, 1),
      n(3, 1), n(4, 1), n(5, 2),
      n(5, 1), n(4, 1), n(3, 1), n(2, 1),
      n(3, 2), n(2, 2),
      n(1, 1), n(2, 1), n(3, 1), n(2, 1),
      n(3, 1), n(4, 1), n(5, 2),
      n(5, 1), n(4, 1), n(3, 1), n(2, 1),
      n(1, 4),
    ],
  },
  {
    id: 'waltz-step',
    name: 'Waltz step',
    difficulty: 'easy',
    metres: [[3, 4]],
    bars: 8,
    /*
     * Three-time, where the shape of the bar is the lesson: something on the
     * downbeat and lighter movement after it. The rest in bar four is there to
     * be counted rather than to be pretty — a phrase that never breathes gives
     * a reader nowhere to look up.
     */
    events: [
      n(3, 1), n(2, 1), n(1, 1),
      n(2, 1), n(3, 1), n(4, 1),
      n(5, 2), n(4, 1),
      n(3, 2), r(1),
      n(5, 1), n(4, 1), n(3, 1),
      n(4, 1), n(3, 1), n(2, 1),
      n(1, 1), n(2, 1), n(3, 1),
      n(1, 3),
    ],
  },
  {
    id: 'dotted-conversation',
    name: 'Dotted conversation',
    difficulty: 'medium',
    metres: [[4, 4]],
    bars: 8,
    /*
     * Dotted rhythms, and a tie over the bar line into bar six — which is the
     * one thing in this theme that cannot be read note by note. A tie is where
     * a sight-reader either keeps their place or loses it.
     */
    events: [
      n(1, 1.5), n(2, 0.5), n(3, 1), n(4, 1),
      n(5, 1.5), n(4, 0.5), n(3, 2),
      n(3, 1), n(4, 1), n(5, 1.5), n(6, 0.5),
      n(5, 2), r(2),
      n(5, 1), n(4, 1), n(3, 1), n(2, 1, { tied: true }),
      n(2, 1), n(3, 1), n(4, 1), n(3, 1),
      n(1, 1), n(2, 1.5), n(3, 0.5), n(2, 1),
      n(1, 4),
    ],
  },
  {
    id: 'step-and-sequence',
    name: 'Step and sequence',
    difficulty: 'easy',
    metres: [[4, 4]],
    bars: 8,
    /*
     * A sequence: one figure, then the same figure a step higher. Recognising
     * that the second bar is the first one moved is the single most useful
     * thing a sight-reader can do, and it is exactly what a random walk can
     * never offer — there is nothing to recognise.
     */
    events: [
      n(1, 1), n(2, 0.5), n(3, 0.5), n(2, 1), n(3, 1),
      n(4, 1), n(3, 0.5), n(4, 0.5), n(5, 1), n(3, 1),
      n(2, 1), n(3, 0.5), n(4, 0.5), n(3, 1), n(4, 1),
      n(5, 2), n(4, 2),
      n(3, 1), n(4, 0.5), n(5, 0.5), n(4, 1), n(5, 1),
      n(6, 1), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1),
      n(3, 1.5), n(2, 0.5), n(1, 1), n(2, 1),
      n(1, 4),
    ],
  },
  {
    id: 'question-and-answer',
    name: 'Question and answer',
    difficulty: 'medium',
    metres: [[4, 4]],
    bars: 8,
    /*
     * Two four-bar sentences, the second answering the first: the same opening,
     * a different ending. The rest at the top of bar three is a breath rather
     * than a gap — it is where the answer starts, and a reader who is counting
     * hears the shape rather than merely surviving it.
     */
    events: [
      n(5, 1), n(3, 1), n(1, 1), n(2, 1),
      n(3, 1.5), n(2, 0.5), n(1, 2),
      r(1), n(5, 1), n(4, 1), n(3, 1),
      n(2, 1), n(3, 1), n(1, 2),
      n(1, 1), n(3, 1), n(5, 1), n(4, 1),
      n(3, 1), n(2, 0.5), n(1, 0.5), n(2, 2),
      n(3, 1), n(4, 1), n(5, 2, { tied: true }),
      n(5, 2), n(1, 2),
    ],
  },
  {
    id: 'turning-figure',
    name: 'Turning figure',
    difficulty: 'easy',
    metres: [[4, 4]],
    bars: 8,
    /*
     * A turn around the tonic, and the one accidental in the corpus that earns
     * its place: the raised fourth in bar two is a passing note leaning into the
     * fifth, which is where nearly every accidental in real band music comes
     * from. An accidental that is not going anywhere is just a wrong note to
     * read.
     */
    events: [
      n(1, 0.5), n(2, 0.5), n(3, 1), n(2, 0.5), n(1, 0.5), n(2, 1),
      n(3, 1), n(4, 0.5), n(4, 0.5, { alter: 1 }), n(5, 2),
      n(5, 0.5), n(4, 0.5), n(3, 0.5), n(2, 0.5), n(3, 1), n(1, 1),
      n(2, 1.5), n(1, 0.5), n(2, 2),
      n(3, 0.5), n(4, 0.5), n(5, 1), n(4, 0.5), n(3, 0.5), n(4, 1),
      n(5, 1), n(6, 0.5), n(5, 0.5), n(4, 1), n(3, 1),
      n(2, 0.5), n(3, 0.5), n(4, 1), n(3, 1), n(2, 1),
      n(1, 4),
    ],
  },
  {
    id: 'falling-thirds',
    name: 'Falling thirds',
    difficulty: 'medium',
    metres: [[4, 4]],
    bars: 12,
    /*
     * Twelve bars rather than eight, so that stitching does not fall into a
     * predictable rhythm of its own — a page of nothing but eight-bar phrases
     * teaches a reader to expect the break rather than to read for it.
     *
     * The interval is the drill: a third down then a step up, over and over,
     * which is the shape most likely to be misread as a run of steps.
     */
    events: [
      n(5, 1), n(3, 1), n(4, 1), n(2, 1),
      n(3, 1), n(1, 1), n(2, 2),
      n(3, 0.5), n(4, 0.5), n(5, 1), n(3, 1), n(4, 1),
      n(5, 2), r(1), n(5, 1),
      n(6, 1), n(4, 1), n(5, 1), n(3, 1),
      n(4, 1), n(2, 1), n(3, 2),
      n(1, 0.5), n(2, 0.5), n(3, 0.5), n(4, 0.5), n(5, 2),
      n(4, 1.5), n(3, 0.5), n(2, 2),
      n(3, 1), n(5, 1), n(4, 1), n(2, 1),
      n(3, 1), n(1, 1), n(2, 1), n(3, 1),
      n(4, 1), n(3, 1), n(2, 2, { tied: true }),
      n(2, 2), n(1, 2),
    ],
  },
  {
    id: 'six-eight-lilt',
    name: 'Six-eight lilt',
    difficulty: 'easy',
    metres: [[6, 8]],
    bars: 8,
    /*
     * Compound time, beamed in two groups of three rather than in sixes — the
     * thing about 6/8 that has to be seen rather than counted. Quaver movement
     * throughout, with the dotted crotchets marking where the pulse actually
     * is.
     */
    events: [
      n(1, 0.5), n(2, 0.5), n(3, 0.5), n(4, 0.5), n(3, 0.5), n(2, 0.5),
      n(3, 0.5), n(4, 0.5), n(5, 0.5), n(5, 1.5),
      n(5, 0.5), n(6, 0.5), n(5, 0.5), n(4, 0.5), n(3, 0.5), n(4, 0.5),
      n(3, 1.5), r(1.5),
      n(5, 0.5), n(4, 0.5), n(3, 0.5), n(2, 0.5), n(3, 0.5), n(4, 0.5),
      n(5, 0.5), n(4, 0.5), n(3, 0.5), n(2, 1.5),
      n(1, 0.5), n(2, 0.5), n(3, 0.5), n(4, 0.5), n(3, 0.5), n(2, 0.5),
      n(1, 3),
    ],
  },
  {
    id: 'lift-a-fifth',
    name: 'Lift a fifth',
    difficulty: 'medium',
    metres: [[4, 4]],
    bars: 12,
    /*
     * The one that exercises everything at once: chromatic inflections, a leap
     * of a sixth, a tie across the bar line, and a change of key at bar seven —
     * up a fifth, relative, so it is a lift whichever key the player chose.
     *
     * The raised fourth in bar six is the pivot: it is the leading note of the
     * key being moved to, which is how a modulation is heard rather than merely
     * printed.
     */
    keyChanges: [{ atBar: 7, fifths: 1 }],
    events: [
      n(1, 1), n(3, 1), n(5, 2),
      n(6, 1), n(5, 1), n(4, 1.5), n(3, 0.5),
      n(3, 1), n(2, 1), n(3, 1), n(5, 1),
      n(4, 2), n(3, 2),
      n(5, 1), n(6, 1), n(5, 1), n(3, 1),
      n(4, 1, { alter: 1 }), n(4, 1, { alter: 1 }), n(5, 2),
      n(1, 1), n(2, 1), n(3, 1), n(4, 1),
      n(5, 1.5), n(4, 0.5), n(3, 2),
      n(6, 1), n(5, 1), n(4, 1), n(3, 1),
      n(2, 1), n(3, 1), n(4, 2),
      n(3, 1), n(2, 1), n(1, 2, { tied: true }),
      n(1, 4),
    ],
  },
];

/*
 * Everything below was written after a player read the first batch and said the
 * hardest of it felt like the middle of the range. He was right, and the reason
 * was mechanical: every check was a ceiling, so plain crotchets passed at
 * Expert. `validateTheme` now checks floors too — a theme must be harder than
 * the level below it in at least one respect, and must move at the pace its own
 * rhythm pool moves at. Four themes were re-tagged downwards on the strength of
 * it, and these were written to fill what that left empty.
 */
const HARDER: readonly Theme[] = [
  {
    id: 'bell-tune',
    name: 'Bell tune',
    difficulty: 'beginner',
    metres: [[4, 4]],
    bars: 8,
    /* Steps and thirds, crotchets and minims, and nothing else at all. */
    events: [
      n(1, 1), n(3, 1), n(2, 1), n(1, 1),
      n(2, 1), n(3, 1), n(4, 2),
      n(3, 1), n(2, 1), n(3, 1), n(4, 1),
      n(5, 2), n(4, 2),
      n(3, 1), n(4, 1), n(5, 1), n(4, 1),
      n(3, 1), n(2, 1), n(3, 2),
      n(4, 1), n(3, 1), n(2, 1), n(1, 1),
      n(1, 4),
    ],
  },
  {
    id: 'two-by-two',
    name: 'Two by two',
    difficulty: 'beginner',
    metres: [[4, 4]],
    bars: 8,
    /* Minims in pairs, so the beat is felt in twos before it is felt in fours. */
    events: [
      n(5, 2), n(3, 2),
      n(4, 2), n(2, 2),
      n(3, 1), n(4, 1), n(5, 1), n(3, 1),
      n(2, 2), n(1, 2),
      n(1, 1), n(2, 1), n(3, 1), n(4, 1),
      n(5, 2), n(3, 2),
      n(2, 1), n(3, 1), n(2, 1), n(1, 1),
      n(1, 4),
    ],
  },
  {
    id: 'running-steps',
    name: 'Running steps',
    difficulty: 'easy',
    metres: [[4, 4]],
    bars: 8,
    /* Quavers in pairs against crotchets, and one bar that stops to be counted. */
    events: [
      n(1, 0.5), n(2, 0.5), n(3, 1), n(4, 1), n(3, 1),
      n(2, 0.5), n(3, 0.5), n(4, 1), n(5, 2),
      n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1), n(1, 1),
      n(2, 2), r(2),
      n(3, 0.5), n(4, 0.5), n(5, 1), n(4, 1), n(3, 1),
      n(4, 1), n(5, 1), n(6, 2),
      n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1), n(1, 1),
      n(1, 4),
    ],
  },
  {
    id: 'semiquaver-drill',
    name: 'Semiquaver drill',
    difficulty: 'hard',
    metres: [[4, 4]],
    bars: 8,
    /*
     * Semiquavers in fours, which is where Hard starts: the eye has to take a
     * beat at a time rather than a note at a time, and the octave in bar three
     * is there to break the habit of reading everything as a step.
     */
    events: [
      n(1, 0.25), n(2, 0.25), n(3, 0.25), n(4, 0.25), n(5, 1), n(4, 0.5), n(3, 0.5), n(2, 1),
      n(3, 0.25), n(4, 0.25), n(5, 0.25), n(6, 0.25), n(5, 1), n(3, 1), n(1, 1),
      n(1, 0.5), n(1, 0.5, { octave: 1 }), n(7, 0.5), n(6, 0.5), n(5, 1), n(4, 1),
      n(3, 1), n(4, 0.5, { alter: 1 }), n(5, 1.5), r(1),
      n(5, 0.25), n(6, 0.25), n(7, 0.25), n(1, 0.25, { octave: 1 }),
      n(7, 0.5), n(6, 0.5), n(5, 1), n(3, 1),
      n(4, 0.5), n(3, 0.5), n(2, 0.5), n(1, 0.5), n(2, 1), n(3, 1),
      n(1, 0.25), n(3, 0.25), n(5, 0.25), n(3, 0.25), n(1, 1), n(2, 1), n(3, 1),
      n(1, 4),
    ],
  },
  {
    id: 'wide-steps',
    name: 'Wide steps',
    difficulty: 'hard',
    metres: [[4, 4]],
    bars: 8,
    /*
     * Dotted quavers against semiquavers — the rhythm most often read as an
     * even pair — and a scale that runs the whole octave in bar three so the
     * hand has somewhere to arrive.
     */
    events: [
      n(5, 0.75), n(4, 0.25), n(3, 0.5), n(2, 0.5), n(1, 1), n(5, 1),
      n(5, 0.75), n(6, 0.25), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1),
      n(1, 0.5), n(2, 0.5), n(3, 0.5), n(4, 0.5),
      n(5, 0.5), n(6, 0.5), n(7, 0.5), n(1, 0.5, { octave: 1 }),
      n(1, 2, { octave: 1 }), n(5, 2),
      n(5, 0.75), n(4, 0.25), n(3, 0.5), n(4, 0.5), n(5, 1), n(3, 1),
      n(2, 0.5), n(3, 0.5), n(4, 0.5), n(5, 0.5), n(6, 1), n(5, 1),
      n(4, 0.75), n(3, 0.25), n(2, 0.5), n(1, 0.5), n(2, 1), n(3, 1),
      n(1, 4),
    ],
  },
  {
    id: 'chromatic-climb',
    name: 'Chromatic climb',
    difficulty: 'hard',
    metres: [[4, 4]],
    bars: 8,
    /*
     * Accidentals in earnest, and every one of them a passing note going
     * somewhere: sharpened degrees leaning upwards, a flattened sixth leaning
     * down. Chromatic notes that lead nowhere are just wrong notes to read.
     */
    events: [
      n(1, 0.5), n(1, 0.5, { alter: 1 }), n(2, 0.5), n(3, 0.5), n(3, 1), n(2, 1),
      n(3, 0.5), n(4, 0.5), n(4, 0.5, { alter: 1 }), n(5, 0.5), n(5, 1), n(4, 1),
      n(3, 0.25), n(4, 0.25), n(5, 0.25), n(6, 0.25), n(6, 1, { alter: -1 }), n(5, 1), n(4, 1),
      n(3, 2), n(5, 2),
      n(5, 0.5), n(6, 0.5, { alter: -1 }), n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1),
      n(2, 0.5), n(2, 0.5, { alter: 1 }), n(3, 0.5), n(4, 0.5), n(5, 1), n(3, 1),
      n(1, 0.25), n(2, 0.25), n(3, 0.25), n(4, 0.25), n(5, 1), n(4, 1), n(2, 1),
      n(1, 4),
    ],
  },
  {
    id: 'ninth-leaps',
    name: 'Ninth leaps',
    difficulty: 'expert',
    metres: [[4, 4]],
    bars: 8,
    /*
     * What Expert is for: the leap in bar two is a tenth, which is past
     * anything Hard asks for, and the line never settles into crotchets. A
     * player who has been reading intervals by shape has to start reading them
     * by name.
     */
    events: [
      n(1, 0.25), n(2, 0.25), n(3, 0.25), n(4, 0.25),
      n(5, 0.25), n(4, 0.25), n(3, 0.25), n(2, 0.25),
      n(3, 0.5), n(2, 0.5), n(1, 1),
      n(1, 0.5), n(3, 0.5, { octave: 1 }), n(2, 0.5, { octave: 1 }),
      n(1, 0.5, { octave: 1 }), n(7, 0.5), n(6, 0.5), n(5, 1),
      n(5, 0.25), n(6, 0.25), n(7, 0.25), n(1, 0.25, { octave: 1 }),
      n(7, 0.25), n(6, 0.25), n(5, 0.25), n(4, 0.25), n(3, 1), n(2, 1),
      n(3, 0.5), n(4, 0.5, { alter: 1 }), n(5, 0.5), n(6, 0.5), n(5, 2),
      n(5, 0.25), n(4, 0.25), n(3, 0.25), n(2, 0.25),
      n(1, 0.5), n(2, 0.5), n(3, 0.5), n(4, 0.5), n(5, 1),
      n(6, 0.5, { alter: -1 }), n(5, 0.5), n(4, 0.5), n(3, 0.5),
      n(2, 0.5), n(1, 0.5), n(2, 1),
      n(3, 0.25), n(4, 0.25), n(5, 0.25), n(6, 0.25),
      n(7, 0.25), n(1, 0.25, { octave: 1 }), n(7, 0.25), n(5, 0.25), n(3, 1), n(1, 1),
      n(1, 4),
    ],
  },
  {
    id: 'chromatic-descent',
    name: 'Chromatic descent',
    difficulty: 'expert',
    metres: [[4, 4]],
    bars: 8,
    /*
     * Heavily chromatic and mostly downward, which is the harder direction to
     * read: a rising chromatic line is spelled with sharps and looks like it is
     * going somewhere, while a falling one is a row of flats that all look
     * alike. The ninth in bar four is the one thing that jumps.
     */
    events: [
      n(5, 0.5), n(4, 0.5, { alter: 1 }), n(4, 0.5), n(3, 0.5),
      n(2, 0.5), n(1, 0.5), n(2, 1),
      n(3, 0.5), n(4, 0.5), n(5, 0.5), n(6, 0.5, { alter: -1 }),
      n(5, 0.5), n(4, 0.5), n(3, 1),
      n(1, 0.25), n(2, 0.25), n(3, 0.25), n(4, 0.25),
      n(5, 0.25), n(6, 0.25), n(7, 0.25), n(1, 0.25, { octave: 1 }), n(5, 1), n(3, 1),
      n(1, 0.5), n(2, 0.5, { octave: 1 }), n(1, 0.5, { octave: 1 }), n(7, 0.5),
      n(6, 1), n(5, 1),
      n(5, 0.25), n(4, 0.25), n(3, 0.25), n(2, 0.25),
      n(3, 0.5), n(4, 0.5), n(5, 0.5), n(6, 0.5), n(5, 1),
      n(4, 0.5, { alter: 1 }), n(5, 0.5), n(4, 0.5), n(3, 0.5),
      n(2, 0.5), n(1, 0.5), n(3, 1),
      n(5, 0.25), n(6, 0.25), n(7, 0.25), n(1, 0.25, { octave: 1 }),
      n(7, 0.5), n(5, 0.5), n(3, 0.5), n(2, 0.5), n(1, 1),
      n(1, 4),
    ],
  },
  {
    id: 'toccata',
    name: 'Toccata',
    difficulty: 'expert',
    metres: [[4, 4]],
    bars: 12,
    /*
     * Twelve bars of near-continuous movement, built on a broken-third figure
     * that shifts up a step each time — the pattern is there to be found, and
     * finding it is the only way to read this at speed. Long enough that a
     * reader has to keep their place rather than remember it.
     */
    events: [
      n(1, 0.25), n(3, 0.25), n(2, 0.25), n(4, 0.25),
      n(3, 0.25), n(5, 0.25), n(4, 0.25), n(6, 0.25), n(5, 1), n(3, 1),
      n(2, 0.25), n(4, 0.25), n(3, 0.25), n(5, 0.25),
      n(4, 0.25), n(6, 0.25), n(5, 0.25), n(7, 0.25), n(6, 1), n(4, 1),
      n(5, 0.5), n(1, 0.5, { octave: 1 }), n(7, 0.5), n(5, 0.5),
      n(6, 0.5), n(4, 0.5), n(5, 1),
      n(3, 0.25), n(2, 0.25), n(1, 0.25), n(2, 0.25),
      n(3, 0.5), n(4, 0.5), n(5, 1), n(3, 1),
      n(1, 0.5), n(3, 0.5, { octave: 1 }), n(2, 0.5, { octave: 1 }),
      n(1, 0.5, { octave: 1 }), n(6, 0.5), n(5, 0.5), n(4, 1),
      n(3, 0.25), n(4, 0.25), n(5, 0.25), n(6, 0.25),
      n(7, 0.25), n(6, 0.25), n(5, 0.25), n(4, 0.25), n(3, 1), n(1, 1),
      n(1, 0.5), n(2, 0.5, { alter: -1 }), n(2, 0.5), n(3, 0.5),
      n(4, 0.5), n(4, 0.5, { alter: 1 }), n(5, 1),
      n(5, 0.25), n(6, 0.25), n(5, 0.25), n(4, 0.25), n(3, 0.5), n(2, 0.5), n(1, 2),
      n(1, 0.25), n(2, 0.25), n(3, 0.25), n(4, 0.25),
      n(5, 0.25), n(6, 0.25), n(7, 0.25), n(1, 0.25, { octave: 1 }), n(7, 1), n(5, 1),
      n(3, 0.5), n(5, 0.5), n(4, 0.5), n(6, 0.5), n(5, 0.5), n(3, 0.5), n(2, 1),
      n(1, 0.25), n(3, 0.25), n(5, 0.25), n(3, 0.25),
      n(1, 0.25), n(3, 0.25), n(5, 0.25), n(3, 0.25), n(2, 1), n(1, 1),
      n(1, 4),
    ],
  },
];

export const THEMES: readonly Theme[] = [...FIRST_BATCH, ...HARDER];

export function themeById(id: string): Theme | undefined {
  return THEMES.find((theme) => theme.id === id);
}
