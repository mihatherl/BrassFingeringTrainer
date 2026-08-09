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
    difficulty: 'easy',
    metres: [[4, 4]],
    bars: 8,
    /*
     * Dotted rhythms, and a tie over the bar line into bar six — which is the
     * one thing in this theme that cannot be read note by note. A tie is where
     * a sight-reader either keeps their place or loses it.
     *
     * At Easy since ties moved there: nothing else in it reaches past that
     * level, which a player said before the rules did.
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
    difficulty: 'easy',
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

/*
 * What survives of a variation set, and why only this.
 *
 * Five variations on *Ah! vous dirai-je, maman* were written — one at each
 * difficulty, plain through decorated — and four were binned by the player they
 * were written for. The one kept is the tune as it actually goes, dotted, with
 * a note held across a bar line.
 *
 * The lesson is not that variations were a bad idea; the two figuration
 * variations below were kept from the same tune. It is that *the same melody at
 * every level is its own monotony*: a player who meets Twinkle at Beginner,
 * Easy, Medium, Hard and Expert has met one tune five times, which is the
 * sameness the set was meant to cure rather than a cure for it. One or two
 * treatments of a tune, at levels far enough apart to be different music, is
 * where the idea earns its place.
 *
 * The tune is French, about 1761, and Mozart wrote variations on it rather than
 * writing it. Both are long out of copyright, which is worth being deliberate
 * about in a corpus meant to be sold.
 */
const VARIATIONS: readonly Theme[] = [
  {
    id: 'twinkle-dotted',
    name: 'Twinkle — dotted',
    difficulty: 'medium',
    metres: [[4, 4]],
    bars: 12,
    /*
     * The tune as it actually goes, fifth and all, with the rhythm dotted and
     * one note held over the bar line into bar five. Bar six pushes against the
     * beat: a quaver, then crotchets, then a quaver — the same notes landing in
     * the wrong places, which is where a reader either counts or guesses.
     */
    events: [
      n(1, 1.5), n(1, 0.5), n(5, 1), n(5, 1),
      n(6, 1), n(6, 0.5), n(5, 0.5), n(5, 2),
      n(4, 1.5), n(4, 0.5), n(3, 1), n(3, 1),
      n(2, 1), n(2, 1), n(1, 2, { tied: true }),
      n(1, 1), n(5, 1), n(5, 1), n(4, 1),
      n(4, 0.5), n(3, 1), n(3, 1), n(2, 1), n(2, 0.5),
      n(5, 1), n(5, 0.5), n(4, 0.5), n(4, 1), n(3, 1),
      n(3, 1.5), n(2, 0.5), n(2, 2),
      n(1, 1.5), n(1, 0.5), n(5, 1), n(5, 1),
      n(6, 1), n(6, 0.5), n(5, 0.5), n(5, 1), r(1),
      n(4, 1), n(4, 0.5), n(3, 0.5), n(3, 1), n(2, 1),
      n(2, 1), n(1, 3),
    ],
  },
];

/*
 * Two figuration variations on the same tune, written to be compared.
 *
 * The idea: each bar keeps one note of the melody, on the first quaver, and
 * spends the rest of the bar arpeggiating around it. That is a real and old
 * device — it is what Mozart's variations do to this very tune — and the tune
 * survives it, because the ear picks the downbeats out of the figuration and
 * hears the melody underneath.
 *
 * Where the two differ is which triad gets arpeggiated, and it is worth hearing
 * rather than being told:
 *
 * `twinkle-centred` takes the triad *centred* on the melody note — a third
 * below and a third above — so the melody note always sits in the middle of its
 * own figure. Neat, symmetrical, and harmonically loose: on the melody's fifth
 * it produces the mediant where the tune wants the tonic, so the bar leans
 * somewhere the tune does not.
 *
 * `twinkle-figured` arpeggiates the chord the bar is actually in, arranged so
 * the melody note is one of its notes. Less tidy as a rule, and it is what the
 * harmony is doing anyway.
 *
 * One melody note per bar reduces the tune to its downbeats, which is the usual
 * price of this device and part of why it is a hard read: the player is holding
 * a tune that is only implied.
 */
