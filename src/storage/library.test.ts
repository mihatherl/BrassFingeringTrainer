// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMusicXml } from '../import/musicxml';
import {
  memoryStore,
  requestPersistence,
  storageAvailable,
  titleFor,
  type PieceRecord,
} from './library';

/**
 * The library itself, as opposed to what is put in it.
 *
 * `pieces.test.ts` covers the seam between here and the importer — what is
 * kept, what comes back, what happens when the two disagree — and in doing so
 * covers most of this file by walking through it. What is left is what that
 * route never touches, and it is not the leftovers: a title taken from the
 * wrong element makes every OMR import in the list unreadable, and persistence
 * is the only thing standing between a practice library and a browser quietly
 * emptying it.
 */

function docOf(xml: string): Document {
  const parsed = parseMusicXml(`<score-partwise version="4.0">${xml}</score-partwise>`);
  if ('problem' in parsed) throw new Error(parsed.problem);
  return parsed.doc;
}

const record = (over: Partial<PieceRecord> = {}): PieceRecord => ({
  id: 'a',
  title: 'A March',
  fileName: 'march.mxl',
  partIndex: 0,
  partName: 'Eb Bass',
  divisi: 'upper',
  addedAt: 1,
  bars: 42,
  notes: 100,
  ...over,
});

const bytes = (text: string): ArrayBuffer => {
  const view = new TextEncoder().encode(text);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
};

describe('what a piece is called', () => {
  it('prefers the work title', () => {
    const doc = docOf(
      '<work><work-title>Death or Glory</work-title></work><movement-title>Movement</movement-title>',
    );
    expect(titleFor(doc, 'whatever.mxl')).toBe('Death or Glory');
  });

  it('falls back to the movement title, which is where OMR output puts it', () => {
    /*
     * Not a corner: Audiveris writes `<movement-title>` and no `<work>` at all,
     * so a scanned part reaching the library gets its name from here or from
     * nowhere. The one that came in was titled A SCOTT'SH HYMN this way.
     */
    const doc = docOf("<movement-title>A SCOTT'SH HYMN</movement-title>");
    expect(titleFor(doc, 'scan.mxl')).toBe("A SCOTT'SH HYMN");
  });

  it('ignores a placeholder movement title as readily as a placeholder work title', () => {
    // The same rule at both elements. A placeholder is the *absence* of a
    // title, and it loses to the file name wherever it is written.
    const doc = docOf('<movement-title>Untitled score</movement-title>');
    expect(titleFor(doc, 'Death or Glory.mxl')).toBe('Death or Glory');
  });

  it('takes the movement title where the work title is a placeholder', () => {
    /*
     * MuseScore's untouched export writes `<work-title>Title</work-title>`, and
     * a player who filled in the movement title and nothing else would
     * otherwise be handed the file name over the name they typed.
     */
    const doc = docOf(
      '<work><work-title>Title</work-title></work><movement-title>Slow Melody</movement-title>',
    );
    expect(titleFor(doc, 'export.mxl')).toBe('Slow Melody');
  });

  it('strips the extension, whichever of the three it is', () => {
    const doc = docOf('');
    expect(titleFor(doc, 'March.mxl')).toBe('March');
    expect(titleFor(doc, 'March.musicxml')).toBe('March');
    expect(titleFor(doc, 'March.XML')).toBe('March');
    // Only at the end, or a piece called "Sing.xml.and.play" loses its middle.
    expect(titleFor(doc, 'Sing.xml.and.play')).toBe('Sing.xml.and.play');
  });

  it('keeps a file name that is nothing but an extension', () => {
    // Stripping leaves the empty string, and a piece with no name at all cannot
    // be picked out of a list.
    expect(titleFor(docOf(''), '.mxl')).toBe('.mxl');
  });
});

