// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { barAt, barCount, beatOfBar, changesMetre } from '../domain/metre';
import { changesKey } from '../domain/keys';
import { formatPitch } from '../domain/pitch';
import { parseMusicXml } from './musicxml';
import { importPart } from './part';

/**
 * Reading a part into an exercise.
 *
 * The documents are written by hand and are as small as the case allows. What
 * is being checked is the reading and the substitution rules — whether the
 * order of measures is right is `unfold.test.ts`'s job, and whether the result
 * is beamed correctly is `assemble`'s, since an imported part goes through the
 * same assembler the generator does.
 */

const EB_BASS = instrumentById('eb-bass');

/** Twenty-four ticks to a crotchet, which divides by two, three and four. */
const DIVISIONS = 24;

function attributes(extra = ''): string {
  return `<attributes>
    <divisions>${DIVISIONS}</divisions>
    <key><fifths>0</fifths></key>
    <time><beats>4</beats><beat-type>4</beat-type></time>
    <clef><sign>G</sign><line>2</line></clef>
    ${extra}
  </attributes>`;
}

/** A note of `beats` crotchets, or a rest when the pitch is null. */
function note(pitch: string | null, beats: number, extra = ''): string {
  const ticks = Math.round(beats * DIVISIONS);
  if (pitch === null) return `<note><rest/><duration>${ticks}</duration></note>`;
  const [letter, octave] = [pitch[0], pitch[pitch.length - 1]];
  const alter = pitch.includes('#') ? 1 : pitch.includes('b') ? -1 : 0;
  return `<note>
    <pitch><step>${letter}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>
    <duration>${ticks}</duration>
    ${extra}
  </note>`;
}

function score(...measures: string[]): string {
  const bars = measures
    .map((body, i) => `<measure number="${i + 1}">${i === 0 ? attributes() : ''}${body}</measure>`)
    .join('');
  return `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Eb Bass</part-name></score-part></part-list>
    <part id="P1">${bars}</part>
  </score-partwise>`;
}

function importing(xml: string) {
  const parsed = parseMusicXml(xml);
  if ('problem' in parsed) throw new Error(parsed.problem);
  return importPart(parsed.doc, { instrument: EB_BASS });
}

/** The written pitches, as a player would name them. */
function readsAs(xml: string): string[] {
  const { exercise } = importing(xml);
  return (exercise?.notes ?? []).map((n) => formatPitch(n.pitch));
}

describe('reading the notes', () => {
  it('reads pitch, and spells it as the part does', () => {
    // The publisher wrote G flat. Re-deriving the spelling from the key would
    // be the app overruling the page, and in C it would come back as F sharp.
    expect(readsAs(score(note('Gb4', 1) + note('F#4', 1) + note('C4', 2)))).toEqual([
      'Gb4',
      'F#4',
      'C4',
    ]);
  });

  it('measures durations in divisions, so a crotchet is a beat', () => {
    const { exercise } = importing(score(note('C4', 1) + note('D4', 0.5) + note('E4', 0.5) + note('F4', 2)));
    expect(exercise?.notes.map((n) => n.startBeat)).toEqual([0, 1, 1.5, 2]);
    expect(exercise?.totalBeats).toBe(4);
  });

  it('writes a length no single value says as tied notes, not as silence', () => {
    /*
     * Two and a half beats is not unwritable — it is a minim tied to a quaver,
     * which is what a publisher prints. Calling it unreadable and replacing it
     * with a rest would throw away a note the part plainly contains.
     */
    const { exercise, problems } = importing(score(note('C4', 1) + note('E4', 2.5) + note('F4', 0.5)));

    expect(problems).toEqual([]);
    expect(exercise?.notes.map((n) => n.startBeat)).toEqual([0, 1, 3, 3.5]);
    // One sound, not two: the middle pair is a tie.
    expect(exercise?.notes[1].tiedToNext).toBe(true);
    expect(exercise?.notes.map((n) => formatPitch(n.pitch))).toEqual(['C4', 'E4', 'E4', 'F4']);
    expect(exercise?.rests).toEqual([]);
  });

  it('reads a triplet, which the tick arithmetic gives for nothing', () => {
    const third = 1 / 3;
    const { exercise } = importing(
      score(note('C4', third) + note('D4', third) + note('E4', third) + note('F4', 3)),
    );
    expect(exercise?.notes.slice(0, 3).map((n) => n.duration.tuplet)).toEqual([3, 3, 3]);
  });

  it('reads rests', () => {
    const { exercise } = importing(score(note('C4', 1) + note(null, 2) + note('D4', 1)));
    expect(exercise?.rests.map((r) => r.startBeat)).toEqual([1]);
    expect(exercise?.notes).toHaveLength(2);
  });

  it('gives the player their own instrument, whatever the part was written for', () => {
    // The written pitches are what is on the page; the sounding ones follow
    // from whatever the player is holding. That is what lets a tuba player read
    // a cornet part.
    const { exercise } = importing(score(note('C4', 4)));
    expect(exercise?.instrumentId).toBe('eb-bass');
    expect(exercise?.notes[0].acceptedMasks.length).toBeGreaterThan(0);
  });
});

