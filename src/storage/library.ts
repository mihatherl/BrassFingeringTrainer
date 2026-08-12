/**
 * My Music: the pieces the player has opened, kept between sessions.
 *
 * ## What is kept is the file, not the exercise
 *
 * A record holds the **original bytes** of the MusicXML that was opened, and
 * the choices made when reading it — which part, which line where it divides.
 * Opening a piece reads it again from those bytes.
 *
 * Storing the finished `Exercise` instead would be smaller to write and is the
 * obvious thing to do, and it is wrong for two reasons that have both already
 * happened:
 *
 *  - **The importer keeps improving.** Four faults were found in it in two days
 *    by one real file — a bar coming out six beats short, a dropped
 *    demisemiquaver, a metre change never drawn, and unreached bars going
 *    unreported. A stored exercise would be frozen at the version that made it,
 *    so every one of those fixes would have left the player's own library still
 *    wrong, with nothing to re-read from.
 *  - **The instrument is the player's, not the file's.** Fingerings come from
 *    what they are holding today. Picking up a different instrument should
 *    re-finger the music, which it cannot do if the answer was baked in.
 *
 * The source is also far smaller: a forty-two bar part is about three kilobytes
 * compressed, where its exercise is thousands of note events.
 *
 * ## Why an interface rather than IndexedDB directly
 *
 * The test environment has no IndexedDB, and adding a fake one is a dependency
 * this app has managed without. So the store is an interface: the logic here is
 * tested against an in-memory implementation, and the IndexedDB adapter is kept
 * thin enough that driving it in a real browser is honest evidence. The same
 * bargain the transport makes with its clock and the session with its voice.
 */

import type { Divisi } from '../import/part';

/**
 * What the library knows about one piece, without its notes.
 *
 * Deliberately small: the list screen reads every record, and a record carrying
 * its own source would mean loading a megabyte of MusicXML to draw a menu.
 */
export interface PieceRecord {
  id: string;
  /** What to call it: the work title where the file has one, else the file name. */
  title: string;
  fileName: string;
  /** Which part was read, and what it was called. */
  partIndex: number;
  partName: string;
  /** Which line was read where the part divides. */
  divisi: Divisi;
  /** When it was added, so the list can put the newest first. */
  addedAt: number;
  /** As read when it was saved — for the list, not relied on when opening. */
  bars: number;
  notes: number;
}

/**
 * Where pieces live.
 *
 * Sources are kept apart from records so that listing does not drag every byte
 * of every piece into memory to draw a menu.
 */
export interface PieceStore {
  list(): Promise<PieceRecord[]>;
  put(record: PieceRecord, source: ArrayBuffer): Promise<void>;
  /** The bytes of a piece, or null if it has gone. */
  source(id: string): Promise<ArrayBuffer | null>;
  remove(id: string): Promise<void>;
}

const DB_NAME = 'brass-trainer-music';
const DB_VERSION = 1;
const RECORDS = 'pieces';
const SOURCES = 'sources';

/** Whether this browser can keep anything at all. */
export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SOURCES)) db.createObjectStore(SOURCES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** One transaction, resolved when it commits rather than when the request returns. */
function run<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T> | null,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = work(tx);
    let result: T | null = null;
    if (request) request.onsuccess = () => (result = request.result);
    // Waiting for `complete` rather than for the request: a write that returned
    // but whose transaction then aborted has not been kept.
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The real store, in IndexedDB. */
export function indexedDbStore(): PieceStore {
  return {
    async list() {
      const db = await open();
      const all = await run<PieceRecord[]>(db, [RECORDS], 'readonly', (tx) =>
        tx.objectStore(RECORDS).getAll(),
      );
      db.close();
      return newestFirst(all ?? []);
    },

    async put(record, source) {
      const db = await open();
      await run(db, [RECORDS, SOURCES], 'readwrite', (tx) => {
        tx.objectStore(RECORDS).put(record);
        tx.objectStore(SOURCES).put(source, record.id);
        return null;
      });
      db.close();
    },

    async source(id) {
      const db = await open();
      const bytes = await run<ArrayBuffer>(db, [SOURCES], 'readonly', (tx) =>
        tx.objectStore(SOURCES).get(id),
      );
      db.close();
      return bytes ?? null;
    },

    async remove(id) {
      const db = await open();
      await run(db, [RECORDS, SOURCES], 'readwrite', (tx) => {
        tx.objectStore(RECORDS).delete(id);
        tx.objectStore(SOURCES).delete(id);
        return null;
      });
      db.close();
    },
  };
}

/** A store that forgets when the tab does. For tests, and for a browser with none. */
export function memoryStore(): PieceStore {
  const records = new Map<string, PieceRecord>();
  const sources = new Map<string, ArrayBuffer>();
  return {
    list: async () => newestFirst([...records.values()]),
    put: async (record, source) => {
      records.set(record.id, record);
      sources.set(record.id, source);
    },
    source: async (id) => sources.get(id) ?? null,
    remove: async (id) => {
      records.delete(id);
      sources.delete(id);
    },
  };
}

/**
 * Newest first, which is what a practice library wants: the thing you are
 * working on now is the thing you opened last.
 */
function newestFirst(records: PieceRecord[]): PieceRecord[] {
  return [...records].sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Titles notation software writes when the player has written none.
 *
 * MuseScore exports `<work-title>Title</work-title>` from an untouched score,
 * and a real export did exactly that. Taken at face value every piece in the
 * library is called "Title", which is worse than having no title at all — a
 * list of them cannot be read. A placeholder is the *absence* of a title, so it
 * loses to the file name, which is at least what the player called the file.
 */
const PLACEHOLDER_TITLES = new Set(['title', 'untitled', 'untitled score', 'score', 'subtitle']);

function meaningful(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed || PLACEHOLDER_TITLES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/**
 * What to call a piece.
 *
 * The work title where the file carries a real one, because that is what the
 * player calls it; the file name otherwise, with its extension taken off. A
 * file named after the piece is the common case and `Death or Glory.mxl` reads
 * better as `Death or Glory`.
 */
export function titleFor(doc: Document, fileName: string): string {
  const work = meaningful(doc.querySelector('work > work-title')?.textContent);
  if (work) return work;
  const movement = meaningful(doc.querySelector('movement-title')?.textContent);
  if (movement) return movement;
  return fileName.replace(/\.(musicxml|xml|mxl)$/i, '') || fileName;
}

/**
 * Asks the browser not to evict the library.
 *
 * Storage is evictable by default, and a practice library quietly emptying
 * itself is the worst failure this feature has. Asking is all that can be done;
 * the answer is the browser's, and on some it depends on whether the app has
 * been installed to the home screen. Returns what it was told rather than
 * pretending.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    // A browser that refuses to be asked is a browser that has not promised
    // anything, which is the same answer as saying no.
    return false;
  }
}