describe('the in-memory store', () => {
  it('keeps a piece and gives its bytes back unchanged', async () => {
    const store = memoryStore();
    await store.put(record(), bytes('<score/>'));

    expect(await store.list()).toEqual([record()]);
    expect(new TextDecoder().decode((await store.source('a'))!)).toBe('<score/>');
  });

  it('answers for a piece it has never heard of rather than throwing', async () => {
    // The list screen asks about whatever the records name, and a record whose
    // source has gone is the failure `openPiece` reports by name.
    const store = memoryStore();
    expect(await store.source('gone')).toBeNull();
    await expect(store.remove('gone')).resolves.toBeUndefined();
  });

  it('puts the newest first, whatever order they went in', async () => {
    const store = memoryStore();
    await store.put(record({ id: 'old', addedAt: 100 }), bytes('a'));
    await store.put(record({ id: 'new', addedAt: 300 }), bytes('b'));
    await store.put(record({ id: 'middle', addedAt: 200 }), bytes('c'));

    expect((await store.list()).map((piece) => piece.id)).toEqual(['new', 'middle', 'old']);
  });

  it('replaces a piece put again under the same id, bytes and all', async () => {
    const store = memoryStore();
    await store.put(record({ title: 'Before' }), bytes('first'));
    await store.put(record({ title: 'After' }), bytes('second'));

    expect((await store.list()).map((piece) => piece.title)).toEqual(['After']);
    expect(new TextDecoder().decode((await store.source('a'))!)).toBe('second');
  });

  it('forgets the record and the bytes together', async () => {
    // Either one left behind is a leak: an orphaned source is a file nothing
    // can reach, and an orphaned record is a row that cannot be opened.
    const store = memoryStore();
    await store.put(record(), bytes('x'));
    await store.remove('a');

    expect(await store.list()).toEqual([]);
    expect(await store.source('a')).toBeNull();
  });

  it('hands out a list that cannot be used to change what is stored', async () => {
    const store = memoryStore();
    await store.put(record(), bytes('x'));

    (await store.list()).pop();
    expect(await store.list()).toHaveLength(1);
  });
});

describe('asking the browser to keep the library', () => {
  /*
   * Storage is evictable by default, and a practice library quietly emptying
   * itself is the worst failure this feature has. Asking is all that can be
   * done — the answer is the browser's — so what is tested here is that the
   * answer is reported as given, and that nothing about the asking can throw
   * on the way to a screen that has to draw regardless.
   */
  afterEach(() => vi.unstubAllGlobals());

  const withStorage = (storage: unknown) => vi.stubGlobal('navigator', { storage });

  it('is content when the browser has already promised', async () => {
    const persist = vi.fn();
    withStorage({ persisted: async () => true, persist });

    expect(await requestPersistence()).toBe(true);
    // Asked again for a promise already given: harmless, but it can prompt on
    // some browsers, and prompting a player twice for nothing is not harmless.
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks when nothing has been promised, and reports what it is told', async () => {
    withStorage({ persisted: async () => false, persist: async () => true });
    expect(await requestPersistence()).toBe(true);

    withStorage({ persisted: async () => false, persist: async () => false });
    expect(await requestPersistence()).toBe(false);
  });

  it('says no where the browser will not be asked at all', async () => {
    // A browser that has not promised anything and a browser that cannot be
    // asked are the same answer to the only question being put.
    withStorage(undefined);
    expect(await requestPersistence()).toBe(false);

    withStorage({});
    expect(await requestPersistence()).toBe(false);
  });

  it('says no rather than throwing when the asking fails', async () => {
    withStorage({
      persisted: async () => false,
      persist: async () => {
        throw new Error('refused');
      },
    });
    expect(await requestPersistence()).toBe(false);
  });

  it('survives a browser with no navigator', async () => {
    vi.stubGlobal('navigator', undefined);
    expect(await requestPersistence()).toBe(false);
  });
});

describe('whether this browser can keep anything', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is decided by IndexedDB being there', () => {
    vi.stubGlobal('indexedDB', {});
    expect(storageAvailable()).toBe(true);

    // A private window, most likely — which the import screen says out loud
    // rather than letting a player keep a piece that will not be there.
    vi.stubGlobal('indexedDB', undefined);
    expect(storageAvailable()).toBe(false);
  });
});