describe('ties', () => {
  it('joins a note tied over a bar line into one sound', () => {
    const { exercise } = importing(
      score(
        note('C4', 4, '<tie type="start"/>'),
        note('C4', 4, '<tie type="stop"/>'),
      ),
    );
    expect(exercise?.notes[0].tiedToNext).toBe(true);
    expect(exercise?.notes).toHaveLength(2);
  });

  it('drops a tie whose far end is not the note that follows', () => {
    /*
     * Unfolding can separate the two ends of a tie — one out of the last bar of
     * a repeat lands somewhere else on the second pass. A tie into a different
     * pitch would make the assembler clone a note that is not there.
     */
    const { exercise } = importing(
      score(note('C4', 4, '<tie type="start"/>'), note('G4', 4, '<tie type="stop"/>')),
    );
    expect(exercise?.notes[0].tiedToNext).toBe(false);
    expect(exercise?.notes.map((n) => formatPitch(n.pitch))).toEqual(['C4', 'G4']);
  });
});

describe('what gets dropped, and what does not', () => {
  it('reads one line of a divided note, and says which', () => {
    // A chord occupies time and is playable, so it gives up its other notes
    // rather than becoming a rest. Which line is the section's agreement, so
    // the warning names it rather than only counting it.
    const chord =
      note('C4', 4) +
      '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>96</duration></note>' +
      '<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>96</duration></note>';
    const { exercise, problems } = importing(score(chord));

    expect(exercise?.notes.map((n) => formatPitch(n.pitch))).toEqual(['G4']);
    expect(problems).toContain('1 divided note read on the upper line');
  });

  it('reads the lower line when that is what the section agreed', () => {
    /*
     * A bass part divided at the octave — the shape a real one turned up in.
     * Both lines are never rendered: they are different fingerings, so
     * accepting either would mean the player could not get those notes wrong,
     * and a fingering trainer that cannot be wrong teaches nothing at exactly
     * the bars the section had to think about.
     */
    const octave =
      note('B3', 4) +
      '<note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>96</duration></note>';
    const xml = score(octave);
    const parsed = parseMusicXml(xml);
    if ('problem' in parsed) throw new Error(parsed.problem);

    const upper = importPart(parsed.doc, { instrument: EB_BASS, divisi: 'upper' });
    const lower = importPart(parsed.doc, { instrument: EB_BASS, divisi: 'lower' });

    expect(upper.exercise?.notes.map((n) => formatPitch(n.pitch))).toEqual(['B4']);
    expect(lower.exercise?.notes.map((n) => formatPitch(n.pitch))).toEqual(['B3']);
    expect(lower.problems).toContain('1 divided note read on the lower line');
  });

  it('compares chord notes by pitch, not by octave alone', () => {
    // B3 against C4: the higher octave number is the lower note.
    const chord =
      note('B3', 4) +
      '<note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>96</duration></note>';
    expect(readsAs(score(chord))).toEqual(['C4']);
  });

  it('costs the octave but not the fingering, where the division is an octave', () => {
    /*
     * A tuba's octave is the same valve combination on a different harmonic.
     * So at the octave — which is how a bass part nearly always divides —
     * either line drills the same fingering, and choosing the one the section
     * did not give you costs the octave you read and hear rather than the
     * practice. Worth pinning: it is the reassurance behind offering a choice
     * at all rather than agonising over the default.
     */
    const octave =
      note('B3', 4) +
      '<note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>96</duration></note>';
    const parsed = parseMusicXml(score(octave));
    if ('problem' in parsed) throw new Error(parsed.problem);

    const upper = importPart(parsed.doc, { instrument: EB_BASS, divisi: 'upper' });
    const lower = importPart(parsed.doc, { instrument: EB_BASS, divisi: 'lower' });

    expect(upper.exercise?.notes[0].primaryMask).toBe(lower.exercise?.notes[0].primaryMask);
    // The octave itself does differ, which is what the choice is for.
    expect(upper.exercise?.notes[0].soundingMidi).not.toBe(
      lower.exercise?.notes[0].soundingMidi,
    );
  });

  it('drops grace notes, which occupy no counted time', () => {
    const grace =
      '<note><grace/><pitch><step>B</step><octave>3</octave></pitch></note>' + note('C4', 4);
    const { exercise, problems } = importing(score(grace));

    expect(exercise?.notes.map((n) => formatPitch(n.pitch))).toEqual(['C4']);
    expect(exercise?.totalBeats).toBe(4);
    expect(problems).toContain('1 grace note left out');
  });

  it('reads only the upper voice, and says it did', () => {
    /*
     * A `<backup>` winds the cursor back so a second voice can be written over
     * the same bar. Reading on past it would lay that voice end-to-end after
     * the first and make the bar twice as long as it is.
     */
    const twoVoices = note('C4', 4) + '<backup><duration>96</duration></backup>' + note('E3', 4);
    const { exercise, problems } = importing(score(twoVoices));

    expect(problems).toContain('1 bar had a second voice, and only the upper one was read');
    expect(exercise?.notes.map((n) => formatPitch(n.pitch))).toEqual(['C4']);
    expect(exercise?.totalBeats).toBe(4);
  });

  it('fills a bar written with forward rather than with rests', () => {
    /*
     * `<forward>` moves the cursor without sounding anything, which is how a
     * bar of nothing gets written — and a real part had two of them in a row.
     * Skipped, they left the bar empty *and short*, and every bar line after
     * them landed six beats adrift of the music.
     */
    const { exercise } = importing(
      score(note('C4', 4), '<forward><duration>96</duration></forward>', note('D4', 4)),
    );

    expect(exercise?.totalBeats).toBe(12);
    expect(exercise?.notes.map((n) => n.startBeat)).toEqual([0, 8]);
    // The empty bar reads as silence, which is what it is.
    expect(exercise?.rests.map((r) => r.startBeat)).toEqual([4]);
    expect(exercise && barAt(exercise.metres, 8)).toBe(2);
  });
});