const FIGURED: readonly Theme[] = [
  {
    id: 'twinkle-centred',
    name: 'Twinkle — centred triads',
    difficulty: 'hard',
    metres: [[4, 4]],
    bars: 12,
    /* Third below, third above, so the melody note sits inside its own chord. */
    events: [
      n(1, 0.5), n(6, 0.5, { octave: -1 }), n(1, 0.5), n(3, 0.5),
      n(1, 0.5), n(3, 0.5), n(1, 0.5), n(6, 0.5, { octave: -1 }),
      n(6, 0.5), n(1, 0.5, { octave: 1 }), n(6, 0.5), n(4, 0.5),
      n(6, 0.5), n(4, 0.5), n(6, 0.5), n(1, 0.5, { octave: 1 }),
      n(4, 0.5), n(2, 0.5), n(4, 0.5), n(6, 0.5),
      n(4, 0.5), n(6, 0.5), n(4, 0.5), n(2, 0.5),
      n(2, 0.5), n(7, 0.5, { octave: -1 }), n(2, 0.5), n(4, 0.5),
      n(2, 0.5), n(4, 0.5), n(2, 0.5), n(7, 0.5, { octave: -1 }),
      n(5, 0.5), n(3, 0.5), n(5, 0.5), n(7, 0.5),
      n(5, 0.5), n(7, 0.5), n(5, 0.5), n(3, 0.5),
      n(3, 0.5), n(1, 0.5), n(3, 0.5), n(5, 0.5),
      n(3, 0.5), n(5, 0.5), n(3, 0.5), n(1, 0.5),
      n(5, 0.5), n(7, 0.5), n(5, 0.5), n(3, 0.5),
      n(5, 0.5), n(3, 0.5), n(5, 0.5), n(7, 0.5),
      n(3, 0.5), n(5, 0.5), n(3, 0.5), n(1, 0.5),
      n(3, 0.5), n(1, 0.5), n(3, 0.5), n(5, 0.5),
      n(1, 0.5), n(3, 0.5), n(1, 0.5), n(6, 0.5, { octave: -1 }),
      n(1, 0.5), n(6, 0.5, { octave: -1 }), n(1, 0.5), n(3, 0.5),
      n(6, 0.5), n(4, 0.5), n(6, 0.5), n(1, 0.5, { octave: 1 }),
      n(6, 0.5), n(1, 0.5, { octave: 1 }), n(6, 0.5), n(4, 0.5),
      n(4, 0.5), n(6, 0.5), n(4, 0.5), n(2, 0.5),
      n(4, 0.5), n(2, 0.5), n(4, 0.5), n(6, 0.5),
      n(2, 0.5), n(4, 0.5), n(2, 0.5), n(7, 0.5, { octave: -1 }), n(1, 2),
    ],
  },
  {
    id: 'twinkle-figured',
    name: 'Twinkle — figured on the harmony',
    difficulty: 'hard',
    metres: [[4, 4]],
    bars: 12,
    /*
     * The same shape, arpeggiating the chord each bar is really in — tonic
     * where the tune sits on the tonic, subdominant under the sixth and the
     * fourth, dominant before the close. The melody note is still the first
     * quaver; it is simply a note of the bar's own chord rather than the middle
     * of a triad built on itself.
     */
    events: [
      n(1, 0.5), n(3, 0.5), n(5, 0.5), n(1, 0.5, { octave: 1 }),
      n(5, 0.5), n(3, 0.5), n(5, 0.5), n(3, 0.5),
      n(6, 0.5), n(4, 0.5), n(6, 0.5), n(1, 0.5, { octave: 1 }),
      n(6, 0.5), n(4, 0.5), n(6, 0.5), n(4, 0.5),
      n(4, 0.5), n(6, 0.5), n(1, 0.5, { octave: 1 }), n(6, 0.5),
      n(4, 0.5), n(6, 0.5), n(4, 0.5), n(1, 0.5),
      n(2, 0.5), n(5, 0.5), n(7, 0.5), n(2, 0.5, { octave: 1 }),
      n(7, 0.5), n(5, 0.5), n(7, 0.5), n(2, 0.5),
      n(5, 0.5), n(3, 0.5), n(1, 0.5), n(3, 0.5),
      n(5, 0.5), n(1, 0.5, { octave: 1 }), n(5, 0.5), n(3, 0.5),
      n(3, 0.5), n(5, 0.5), n(1, 0.5, { octave: 1 }), n(5, 0.5),
      n(3, 0.5), n(1, 0.5), n(3, 0.5), n(5, 0.5),
      n(5, 0.5), n(1, 0.5, { octave: 1 }), n(5, 0.5), n(3, 0.5),
      n(1, 0.5), n(3, 0.5), n(5, 0.5), n(3, 0.5),
      n(3, 0.5), n(1, 0.5), n(3, 0.5), n(5, 0.5),
      n(1, 0.5, { octave: 1 }), n(5, 0.5), n(3, 0.5), n(1, 0.5),
      n(1, 0.5), n(1, 0.5, { octave: 1 }), n(5, 0.5), n(3, 0.5),
      n(1, 0.5), n(3, 0.5), n(5, 0.5), n(3, 0.5),
      n(6, 0.5), n(1, 0.5, { octave: 1 }), n(6, 0.5), n(4, 0.5),
      n(6, 0.5), n(4, 0.5), n(1, 0.5, { octave: 1 }), n(6, 0.5),
      n(4, 0.5), n(6, 0.5), n(1, 0.5, { octave: 1 }), n(6, 0.5),
      n(4, 0.5), n(6, 0.5), n(4, 0.5), n(1, 0.5),
      n(2, 0.5), n(5, 0.5), n(7, 0.5), n(2, 0.5), n(1, 2),
    ],
  },
];


