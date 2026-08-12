// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { instrumentById } from '../domain/instruments';
import { formatPitch } from '../domain/pitch';
import { parseMusicXml } from '../import/musicxml';
import { memoryStore, titleFor, type PieceRecord } from './library';
import { measure, openPiece, savePiece } from './pieces';

/**
 * The library, against an in-memory store.
 *
 * What is checked here is the *contract* — what is kept, what comes back, and
 * what happens when the two disagree. Whether IndexedDB honours that contract
 * is not testable here, because the test environment has none; the adapter is
 * kept thin for that reason and is driven in a real browser instead.
 */

const EB_BASS = instrumentById('eb-bass');
const encoder = new TextEncoder();

function score(title: string | null, partName = 'Eb Bass'): string {
  const work = title === null ? '' : `<work><work-title>${title}</work-title></work>`;
  return `<score-partwise version="4.0">
    ${work}
    <part-list><score-part id="P1"><part-name>${partName}</part-name></score-part></part-list>
    <part id="P1"><measure number="1">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
      <note><chord/><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure></part>
  </score-partwise>`;
}

function bytesOf(xml: string): ArrayBuffer {
  const view = encoder.encode(xml);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function docOf(xml: string): Document {
  const parsed = parseMusicXml(xml);
  if ('problem' in parsed) throw new Error(parsed.problem);
  return parsed.doc;
}

async function saved(xml: string, divisi: 'upper' | 'lower' = 'upper') {
  const store = memoryStore();
  const record = await savePiece(store, {
    fileName: 'Death or Glory.mxl',
    source: bytesOf(xml),
    doc: docOf(xml),
    partIndex: 0,
    divisi,
    bars: 1,
    notes: 2,
  });
  return { store, record };
}

describe('naming a piece', () => {
  it('takes the work title, which is what the player calls it', () => {
    expect(titleFor(docOf(score('Death or Glory')), 'whatever.mxl')).toBe('Death or Glory');
  });

  it('ignores the placeholder notation software writes for an untitled score', () => {
    /*
     * MuseScore exports `<work-title>Title</work-title>` from a score whose
     * title was never set, and a real export did. Taken at face value every
     * piece in the library is called "Title" and the list cannot be read — so a
     * placeholder counts as no title, and the file name wins.
     */
    expect(titleFor(docOf(score('Title')), 'TestPiece.mxl')).toBe('TestPiece');
    expect(titleFor(docOf(score('Untitled score')), 'March.mxl')).toBe('March');
    // A real title that merely resembles one is still a title.
    expect(titleFor(docOf(score('Title Fight')), 'x.mxl')).toBe('Title Fight');
  });

  it('falls back to the file name without its extension', () => {
    // A file named after the piece is the common case, and "Death or Glory"
    // reads better than "Death or Glory.mxl".
    expect(titleFor(docOf(score(null)), 'Death or Glory.mxl')).toBe('Death or Glory');
    expect(titleFor(docOf(score(null)), 'part.musicxml')).toBe('part');
  });
});

describe('keeping a piece', () => {
  it('lists what was saved, with the part it was read on', async () => {
    const { store, record } = await saved(score('Death or Glory'));
    const list = await store.list();

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: record.id,
      title: 'Death or Glory',
      fileName: 'Death or Glory.mxl',
      partName: 'Eb Bass',
      partIndex: 0,
      divisi: 'upper',
    });
  });

  it('puts the newest first, which is what you are working on', async () => {
    const store = memoryStore();
    const older: PieceRecord = {
      id: 'a',
      title: 'Older',
      fileName: 'a.mxl',
      partIndex: 0,
      partName: 'p',
      divisi: 'upper',
      addedAt: 1,
      bars: 1,
      notes: 1,
    };
    await store.put(older, bytesOf('<a/>'));
    await store.put({ ...older, id: 'b', title: 'Newer', addedAt: 2 }, bytesOf('<b/>'));

    expect((await store.list()).map((r) => r.title)).toEqual(['Newer', 'Older']);
  });

  it('replaces a piece kept again rather than growing a duplicate', async () => {
    /*
     * Re-exporting after a correction is the ordinary way to work — the player
     * did it three times in one morning. A library that grew a row each time
     * would fill with stale copies of one march, every one looking as current
     * as the others.
     */
    const store = memoryStore();
    const first = await savePiece(store, {
      fileName: 'March.mxl',
      source: bytesOf(score('March')),
      doc: docOf(score('March')),
      partIndex: 0,
      divisi: 'upper',
      bars: 1,
      notes: 2,
    });
    const again = await savePiece(store, {
      fileName: 'March.mxl',
      source: bytesOf(score('March')),
      doc: docOf(score('March')),
      partIndex: 0,
      divisi: 'lower',
      bars: 9,
      notes: 20,
    });

    expect(again.id).toBe(first.id);
    const list = await store.list();
    expect(list).toHaveLength(1);
    // And it is the newer reading that survives, not the older one.
    expect(list[0]).toMatchObject({ divisi: 'lower', bars: 9 });
  });

  it('keeps a different part of the same file as its own piece', async () => {
    // Practising two parts of one score is a real thing to want.
    const store = memoryStore();
    const common = {
      fileName: 'March.mxl',
      source: bytesOf(score('March')),
      doc: docOf(score('March')),
      divisi: 'upper' as const,
      bars: 1,
      notes: 2,
    };
    await savePiece(store, { ...common, partIndex: 0 });
    await savePiece(store, { ...common, partIndex: 1 });

    expect(await store.list()).toHaveLength(2);
  });

  it('forgets a piece and its file together', async () => {
    const { store, record } = await saved(score('Death or Glory'));
    await store.remove(record.id);

    expect(await store.list()).toEqual([]);
    // The bytes go with it: a source left behind would be a file nothing can
    // ever reach and nothing will ever delete.
    expect(await store.source(record.id)).toBeNull();
  });
});