describe('very short notes', () => {
  it('reads a demisemiquaver rather than dropping it', () => {
    // A real part had one in bar 4. The shortest value the app could write was
    // a semiquaver, so the note went missing and the player never played it.
    const short = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration></note>`;
    const { exercise, problems } = importing(score(short + note('D4', 3.875)));

    expect(problems).toEqual([]);
    expect(exercise?.notes[0].duration).toEqual({ value: 'thirtySecond', dotted: false });
    expect(exercise?.totalBeats).toBe(4);
  });
});

describe('notes the instrument cannot reach', () => {
  it('names them, and says they are not marked', () => {
    /*
     * The instrument is the player's, not the file's — that is what lets a tuba
     * player read a cornet part, and it is also how a note lands outside what
     * they are holding. Such a note has no fingering at all, so nothing they
     * press could ever match it: left in the totals it would be a wrong answer
     * nobody could have got right.
     */
    const high = `<note><pitch><step>G</step><octave>6</octave></pitch><duration>96</duration></note>`;
    const { exercise, problems } = importing(score(high));

    expect(problems[0]).toContain('outside what Eb Bass (Tuba) can play');
    expect(problems[0]).toContain('bar 1');
    expect(problems[0]).toContain('not marked');
    // Still on the page and still sounded — it is what the part says.
    expect(exercise?.notes).toHaveLength(1);
    expect(exercise?.notes[0].acceptedMasks).toEqual([]);
  });

  it('says nothing where every note is within reach', () => {
    const { problems } = importing(score(note('G4', 2) + note('C5', 2)));
    expect(problems).toEqual([]);
  });
});

describe('a rhythm that cannot be written', () => {
  it('replaces it with silence of exactly the right length', () => {
    /*
     * The rule that everything else rests on: whatever is dropped, the bar
     * count must not shift. Five ticks of twenty-four is no note this app can
     * write, so it becomes silence — and the bar after it still starts where a
     * player counting would put it.
     */
    const odd = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>5</duration></note>`;
    const { exercise, problems } = importing(
      score(odd + note('D4', 4 - 5 / DIVISIONS), note('E4', 4)),
    );

    expect(problems.some((p) => p.includes('cannot be written'))).toBe(true);
    expect(problems.some((p) => p.includes('bar 1'))).toBe(true);
    // Bar 2 still starts at beat 4, which is the whole point.
    expect(exercise && barAt(exercise.metres, 4)).toBe(1);
    expect(exercise?.totalBeats).toBe(8);
  });
});