/*
 * Two-four, which the app offers and the corpus had nothing in at all — so
 * every difficulty in it fell back to a random walk.
 *
 * A bar of two crotchets is the march, which is most of what a brass band
 * plays, and it reads differently from four-four rather than being half of it:
 * the downbeat comes round twice as often, so a figure that pushes against the
 * beat has half the room to resolve in. From Medium up that is the drill — the
 * middle note of a bar straddling beat two, which is the commonest syncopation
 * in band music and the one most often read as a plain crotchet.
 */
const TWO_FOUR: readonly Theme[] = [
  {
    id: 'quickstep',
    name: 'Quickstep',
    difficulty: 'beginner',
    metres: [[2, 4]],
    bars: 8,
    /* Steps and thirds on the beat, so the metre is the only new thing. */
    events: [
      n(1, 1), n(3, 1),
      n(2, 1), n(1, 1),
      n(2, 1), n(3, 1),
      n(4, 2),
      n(3, 1), n(5, 1),
      n(4, 1), n(3, 1),
      n(2, 1), n(3, 1),
      n(1, 2),
    ],
  },
  {
    id: 'parade-step',
    name: 'Parade step',
    difficulty: 'beginner',
    metres: [[2, 4]],
    bars: 8,
    /* Falling thirds down, stepping back up — the shape of a march trio. */
    events: [
      n(5, 1), n(3, 1),
      n(4, 1), n(2, 1),
      n(3, 1), n(1, 1),
      n(2, 2),
      n(3, 1), n(4, 1),
      n(5, 1), n(3, 1),
      n(2, 1), n(3, 1),
      n(1, 2),
    ],
  },
  {
    id: 'two-four-run',
    name: 'Two-four run',
    difficulty: 'easy',
    metres: [[2, 4]],
    bars: 8,
    /* Quavers in pairs, and one bar that stops so the metre can be counted. */
    events: [
      n(1, 0.5), n(2, 0.5), n(3, 1),
      n(4, 0.5), n(3, 0.5), n(2, 1),
      n(3, 0.5), n(4, 0.5), n(5, 1),
      n(4, 1), r(1),
      n(3, 0.5), n(4, 0.5), n(5, 1),
      n(6, 0.5), n(5, 0.5), n(4, 1),
      n(3, 0.5), n(2, 0.5), n(3, 1),
      n(1, 2),
    ],
  },
  {
    id: 'held-over',
    name: 'Held over',
    difficulty: 'easy',
    metres: [[2, 4]],
    bars: 8,
    /* A whole bar held across the bar line, which in two-four is a long wait. */
    events: [
      n(3, 1), n(2, 1),
      n(1, 0.5), n(2, 0.5), n(3, 1),
      n(4, 0.5), n(5, 0.5), n(4, 1),
      n(3, 2, { tied: true }),
      n(3, 1), n(4, 1),
      n(5, 0.5), n(4, 0.5), n(3, 1),
      n(2, 0.5), n(1, 0.5), n(2, 1),
      n(1, 2),
    ],
  },
  {
    id: 'off-the-beat',
    name: 'Off the beat',
    difficulty: 'medium',
    metres: [[2, 4]],
    bars: 8,
    /*
     * The syncopation this metre is for: quaver, crotchet, quaver, so the
     * middle note starts off the beat and holds across beat two. Every bar but
     * the cadence does it, which is the only way to stop a reader treating the
     * first one as a misprint.
     */
    events: [
      n(1, 0.5), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(5, 1), n(4, 0.5),
      n(3, 0.5), n(5, 1), n(4, 0.5),
      n(3, 1.5), n(2, 0.5),
      n(5, 0.5), n(4, 1), n(3, 0.5),
      n(2, 0.5), n(4, 1), n(3, 0.5),
      n(1, 0.5), n(3, 1), n(2, 0.5),
      n(1, 2),
    ],
  },
  {
    id: 'march-trio',
    name: 'March trio',
    difficulty: 'medium',
    metres: [[2, 4]],
    bars: 8,
    /* Syncopation again, and a whole bar held over into the answering phrase. */
    events: [
      n(5, 0.5), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(3, 1), n(5, 0.5),
      n(4, 0.5), n(6, 1), n(5, 0.5),
      n(4, 2, { tied: true }),
      n(4, 0.5), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(5, 1), n(4, 0.5),
      n(3, 0.5), n(2, 1), n(3, 0.5),
      n(1, 2),
    ],
  },
  {
    id: 'street-corner',
    name: 'Street corner',
    difficulty: 'hard',
    metres: [[2, 4]],
    bars: 8,
    /* Semiquavers into the syncopation, and an octave where the bar turns. */
    events: [
      n(1, 0.25), n(2, 0.25), n(3, 0.5), n(5, 1),
      n(4, 0.5), n(3, 0.25), n(2, 0.25), n(1, 1),
      n(1, 0.5), n(1, 0.5, { octave: 1 }), n(7, 1),
      n(6, 0.25), n(5, 0.25), n(4, 0.5), n(3, 1),
      n(3, 0.5), n(4, 0.5, { alter: 1 }), n(5, 1),
      n(5, 0.25), n(6, 0.25), n(5, 0.25), n(4, 0.25), n(3, 1),
      n(2, 0.5), n(4, 1), n(3, 0.5),
      n(1, 2),
    ],
  },
  {
    id: 'double-quick',
    name: 'Double quick',
    difficulty: 'expert',
    metres: [[2, 4]],
    bars: 8,
    /* Two-four at speed: a tenth in bar two, and nowhere to breathe. */
    events: [
      n(1, 0.25), n(2, 0.25), n(3, 0.25), n(4, 0.25), n(5, 0.5), n(3, 0.5),
      n(1, 0.5), n(3, 0.5, { octave: 1 }), n(2, 0.5, { octave: 1 }),
      n(1, 0.5, { octave: 1 }),
      n(7, 0.25), n(6, 0.25), n(5, 0.25), n(4, 0.25), n(3, 0.5), n(2, 0.5),
      n(3, 0.5), n(4, 0.5, { alter: 1 }), n(5, 1),
      n(5, 0.25), n(6, 0.25), n(7, 0.25), n(1, 0.25, { octave: 1 }),
      n(7, 0.5), n(5, 0.5),
      n(6, 0.5, { alter: -1 }), n(5, 0.5), n(4, 0.5), n(3, 0.5),
      n(2, 0.25), n(3, 0.25), n(4, 0.25), n(5, 0.25), n(3, 0.5), n(2, 0.5),
      n(1, 2),
    ],
  },
];

