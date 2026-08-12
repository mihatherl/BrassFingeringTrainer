// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { barAt, barCount, metreAt } from '../domain/metre';
import { formatPitch } from '../domain/pitch';
import type { Exercise } from '../exercise/types';
import { readScoreFile } from './container';
import { parseMusicXml, partNames } from './musicxml';
import { importPart, type Divisi } from './part';

/**
 * The whole importer, on a file a program actually wrote.
 *
 * Every other test in `import/` builds its MusicXML by hand, which is the right
 * way to test a rule: the document is as small as the case and says exactly
 * what is being asked. But hand-written documents share a blind spot — **they
 * only ever contain the cases somebody had already thought of.** One real
 * MuseScore export found six faults in an importer whose synthetic suite was
 * passing throughout: `<forward>` ignored so two bars came out six beats short,
 * a demisemiquaver dropped, a metre change never drawn, unreached bars never
 * reported, a picker filter that hid the file, and a tied note falling silent.
 *
 * So this one file is committed and read from disk, bytes first, through every
 * stage the app puts it through: unzip, parse, unfold, read, assemble. It is
 * the only test here that would notice a fault living *between* two stages.
 *
 * **The fixture is a MuseScore 3.6.2 export** — `<work-title>Title</work-title>`
 * and `<creator>Composer</creator>`, its placeholder metadata untouched — kept
 * deliberately small and deliberately awkward: 42 written bars holding a segno,
 * a to-coda, a D.S., first- and second-time bars, three nested repeats, two
 * bars written as bare `<forward>`, four key changes, a change of time
 * signature, a chord, and a demisemiquaver. Nothing here is a real piece of
 * music and it is not meant to be.
 *
 * The expected figures below were read off the file rather than off the
 * importer — the measure durations were totalled independently, in a throwaway
 * script, against `<divisions>` and the time signature in force. A test that
 * records whatever the code currently prints would pass just as happily with
 * the bugs above still in it.
 */

/** Read from disk as bytes, because the unzipping is part of what is under test. */
const FIXTURE = 'src/import/__fixtures__/musescore-export.mxl';

/** Written bars in the file, counted from the `<measure>` elements. */
const WRITTEN_BARS = 42;

/**
 * Bars once the repeats are unfolded.
 *
 * Longer than the printed part because that is what unfolding *is*; see the
 * ruling in `docs/musicxml-import-plan.md`. Reads as a strange number until you
 * count the file's structure: nothing here repeats tidily.
 */
const PLAYED_BARS = 61;

/** Ticks per crotchet, from `<divisions>`. Every duration below is a multiple. */
const DIVISIONS = 8;

async function importFixture(divisi?: Divisi): Promise<{
  exercise: Exercise;
  problems: string[];
  names: string[];
}> {
  const bytes = readFileSync(FIXTURE);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const opened = await readScoreFile(buffer as ArrayBuffer);
  if ('problem' in opened) throw new Error(`the fixture would not open: ${opened.problem}`);

  const parsed = parseMusicXml(opened.xml);
  if ('problem' in parsed) throw new Error(`the fixture would not parse: ${parsed.problem}`);

  const { exercise, problems } = importPart(parsed.doc, {
    instrument: instrumentById('eb-bass'),
    divisi,
  });
  if (!exercise) throw new Error('the fixture imported to nothing');
  return { exercise, problems, names: partNames(parsed.doc) };
}

/** A note as `E4@0`: what is read, and where it falls. Checkable against the page. */
function reading(exercise: Exercise, from: number, count: number): string {
  return exercise.notes
    .slice(from, from + count)
    .map((note) => `${formatPitch(note.pitch)}@${note.startBeat}`)
    .join(' ');
}