describe('a pickup', () => {
  it('pads the short first bar so every bar line after it lands right', () => {
    /*
     * Nearly every march starts part-way through its first bar. Every bar line
     * in the piece is placed by counting whole bars from the start, so a first
     * bar left short would put all of them adrift of the music by the length of
     * the pickup — and with them every bar number the player navigates by.
     *
     * The pickup's own note lands where a player counts it: one beat into
     * four-four is the fourth beat of bar 1.
     */
    const xml = `<score-partwise version="4.0">
      <part-list><score-part id="P1"/></part-list>
      <part id="P1">
        <measure number="0" implicit="yes">${attributes()}${note('G4', 1)}</measure>
        <measure number="1">${note('C4', 4)}</measure>
      </part>
    </score-partwise>`;

    const { exercise } = importing(xml);
    expect(exercise?.notes.map((n) => n.startBeat)).toEqual([3, 4]);
    // One rest of three beats, which is a dotted minim — what an engraver
    // writes there, rather than a minim and a crotchet.
    expect(exercise?.rests).toEqual([
      { startBeat: 0, duration: { value: 'half', dotted: true } },
    ]);
    // The bar after the pickup is bar 2 by the app's counting, and starts on
    // the bar line rather than a beat early.
    expect(exercise && barAt(exercise.metres, 4)).toBe(1);
  });
});

describe('key and time signatures', () => {
  it('follows a key change, at the beat it lands on', () => {
    const { exercise } = importing(
      score(
        note('C4', 4),
        '<attributes><key><fifths>-3</fifths></key></attributes>' + note('C4', 4),
      ),
    );
    expect(exercise?.keys).toEqual([
      { fromBeat: 0, fifths: 0 },
      { fromBeat: 4, fifths: -3 },
    ]);
  });

  it('follows a change of time signature', () => {
    const { exercise } = importing(
      score(
        note('C4', 4),
        '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
          note('C4', 3),
      ),
    );
    expect(changesMetre(exercise?.metres ?? [])).toBe(true);
    expect(exercise?.metres[1]).toMatchObject({ fromBeat: 4 });
    expect(exercise?.metres[1].metre.beatsPerBar).toBe(3);
    // And the bars are counted through the change rather than divided.
    expect(exercise && barAt(exercise.metres, 7)).toBe(2);
  });

  it('does not record a change where nothing changed', () => {
    /*
     * Every measure of a MuseScore export can restate the signature, and a
     * repeated bar meets it twice. An entry per restatement would make a
     * single-key part report that it changes key, since that is counted by the
     * length of the list.
     */
    const restated = '<attributes><key><fifths>0</fifths></key></attributes>' + note('C4', 4);
    const { exercise } = importing(score(restated, restated, restated));
    expect(exercise?.keys).toHaveLength(1);
    expect(changesKey(exercise?.keys ?? [])).toBe(false);
  });
});