describe('opening a piece again', () => {
  it('reads it back playable, on the instrument in hand today', async () => {
    const { store, record } = await saved(score('Death or Glory'));
    const opened = await openPiece(store, record, { instrument: EB_BASS });

    expect('imported' in opened).toBe(true);
    if (!('imported' in opened)) return;
    expect(opened.imported.exercise?.instrumentId).toBe('eb-bass');
    expect(measure(opened.imported)).toEqual({ bars: 1, notes: 2 });
  });

  it('reads the same line of a divided note it was saved with', async () => {
    /*
     * The section's agreement is part of how the piece is read, so it is kept
     * with it. Opening a part saved on the lower line and getting the upper one
     * would be the library quietly overruling a decision the player made.
     */
    const upper = await saved(score('D'), 'upper');
    const lower = await saved(score('D'), 'lower');

    const a = await openPiece(upper.store, upper.record, { instrument: EB_BASS });
    const b = await openPiece(lower.store, lower.record, { instrument: EB_BASS });
    if (!('imported' in a) || !('imported' in b)) throw new Error('did not open');

    expect(a.imported.exercise?.notes.map((n) => formatPitch(n.pitch))).toEqual(['C5', 'G4']);
    expect(b.imported.exercise?.notes.map((n) => formatPitch(n.pitch))).toEqual(['C4', 'G4']);
  });

  it('re-reads the file rather than replaying a stored exercise', async () => {
    /*
     * The point of keeping the bytes. Four faults were found in the importer in
     * two days by one real file; a stored exercise would have frozen every one
     * of them into the player's own library with nothing to re-read from.
     *
     * Stood up here by changing the instrument, which only re-reading can
     * answer: the written pitches are the same and the fingerings are not.
     */
    const { store, record } = await saved(score('D'));
    const asBass = await openPiece(store, record, { instrument: EB_BASS });
    const asCornet = await openPiece(store, record, { instrument: instrumentById('cornet') });
    if (!('imported' in asBass) || !('imported' in asCornet)) throw new Error('did not open');

    const written = (o: typeof asBass) => o.imported.exercise?.notes.map((n) => n.writtenMidi);
    expect(written(asCornet)).toEqual(written(asBass));
    expect(asCornet.imported.exercise?.notes[0].soundingMidi).not.toBe(
      asBass.imported.exercise?.notes[0].soundingMidi,
    );
  });
});

describe('when the library and its files disagree', () => {
  it('names the piece whose file has gone', async () => {
    /*
     * A record whose bytes are not there — which is what a half-completed
     * eviction leaves behind. The player can do nothing about it except be told
     * which piece is the problem, so the message says which.
     */
    const { store, record } = await saved(score('Death or Glory'));

    const opened = await openPiece(store, { ...record, id: 'no-such-source' }, {
      instrument: EB_BASS,
    });
    expect('problem' in opened && opened.problem).toContain('Death or Glory');
    expect('problem' in opened && opened.problem).toContain('file has gone');
  });

  it('names the piece whose file no longer reads', async () => {
    const store = memoryStore();
    const record: PieceRecord = {
      id: 'x',
      title: 'Corrupted',
      fileName: 'x.mxl',
      partIndex: 0,
      partName: 'p',
      divisi: 'upper',
      addedAt: 1,
      bars: 1,
      notes: 1,
    };
    await store.put(record, bytesOf('<not-music><oops></not-music>'));

    const opened = await openPiece(store, record, { instrument: EB_BASS });
    expect('problem' in opened && opened.problem).toContain('Corrupted');
  });
});
