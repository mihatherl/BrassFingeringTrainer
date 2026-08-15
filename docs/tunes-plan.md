# Tunes from cells — the plan

Agreed with the player on 2026-08-16, after measuring the theme corpus
against the sight-reading generator and finding it a level or two easy at
every level (see *The measurement*). The choice was between hand-writing
hundreds of tunes and building a composer; the player chose the composer,
and ruled that **Sight-reading stays** — a walk held inside a stated interval
trains something a tune does not.

## What Themes becomes

**Tunes assembled from authored cells, calibrated to the difficulty, new every
time.** A cell is one bar of music written in diatonic steps from an anchor,
with a role — it opens a phrase, carries one on, or closes one — and the
level it first belongs to. The composer lays cells into two four-bar phrases,
an antecedent closing on the dominant or mediant and a consequent closing on
the tonic, choosing anchors so that the joins step and the tune uses the
range its level allows; sequences the opener where it can, so a tune has a
motif; and then inflects the diatonic line with the accidentals and rests the
level asks for. Everything after that is what already existed: the composed
tune is a `Theme`, and `realiseTheme` and `stitchThemes` place it, tour the
keys across tunes, tie across bar lines, snap the triplets and mark the
joins for the tempo plan exactly as they did for the hand-written corpus.

The hand-written corpus goes. Its forty-seven tunes are in the history and
were never wrong as music, only as levels; keeping them beside a composer
that makes better-calibrated ones by the thousand would be two answers to
one question.

## The measurement

E flat bass, treble clef, E flat major; sixteen bars of sight-reading against
the mean of the corpus at the same level:

| level | range, semitones | accidentals per note | rests per bar |
|---|---|---|---|
| Beginner — reading / themes | 12 / 7 | 0% / 0% | 0 / 0 |
| Easy — reading / themes | 15 / 8 | 5% / 0.3% | 0.17 / 0.08 |
| Medium — reading / themes | 19 / 8.5 | 16% / 0.3% | 0.31 / 0.02 |
| Hard — reading / themes | 25 / 14 | 26% / 3% | 0.48 / 0.01 |

Rhythmic density and leap sizes were comparable. **Range, accidentals and
rests** are the three axes the composer is held to; the same script that made
this table is the acceptance test, run against composed tunes.

## Calibration, axis by axis

- **Range.** The level's `rangeSemitones` is the width of the pool the walk
  draws from and reaches most of; a tune should reach about four fifths of it.
  The composer steers anchors towards the unreached end of a target span and
  refuses an anchor that would overshoot, so a Medium tune spans about an
  octave and a half rather than an octave.
- **Accidentals.** Applied *after* the diatonic line is composed, as musical
  inflections rather than random substitutions: a lower neighbour a tone
  below its note is raised, an upper neighbour or descending passing note a
  tone above is lowered. Each eligible note takes its inflection with the
  level's `accidentalChance`, so Beginner takes none. Spelling is the key's
  own, through `spellInKey`.
- **Rests.** A cell may be written with one, and the composer breathes at the
  level's `restChance` by resting the last note of a continuing cell where it
  is short and off the beat. Closes keep their last note.
- **Rhythm.** A cell carries the level it belongs to, and a tune uses cells at
  or below its level — the same rule `validateTheme` already states as a
  ceiling on the shortest note.
- **Leaps.** Inside a cell, whatever its author wrote within the tenth the
  validator allows; at a join, the interval from a cell's last note to the
  next cell's first is held to the level: a third at Beginner, up to a sixth
  at Hard.
- **Ties** stay with the cells that write them, and are otherwise left for a
  later stage; the walk's `tieChance` is not yet honoured by tunes.

## Stages

1. ~~**The composer, in every metre the picker offers**~~ — built, v2.20.0.
   `compose.ts` and `cells.ts`; a hundred and forty cells across 4/4, 3/4,
   2/4 and 6/8; the old corpus, its page and its tools retired; `npm run
   tunes` writes a sheet of composed tunes to look at. Measured after the
   build (E flat bass, forty tunes a level in 4/4): range 10.6 / 13.2 / 17.3
   / 21.4 against the walk's 11.6 / 15.1 / 19.2 / 24.9; accidentals 0 / 7.5 /
   9.6 / 15.5% against 0 / 5.4 / 15.7 / 26.1%; rests per bar 0 / 0.22 / 0.32
   / 0.43 against 0 / 0.17 / 0.31 / 0.48. `compose.test` holds those as an
   acceptance test. **What is still short**: accidentals at Medium and Hard
   sit at about six tenths of the walk's rate — the ceiling is how many notes
   of a tune are neighbours, passing notes or repeats, since every eligible
   one is already inflected at Hard — and range runs three to four semitones
   under a walk twice the length. Both are corpus work for stage 3: cells
   with more chromatic-friendly shapes, and wider ones.

   Two things learned building it. An altered theme degree must be spelled
   on its own letter — `realiseTheme` now does — or a raised sixth in a flat
   key comes out as D flat before D natural. And no open or move may be one
   held note: a sequence of it drags a whole tune's median under the level's
   pace, which the validator rightly refuses.
2. **Motivic work**: sequences by more than a step, inversion, the consequent
   answering the antecedent's rhythm; ties at the level's chance.
3. **A larger corpus**, written against the tune sheet, level by level.

## What is not changing

The Themes kind, its id, its length in whole tunes, key tours across tunes,
the tempo plan's use of the joins, the results screen — every reader of a
`Theme` — and the two other materials, which are right as they are.