describe('multi-bar rests', () => {
  it('keeps twenty bars off as one rest of twenty bars', () => {
    // Not expanded: the count is the notation. The measures it covers are in
    // the file and are stepped over rather than read.
    const covered = Array.from({ length: 20 }, () => note(null, 4));
    const { exercise } = importing(
      score(
        note('C4', 4),
        '<attributes><measure-style><multiple-rest>20</multiple-rest></measure-style></attributes>' +
          note(null, 4),
        ...covered.slice(1),
        note('D4', 4),
      ),
    );

    const multi = exercise?.rests.filter((r) => (r.bars ?? 1) > 1) ?? [];
    expect(multi).toHaveLength(1);
    expect(multi[0]).toMatchObject({ startBeat: 4, bars: 20 });
    // The music resumes at bar 22 as a player counting would have it.
    expect(exercise && barAt(exercise.metres, exercise.notes[1].startBeat)).toBe(21);
  });
});

describe('repeats reaching the notes', () => {
  it('plays a repeated bar twice, with its notes both times', () => {
    const { exercise } = importing(
      score(
        '<barline location="left"><repeat direction="forward"/></barline>' + note('C4', 4),
        note('D4', 4) + '<barline location="right"><repeat direction="backward"/></barline>',
        note('E4', 4),
      ),
    );
    expect(exercise?.notes.map((n) => formatPitch(n.pitch))).toEqual([
      'C4',
      'D4',
      'C4',
      'D4',
      'E4',
    ]);
    expect(exercise?.totalBeats).toBe(20);
  });

  it('marks an imported exercise as imported', () => {
    // Not in `EXERCISE_KINDS`, because it is not something the generator can be
    // asked for — but everything downstream can still tell the two apart.
    expect(importing(score(note('C4', 4))).exercise?.kind).toBe('imported');
  });
});

describe('bar repeats', () => {
  const repeatStyle = (bars: number, type = 'start') =>
    `<attributes><measure-style><measure-repeat type="${type}">${bars}</measure-repeat></measure-style></attributes>`;

  it('leaves a conforming file alone, because the notes are already there', () => {
    /*
     * `measure-repeat` is a display style, not missing music. The schema says
     * the music "needs to be repeated within each measure of the MusicXML
     * file", so a conforming export needs nothing done to it — and a bar the
     * publisher varied on purpose must not be overwritten from the pattern.
     */
    const { exercise } = importing(
      score(note('C4', 4), repeatStyle(1) + note('G4', 4)),
    );
    expect(readsAs(score(note('C4', 4), repeatStyle(1) + note('G4', 4)))).toEqual(['C4', 'G4']);
    expect(exercise?.totalBeats).toBe(8);
  });

  it('fills an empty bar under the sign, which a careless exporter leaves', () => {
    // A bar of silence under a repeat sign is silence that looks deliberate,
    // and the pattern to fill it from is sitting immediately before it.
    expect(readsAs(score(note('C4', 4), repeatStyle(1)))).toEqual(['C4', 'C4']);
  });

  it('copies a pair for a two-bar repeat, not the same bar twice', () => {
    expect(
      readsAs(
        score(note('C4', 4), note('G4', 4), repeatStyle(2), '', ''),
      ),
    ).toEqual(['C4', 'G4', 'C4', 'G4', 'C4']);
  });

  it('stops filling where the region stops', () => {
    expect(
      readsAs(score(note('C4', 4), repeatStyle(1), repeatStyle(1, 'stop'))),
    ).toEqual(['C4', 'C4']);
  });
});

/** Just the short-bar complaint, which both blocks below need to ask about. */
const complaint = (xml: string) =>
  importing(xml).problems.filter((said) => said.includes('full bar of music'));