/*
 * Syncopation in four-four, which the corpus was short of from Medium up.
 *
 * A note that starts off the beat and holds through the next one is read wrong
 * far more often than a wide leap is, and no amount of stepwise practice
 * prepares anyone for it.
 */
const SYNCOPATED: readonly Theme[] = [
  {
    id: 'against-the-beat',
    name: 'Against the beat',
    difficulty: 'medium',
    metres: [[4, 4]],
    bars: 8,
    events: [
      n(1, 0.5), n(5, 1), n(4, 1), n(3, 1), n(2, 0.5),
      n(3, 0.5), n(5, 1), n(4, 1), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(3, 1), n(5, 1), n(4, 1), n(3, 0.5),
      n(2, 1.5), n(1, 0.5), n(2, 2),
      n(3, 0.5), n(5, 1), n(4, 1), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(2, 1), n(3, 1), n(4, 1), n(5, 0.5),
      n(4, 0.5), n(3, 1), n(2, 1), n(3, 1), n(2, 0.5),
      n(1, 4),
    ],
  },
  {
    id: 'pushed-along',
    name: 'Pushed along',
    difficulty: 'hard',
    metres: [[4, 4]],
    bars: 8,
    events: [
      n(5, 0.5), n(4, 1), n(3, 1), n(2, 1), n(1, 0.5),
      n(1, 0.25), n(2, 0.25), n(3, 0.5), n(5, 1), n(4, 1), n(3, 1),
      n(2, 0.5), n(4, 1), n(3, 1), n(5, 1), n(4, 0.5),
      n(3, 0.5), n(1, 1, { octave: 1 }), n(7, 1), n(6, 1), n(5, 0.5),
      n(4, 0.25), n(3, 0.25), n(2, 0.5), n(3, 1), n(4, 1), n(5, 1),
      n(6, 0.5), n(5, 1), n(4, 1), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(3, 1), n(2, 1), n(3, 1), n(2, 0.5),
      n(1, 4),
    ],
  },
];