describe('a real MuseScore export, end to end', () => {
  let exercise: Exercise;
  let problems: string[];
  let names: string[];

  beforeAll(async () => {
    ({ exercise, problems, names } = await importFixture());
  });

  it('opens, parses and imports from the bytes on disk', () => {
    expect(names).toEqual(['Piano']);
    expect(exercise.notes.length).toBeGreaterThan(0);
  });

  it('reports the divided notes and nothing else', () => {
    /*
     * The one thing this file asks that cannot be honoured in full: it holds a
     * chord, and a chord on a single-line instrument gives up everything but
     * its top note. Countable and located, per the rule every warning here
     * obeys — and the *only* warning, which is the substance of this
     * assertion. A second one appearing means the importer has started
     * failing at something it currently manages.
     */
    expect(problems).toEqual(['9 divided notes read on the upper line']);
  });

  it('reads the opening bars exactly as they are printed', () => {
    /*
     * Bars 1-3, totalled by hand from the file: three crotchets and a crotchet
     * rest; four crotchets; then a quaver, a quaver rest, a crotchet rest and a
     * minim. Written out in full because this is the assertion that would
     * catch a wrong `<divisions>` conversion, and a wrong conversion is
     * invisible in any figure that only counts things.
     */
    expect(reading(exercise, 0, 8)).toBe('E4@0 G4@1 B4@2 F4@4 F4@5 E5@6 E5@7 E5@8');
    expect(exercise.rests.slice(0, 3)).toEqual([
      { startBeat: 3, duration: { value: 'quarter', dotted: false } },
      { startBeat: 8.5, duration: { value: 'eighth', dotted: false } },
      { startBeat: 9, duration: { value: 'quarter', dotted: false } },
    ]);
  });

  it('keeps the demisemiquaver, and puts it where it belongs', () => {
    /*
     * v1.44.0. Bar 4 opens with a 32nd — one tick where `<divisions>` is 8 —
     * and the three rests that fill out its beat are each a different value.
     * The note being present is half the assertion; the other half is that
     * everything after it sits an eighth of a crotchet later, which is what
     * dropping it silently would break.
     */
    const demisemiquaver = exercise.notes.find(
      (note) => note.duration.value === 'thirtySecond',
    );
    expect(demisemiquaver).toBeDefined();
    expect(demisemiquaver?.startBeat).toBe(12);
    expect(exercise.rests.filter((rest) => rest.startBeat > 12 && rest.startBeat < 13)).toEqual([
      { startBeat: 12.125, duration: { value: 'thirtySecond', dotted: false } },
      { startBeat: 12.25, duration: { value: 'sixteenth', dotted: false } },
      { startBeat: 12.5, duration: { value: 'eighth', dotted: false } },
    ]);
  });

  it('changes time signature where the file changes it', () => {
    /*
     * v1.43.0. The file turns from 4/4 into 3/4 at written bar 5, which is beat
     * 16 — four bars of four. Asserted as a beat *and* as a bar, because the
     * two only agree while the metre has not changed, and it has.
     */
    expect(exercise.metres.map((change) => change.fromBeat)).toEqual([0, 16]);
    expect(metreAt(exercise.metres, 0).beatsPerBar).toBe(4);
    expect(metreAt(exercise.metres, 16).beatsPerBar).toBe(3);
    expect(barAt(exercise.metres, 16)).toBe(4);
  });

  it('changes key where the file changes it', () => {
    expect(exercise.keys).toEqual([
      { fromBeat: 0, fifths: 0 },
      { fromBeat: 12, fifths: 2 },
      { fromBeat: 52, fifths: -1 },
      { fromBeat: 181, fifths: -2 },
    ]);
  });

  it('gives a bar written as a bare forward its full length', () => {
    /*
     * v1.43.1, and the fault that makes this whole file worth committing. Two
     * of its bars hold no notes at all — just `<forward>` for 24 ticks, three
     * crotchets, a whole 3/4 bar each. Ignoring them cost exactly the six beats
     * this arithmetic would have caught.
     *
     * Stated as a property rather than as a figure: the part ends on a bar
     * line. A bar swallowed anywhere in it leaves the total short of a whole
     * number of bars, wherever it was lost.
     */
    const bars = barCount(exercise.metres, exercise.totalBeats);
    expect(bars).toBe(PLAYED_BARS);
    expect(exercise.totalBeats).toBe(16 + (PLAYED_BARS - 4) * 3);
  });

  it('unfolds the navigation, reaching every bar', () => {
    /*
     * A segno, a to-coda, a D.S., first- and second-time bars and three nested
     * repeats — resolved to a flat run longer than the printed part. That no
     * bar is left unreached is asserted through `problems` above: an unreached
     * stretch is reported there, and there is nothing there but the divisi.
     */
    expect(barCount(exercise.metres, exercise.totalBeats)).toBeGreaterThan(WRITTEN_BARS);
    expect(barCount(exercise.metres, exercise.totalBeats)).toBe(PLAYED_BARS);
  });

  it('reads the lower line when the player asks for it', async () => {
    /*
     * The file's chord is B3 under B4. Upper takes the top note; lower takes
     * the one underneath — the same bar, the same beat, a different octave, and
     * on a tuba the same three valves. The ruling is in `part.ts`; this is the
     * only test of it against a chord a notation program wrote.
     */
    const upper = exercise.notes.find((note) => note.startBeat === 16);
    expect(upper && formatPitch(upper.pitch)).toBe('B4');

    const lower = await importFixture('lower');
    const taken = lower.exercise.notes.find((note) => note.startBeat === 16);
    expect(taken && formatPitch(taken.pitch)).toBe('B3');
    expect(lower.problems).toEqual(['9 divided notes read on the lower line']);
  });

  it('resolves every duration onto the tick grid the file declares', () => {
    /*
     * Nothing may land between two ticks. A rounding fault in the divisions
     * conversion shows up here as a fraction and nowhere else until the notes
     * are on a stave and a bar is visibly a hair too long.
     */
    const tick = 1 / DIVISIONS;
    for (const note of exercise.notes) {
      const ticks = note.startBeat / tick;
      expect(Math.abs(ticks - Math.round(ticks))).toBeLessThan(1e-9);
    }
  });
});