describe('a bar that does not hold a full bar of music', () => {
  /*
   * The only check here that interrogates the file rather than reading it, and
   * the one fault that makes an import untrustworthy rather than incomplete:
   * a short bar is not short in one place, it puts every bar line after it
   * early by that much, and the bar numbers are what a player navigates by.
   *
   * An OMR result of a real part had 27 of 84 bars not holding three beats and
   * imported without a word before this existed.
   */
  it('says nothing when every bar adds up', () => {
    expect(complaint(score(note('C4', 4), note('D4', 2) + note('E4', 2)))).toEqual([]);
  });

  it('names a bar that is short, and says what it costs', () => {
    expect(complaint(score(note('C4', 4), note('D4', 3), note('E4', 4)))).toEqual([
      '1 bar does not hold a full bar of music (bar 2)' +
        ' — every bar line after them is adrift, so the numbering will not match the printed part',
    ]);
  });

  it('does not complain about a bar that holds too much, but reads it', () => {
    // A long bar is not a short bar with the sign flipped: see the block below.
    // Nothing is missing from it, so nothing is reported missing.
    expect(complaint(score(note('C4', 4), note('D4', 5)))).toEqual([]);
  });

  it('counts against the metre in force, not the one it started in', () => {
    /*
     * Three beats is a full bar of 3/4 and a beat short of 4/4. Reading this
     * against the opening metre would report every bar after a change to a
     * shorter one — which is to say, it would report the file this app was
     * built to import.
     */
    const changed = '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>';
    expect(complaint(score(note('C4', 4), changed + note('D4', 3), note('E4', 3)))).toEqual([]);
    // Two beats in the 3/4 is short, and short bars are still reported.
    expect(complaint(score(note('C4', 4), changed + note('D4', 2)))).toHaveLength(1);
  });

  it('does not name the pickup it just padded', () => {
    const xml = `<score-partwise version="4.0">
      <part-list><score-part id="P1"/></part-list>
      <part id="P1">
        <measure number="0" implicit="yes">${attributes()}${note('G4', 1)}</measure>
        <measure number="1">${note('C4', 4)}</measure>
      </part>
    </score-partwise>`;
    expect(complaint(xml)).toEqual([]);
  });

  it('does not name a last bar that completes the pickup', () => {
    /*
     * The other half of the convention: a part opening on the fourth beat ends
     * on a bar of three, and the printed part numbers neither of them, because
     * between them they are one bar. Nearly every march is engraved this way,
     * and a warning that fires on correct files is worse than no warning.
     */
    const xml = `<score-partwise version="4.0">
      <part-list><score-part id="P1"/></part-list>
      <part id="P1">
        <measure number="0" implicit="yes">${attributes()}${note('G4', 1)}</measure>
        <measure number="1">${note('C4', 4)}</measure>
        <measure number="2">${note('D4', 3)}</measure>
      </part>
    </score-partwise>`;
    expect(complaint(xml)).toEqual([]);
  });

  it('still names a last bar that is short by anything else', () => {
    // The exemption is arithmetic, not a blanket pass on the final bar: it
    // forgives exactly what the pickup was padded with and nothing else.
    const xml = `<score-partwise version="4.0">
      <part-list><score-part id="P1"/></part-list>
      <part id="P1">
        <measure number="0" implicit="yes">${attributes()}${note('G4', 1)}</measure>
        <measure number="1">${note('C4', 4)}</measure>
        <measure number="2">${note('D4', 2)}</measure>
      </part>
    </score-partwise>`;
    expect(complaint(xml)).toHaveLength(1);
  });

  it('names a bar inside a repeat once, not once per pass', () => {
    // It is one bar on the page and one place for the player to look, however
    // many times the walk goes through it.
    const short = '<barline location="left"><repeat direction="forward"/></barline>' +
      note('C4', 3) +
      '<barline location="right"><repeat direction="backward"/></barline>';
    expect(complaint(score(note('C4', 4), short))).toEqual([
      '1 bar does not hold a full bar of music (bar 2)' +
        ' — every bar line after them is adrift, so the numbering will not match the printed part',
    ]);
  });

  it('does not name the bars a multi-bar rest covers', () => {
    // They are stepped over rather than read, so they hold nothing at all —
    // which would otherwise look like the emptiest bars in the file.
    const covered = Array.from({ length: 3 }, () => note(null, 4));
    expect(
      complaint(
        score(
          note('C4', 4),
          '<attributes><measure-style><multiple-rest>4</multiple-rest></measure-style></attributes>' +
            note(null, 4),
          ...covered,
          note('D4', 4),
        ),
      ),
    ).toEqual([]);
  });

  it('lists six bars and counts the rest', () => {
    const bars = [note('C4', 4), ...Array.from({ length: 8 }, () => note('D4', 3))];
    expect(complaint(score(...bars))).toEqual([
      '8 bars do not hold a full bar of music (bars 2, 3, 4, 5, 6, 7 and 2 more)' +
        ' — every bar line after them is adrift, so the numbering will not match the printed part',
    ]);
  });
});