/*
 * Three-four, which had one theme in it and four difficulties falling back.
 *
 * A bar of three has no half to divide at, so a syncopation in it leans
 * differently from one in two or four: the off-beat note has two beats to run
 * through rather than one, and there is no midpoint for the ear to check
 * itself against.
 */
const THREE_FOUR: readonly Theme[] = [
  {
    id: 'slow-waltz',
    name: 'Slow waltz',
    difficulty: 'beginner',
    metres: [[3, 4]],
    bars: 8,
    events: [
      n(1, 1), n(2, 1), n(3, 1),
      n(2, 1), n(3, 1), n(4, 1),
      n(3, 1), n(4, 1), n(5, 1),
      n(4, 2), n(3, 1),
      n(5, 1), n(4, 1), n(3, 1),
      n(2, 1), n(3, 1), n(4, 1),
      n(3, 1), n(2, 1), n(1, 1),
      n(1, 3),
    ],
  },
  {
    id: 'three-against',
    name: 'Three against',
    difficulty: 'medium',
    metres: [[3, 4]],
    bars: 8,
    /* The off-beat note runs through two beats, which is the whole difference. */
    events: [
      n(1, 0.5), n(5, 1), n(4, 1), n(3, 0.5),
      n(2, 0.5), n(4, 1), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(3, 1), n(5, 1), n(4, 0.5),
      n(3, 1.5), n(2, 0.5), n(1, 1),
      n(5, 0.5), n(4, 1), n(3, 1), n(2, 0.5),
      n(1, 0.5), n(3, 1), n(2, 1), n(3, 0.5),
      n(4, 0.5), n(3, 1), n(2, 1), n(1, 0.5),
      n(1, 3),
    ],
  },
  {
    id: 'waltz-run',
    name: 'Waltz run',
    difficulty: 'hard',
    metres: [[3, 4]],
    bars: 8,
    events: [
      n(1, 0.25), n(2, 0.25), n(3, 0.5), n(5, 1), n(4, 1),
      n(3, 0.25), n(4, 0.25), n(5, 0.5), n(4, 1), n(3, 1),
      n(1, 0.5), n(1, 0.5, { octave: 1 }), n(7, 1), n(6, 1),
      n(5, 0.5), n(4, 0.5), n(3, 1), n(2, 1),
      n(3, 0.5), n(4, 0.5, { alter: 1 }), n(5, 1), n(3, 1),
      n(2, 0.25), n(3, 0.25), n(4, 0.5), n(5, 1), n(4, 1),
      n(3, 0.5), n(2, 1), n(3, 1), n(2, 0.5),
      n(1, 3),
    ],
  },
  {
    id: 'perpetual-three',
    name: 'Perpetual three',
    difficulty: 'expert',
    metres: [[3, 4]],
    bars: 8,
    events: [
      n(1, 0.25), n(2, 0.25), n(3, 0.25), n(4, 0.25), n(5, 0.5), n(3, 0.5), n(2, 1),
      n(1, 0.5), n(3, 0.5, { octave: 1 }), n(2, 0.5, { octave: 1 }),
      n(1, 0.5, { octave: 1 }), n(7, 1),
      n(6, 0.25), n(5, 0.25), n(4, 0.25), n(3, 0.25), n(2, 0.5), n(3, 0.5), n(4, 1),
      n(5, 0.5), n(4, 0.5, { alter: 1 }), n(5, 0.5), n(6, 0.5), n(5, 1),
      n(5, 0.25), n(4, 0.25), n(3, 0.25), n(2, 0.25), n(3, 0.5), n(4, 0.5), n(5, 1),
      n(6, 0.5, { alter: -1 }), n(5, 0.5), n(4, 0.5), n(3, 0.5), n(2, 1),
      n(1, 0.25), n(2, 0.25), n(3, 0.25), n(4, 0.25), n(5, 0.5), n(3, 0.5), n(2, 1),
      n(1, 3),
    ],
  },
];