describe('a bar longer than its time signature', () => {
  /*
   * Real music does this: five beats in the middle of a four-four piece,
   * written without a change of signature because it interrupts the metre
   * rather than replacing it. `metres` being a list, the app can say exactly
   * that — five-four for the one bar, four-four again at the next bar line.
   *
   * Inferred only where the bar is *longer*, which is not tidiness. Every one
   * of the eleven malformed bars in the one corrupt file to hand is short, and
   * five of them are pairs summing to a single bar — printed bars the scanner
   * split in two. A short bar is something missing and the app cannot know
   * what; a long bar has music in it that has to go somewhere.
   */
  const metresOf = (xml: string) =>
    (importing(xml).exercise?.metres ?? []).map((change) => [
      change.fromBeat,
      `${change.metre.beatsPerBar}/${change.metre.beatUnit}`,
    ]);

  const five = note('E4', 1) + note('E4', 1) + note('E4', 1) + note('E4', 1) + note('E4', 1);

  it('reads it as its own time signature, and goes back at the next bar', () => {
    expect(metresOf(score(note('C4', 4), five, note('F4', 4)))).toEqual([
      [0, '4/4'],
      [4, '5/4'],
      [9, '4/4'],
    ]);
  });

  it('puts every bar line where the player counts one', () => {
    /*
     * The whole point of the exercise. Left as four-four, the five beats push a
     * bar line into the middle of the odd bar and every downbeat after it lands
     * a beat early — which is invisible until you count, and wrong for the rest
     * of the piece.
     */
    const { exercise } = importing(score(note('C4', 4), five, note('F4', 4)));
    const metres = exercise!.metres;
    // Bars start at beats 0, 4 and 9; the piece is three bars long, not four.
    expect([0, 1, 2].map((bar) => beatOfBar(metres, bar))).toEqual([0, 4, 9]);
    expect(barAt(metres, 8)).toBe(1);
    expect(barAt(metres, 9)).toBe(2);
    expect(barCount(metres, exercise!.totalBeats)).toBe(3);
  });

  it('says so, because the page does not', () => {
    // The app has decided something the printed part does not state. If it has
    // decided wrongly, this sentence is what lets the player see that.
    expect(importing(score(note('C4', 4), five)).problems).toEqual([
      '1 bar is longer than the time signature says (bar 2)' +
        ' — read as written, with the bar line where the music ends',
    ]);
  });

  it('reads a seven-eight bar in a six-eight piece', () => {
    // The unit is the one the metre is written in, not the crotchet: seven
    // quavers is 7/8, and 3.5 crotchets would name nothing at all.
    const sixEight = '<attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>';
    const seven = Array.from({ length: 7 }, () => note('E4', 0.5)).join('');
    expect(metresOf(score(note('C4', 4), sixEight + note('C4', 3), seven, note('F4', 3)))).toEqual([
      [0, '4/4'],
      [4, '6/8'],
      [7, '7/8'],
      [10.5, '6/8'],
    ]);
  });

  it('refuses a whole multiple, which is two bars with the line missing', () => {
    // Six beats where three are expected is a missing bar line, and 6/4 would
    // be a plausible-looking lie — worse than the warning it replaced.
    const threeFour = '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>';
    expect(complaint(score(note('C4', 4), threeFour + note('C4', 3), note('D4', 6)))).toHaveLength(1);
  });

  it('refuses a length that names no signature', () => {
    /*
     * Four and a half crotchets in four-four. Long, so the earlier refusals do
     * not catch it, and four-and-a-half-four is not a time signature anyone
     * writes — so it is reported rather than invented.
     *
     * Deliberately long: written short, this passed while the whole-number
     * check was deleted, because the length never reached it.
     */
    expect(complaint(score(note('C4', 4), note('D4', 4.5)))).toHaveLength(1);
  });

  it('refuses a length past anything anyone writes', () => {
    // Seventeen-four is not an irregular bar, it is a file that has gone wrong.
    expect(complaint(score(note('C4', 4), note('D4', 4) + note('E4', 4) + note('F4', 4) + note('G4', 4) + note('A4', 1)))).toHaveLength(1);
  });

  it('handles two odd bars in a row without inventing a metre between them', () => {
    /*
     * The restore at the second bar's line and its own inference land on the
     * same beat. Every consumer survives a duplicate, but a list carrying a
     * change that was never in force is a trap for whoever reads it next.
     */
    expect(metresOf(score(note('C4', 4), five, five, note('F4', 4)))).toEqual([
      [0, '4/4'],
      [4, '5/4'],
      [14, '4/4'],
    ]);
  });

  it('lets the file overrule the restore where the next bar declares a metre', () => {
    const threeFour = '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>';
    expect(metresOf(score(note('C4', 4), five, threeFour + note('F4', 3)))).toEqual([
      [0, '4/4'],
      [4, '5/4'],
      [9, '3/4'],
    ]);
  });
});