/*
 * Triplets, now that the notation exists to draw them.
 *
 * Where they are legal falls out of the rhythm ladder rather than being decided
 * separately: a difficulty may not go shorter than its own shortest note, so a
 * triplet crotchet at two thirds of a beat is legal from Easy up, and a triplet
 * quaver at one third only from Hard, where semiquavers already are. That
 * gradient happens to be about right — the crotchet triplet is the one a player
 * meets first, in hymn tunes, and the quaver triplet is a different animal at
 * speed.
 */
const TRIPLETS: readonly Theme[] = [
  {
    id: 'three-for-two',
    name: 'Three for two',
    difficulty: 'medium',
    metres: [[4, 4]],
    bars: 8,
    /*
     * Crotchet triplets against plain crotchets, which is the whole lesson:
     * three notes where two would go, and the two that follow proving it. Every
     * bar does it so a reader stops treating the first one as a misprint.
     */
    events: [
      n(1, 2 / 3), n(2, 2 / 3), n(3, 2 / 3), n(2, 1), n(1, 1),
      n(3, 2 / 3), n(4, 2 / 3), n(5, 2 / 3), n(4, 1), n(3, 1),
      n(5, 2 / 3), n(4, 2 / 3), n(3, 2 / 3), n(2, 1), n(3, 1),
      n(2, 2), n(1, 2),
      n(5, 2 / 3), n(3, 2 / 3), n(1, 2 / 3), n(2, 1), n(3, 1),
      n(4, 2 / 3), n(5, 2 / 3), n(6, 2 / 3), n(5, 1), n(4, 1),
      n(3, 2 / 3), n(2, 2 / 3), n(1, 2 / 3), n(2, 1), n(3, 1),
      n(1, 4),
    ],
  },
  {
    id: 'triplet-run',
    name: 'Triplet run',
    difficulty: 'hard',
    metres: [[4, 4]],
    bars: 8,
    /* Quaver triplets by the beat, beamed and bracketed in threes. */
    events: [
      n(1, 1 / 3), n(2, 1 / 3), n(3, 1 / 3), n(4, 1 / 3), n(3, 1 / 3), n(2, 1 / 3),
      n(3, 1), n(5, 1),
      n(4, 1 / 3), n(3, 1 / 3), n(2, 1 / 3), n(1, 1), n(3, 1), n(5, 1),
      n(5, 1 / 3), n(6, 1 / 3), n(7, 1 / 3), n(1, 1 / 3, { octave: 1 }),
      n(7, 1 / 3), n(6, 1 / 3), n(5, 1), n(3, 1),
      n(2, 1 / 3), n(3, 1 / 3), n(4, 1 / 3), n(3, 1), n(2, 1), n(1, 1),
      n(1, 1 / 3), n(3, 1 / 3), n(5, 1 / 3), n(3, 1 / 3), n(1, 1 / 3), n(2, 1 / 3),
      n(3, 1), n(4, 1),
      n(5, 1 / 3), n(4, 1 / 3), n(3, 1 / 3), n(2, 1), n(3, 1), n(1, 1),
      n(1, 1 / 3), n(2, 1 / 3), n(3, 1 / 3), n(4, 1 / 3), n(5, 1 / 3), n(4, 1 / 3),
      n(3, 1), n(2, 1),
      n(1, 4),
    ],
  },
  {
    id: 'twos-and-threes',
    name: 'Twos and threes',
    difficulty: 'expert',
    metres: [[4, 4]],
    bars: 8,
    /*
     * The hard part is not the triplet but the change: a beat of semiquavers
     * against a beat of triplets, so the division of the beat moves under the
     * reader from four to three and back.
     */
    events: [
      n(1, 0.25), n(2, 0.25), n(3, 0.25), n(4, 0.25),
      n(5, 1 / 3), n(4, 1 / 3), n(3, 1 / 3), n(2, 1), n(1, 1),
      n(1, 1 / 3), n(3, 1 / 3), n(5, 1 / 3), n(1, 1 / 3, { octave: 1 }),
      n(7, 1 / 3), n(5, 1 / 3), n(4, 0.5), n(3, 0.5), n(2, 1),
      n(3, 1 / 3), n(4, 1 / 3), n(5, 1 / 3), n(6, 1 / 3), n(5, 1 / 3), n(4, 1 / 3),
      n(3, 1), n(1, 1),
      n(1, 0.5), n(3, 0.5, { octave: 1 }), n(2, 1 / 3, { octave: 1 }),
      n(1, 1 / 3, { octave: 1 }), n(7, 1 / 3), n(6, 0.5), n(5, 0.5), n(4, 1),
      n(3, 1 / 3), n(2, 1 / 3), n(1, 1 / 3), n(2, 1 / 3), n(3, 1 / 3), n(4, 1 / 3),
      n(5, 1), n(3, 1),
      n(4, 0.25), n(3, 0.25), n(2, 0.25), n(1, 0.25),
      n(2, 1 / 3), n(3, 1 / 3), n(4, 1 / 3), n(5, 1), n(4, 1),
      n(3, 1 / 3), n(4, 1 / 3), n(5, 1 / 3), n(4, 1 / 3), n(3, 1 / 3), n(2, 1 / 3),
      n(3, 1), n(2, 1),
      n(1, 4),
    ],
  },
];