describe('the shape of a real part that came in', () => {
  /*
   * TestPiece.mscz, brought in by the player on 2026-08-12 and knowingly
   * malformed: 4/4 turning into 3/4 at bar 5, a "To Coda" at bar 13, and a
   * "D.S. al Coda" at bar 37 pointing at a segno the score does not contain.
   *
   * Mirrored here rather than fixtured, because what is being pinned is how the
   * app answers this *shape* — a legitimate metre change alongside navigation
   * that cannot be resolved.
   */
  const marked = (m: string) => `<direction>${m}</direction>`;

  function testPieceShaped(): string {
    const bars: string[] = [];
    bars.push(attributes() + note('C4', 4));
    bars.push(note('D4', 4));
    bars.push(note('E4', 4));
    bars.push('<attributes><key><fifths>2</fifths></key></attributes>' + note('F4', 4));
    // Bar 5: the time signature changes, and stays changed.
    bars.push(
      '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
        note('G4', 3),
    );
    for (let i = 0; i < 7; i++) bars.push(note('A4', 3));
    bars.push(marked('<sound tocoda="codab"/>') + note('B4', 3));
    for (let i = 0; i < 3; i++) bars.push(note('C5', 3));
    bars.push(marked('<sound dalsegno="segno"/>') + note('D5', 3));
    bars.push(marked('<sound coda="codab"/>') + note('E5', 3));
    return score(...bars);
  }

  it('says the D.S. has nowhere to go, and plays the part as printed', () => {
    const { exercise, problems } = importing(testPieceShaped());

    expect(problems[0]).toContain('segno');
    expect(problems).toContain('the repeats were not followed, so this is the part as printed');
    // Every bar once, in written order: nothing is unfolded and nothing is lost.
    expect(exercise?.notes).toHaveLength(18);
  });

  it('still follows the change of time signature, which is not in doubt', () => {
    /*
     * The navigation being broken says nothing about the metre. Four bars of
     * 4/4 and fourteen of 3/4 is eighteen bars, and a reader counting from the
     * top must land on the same number the page does.
     */
    const { exercise } = importing(testPieceShaped());

    expect(changesMetre(exercise?.metres ?? [])).toBe(true);
    expect(exercise?.metres[1]).toMatchObject({ fromBeat: 16 });
    expect(exercise?.totalBeats).toBe(16 + 14 * 3);
    expect(exercise && barAt(exercise.metres, 16)).toBe(4);
    expect(exercise && barAt(exercise.metres, exercise.totalBeats - 3)).toBe(17);
  });
});

describe('a part with nothing to read', () => {
  it('says so rather than handing back an empty exercise', () => {
    const { exercise, problems } = importing(score(''));
    expect(exercise).toBeNull();
    expect(problems.join(' ')).toContain('nothing playable');
  });

  it('says so when the part asked for is not there', () => {
    const parsed = parseMusicXml(score(note('C4', 4)));
    if ('problem' in parsed) throw new Error(parsed.problem);
    const { exercise, problems } = importPart(parsed.doc, { instrument: EB_BASS, partIndex: 4 });
    expect(exercise).toBeNull();
    expect(problems[0]).toContain('not in this file');
  });
});