/*
 * More triplets, spread across the metres rather than piled into four-four.
 *
 * A triplet reads differently depending on how much bar is left around it: two
 * beats of a three-four bar leaves one, which is a very different sensation
 * from two beats of a four-four bar leaving two, and a beat of triplets in
 * two-four is half the bar gone at once.
 */
const MORE_TRIPLETS: readonly Theme[] = [
  {
    id: 'hymn-triplets',
    name: 'Hymn triplets',
    difficulty: 'easy',
    metres: [[4, 4]],
    bars: 8,
    /*
     * Where a player actually meets their first triplet: a hymn tune, moving
     * by step, three notes taking the time of two and nothing else going on to
     * distract from that.
     */
    events: [
      n(1, 2 / 3), n(2, 2 / 3), n(3, 2 / 3), n(2, 1), n(1, 1),
      n(2, 2 / 3), n(3, 2 / 3), n(4, 2 / 3), n(3, 1), n(2, 1),
      n(3, 2 / 3), n(4, 2 / 3), n(5, 2 / 3), n(4, 2),
      n(3, 2), n(2, 2),
      n(3, 2 / 3), n(2, 2 / 3), n(1, 2 / 3), n(2, 1), n(3, 1),
      n(4, 2 / 3), n(3, 2 / 3), n(2, 2 / 3), n(3, 1), n(4, 1),
      n(5, 2 / 3), n(4, 2 / 3), n(3, 2 / 3), n(2, 1), n(1, 1),
      n(1, 4),
    ],
  },
  {
    id: 'waltz-triplets',
    name: 'Waltz triplets',
    difficulty: 'medium',
    metres: [[3, 4]],
    bars: 8,
    /* Two beats of triplet against one plain beat — the bar has no half to
     * check against, so the third beat is the only thing telling you where you
     * are. */
    events: [
      n(1, 2 / 3), n(2, 2 / 3), n(3, 2 / 3), n(5, 1),
      n(4, 2 / 3), n(3, 2 / 3), n(2, 2 / 3), n(1, 1),
      n(3, 2 / 3), n(4, 2 / 3), n(5, 2 / 3), n(4, 1),
      n(3, 2), n(2, 1),
      n(1, 2 / 3), n(5, 2 / 3), n(3, 2 / 3), n(4, 1),
      n(3, 2 / 3), n(2, 2 / 3), n(1, 2 / 3), n(2, 1),
      n(3, 2 / 3), n(4, 2 / 3), n(5, 2 / 3), n(2, 1),
      n(1, 3),
    ],
  },
  {
    id: 'quickstep-triplets',
    name: 'Quickstep triplets',
    difficulty: 'hard',
    metres: [[2, 4]],
    bars: 8,
    /* A beat of triplets is half a two-four bar, so the bar is gone before the
     * reader has finished counting it. */
    events: [
      n(1, 1 / 3), n(2, 1 / 3), n(3, 1 / 3), n(5, 1),
      n(4, 1 / 3), n(3, 1 / 3), n(2, 1 / 3), n(1, 1),
      n(3, 1 / 3), n(4, 1 / 3), n(5, 1 / 3), n(6, 1 / 3), n(5, 1 / 3), n(4, 1 / 3),
      n(3, 1), n(5, 1),
      n(1, 1 / 3), n(3, 1 / 3), n(5, 1 / 3), n(1, 1, { octave: 1 }),
      n(7, 1 / 3), n(6, 1 / 3), n(5, 1 / 3), n(4, 1),
      n(3, 1 / 3), n(2, 1 / 3), n(1, 1 / 3), n(2, 1),
      n(1, 2),
    ],
  },
  {
    id: 'perpetual-triplets',
    name: 'Perpetual triplets',
    difficulty: 'expert',
    metres: [[3, 4]],
    bars: 8,
    /*
     * Nine triplet quavers to a bar and almost nothing else, so there is no
     * plain beat to re-anchor against — and two bars where semiquavers cut
     * across them, which is the moment the division of the beat changes under
     * the reader.
     */
    events: [
      n(1, 1 / 3), n(2, 1 / 3), n(3, 1 / 3), n(4, 1 / 3), n(5, 1 / 3), n(4, 1 / 3),
      n(3, 1 / 3), n(2, 1 / 3), n(1, 1 / 3),
      n(1, 1 / 3), n(3, 1 / 3, { octave: 1 }), n(2, 1 / 3, { octave: 1 }),
      n(1, 1 / 3, { octave: 1 }), n(7, 1 / 3), n(6, 1 / 3),
      n(5, 1 / 3), n(4, 1 / 3), n(3, 1 / 3),
      n(2, 0.25), n(3, 0.25), n(4, 0.25), n(5, 0.25),
      n(4, 1 / 3), n(3, 1 / 3), n(2, 1 / 3), n(3, 0.5), n(2, 0.5),
      n(1, 1 / 3), n(2, 1 / 3), n(3, 1 / 3), n(4, 1 / 3), n(5, 1 / 3), n(6, 1 / 3),
      n(5, 1),
      n(4, 1 / 3), n(3, 1 / 3), n(2, 1 / 3), n(3, 1 / 3), n(4, 1 / 3), n(5, 1 / 3),
      n(4, 1),
      n(3, 0.25), n(4, 0.25), n(5, 0.25), n(6, 0.25),
      n(5, 1 / 3), n(4, 1 / 3), n(3, 1 / 3), n(2, 1),
      n(1, 1 / 3), n(3, 1 / 3), n(5, 1 / 3), n(3, 1 / 3), n(1, 1 / 3), n(2, 1 / 3),
      n(3, 1),
      n(1, 3),
    ],
  },
];

export const THEMES: readonly Theme[] = [
  ...FIRST_BATCH,
  ...HARDER,
  ...VARIATIONS,
  ...FIGURED,
  ...TWO_FOUR,
  ...SYNCOPATED,
  ...THREE_FOUR,
  ...TRIPLETS,
  ...MORE_TRIPLETS,
];

export function themeById(id: string): Theme | undefined {
  return THEMES.find((theme) => theme.id === id);
}
