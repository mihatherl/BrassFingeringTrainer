/**
 * Putting a piece into the library, and getting it back out playable.
 *
 * The seam between `library.ts`, which knows about storage and nothing about
 * music, and `import/`, which knows about music and nothing about storage.
 *
 * **Opening re-reads the file.** A record keeps the bytes and the choices made
 * when it was first read; opening runs those bytes back through the importer
 * with today's instrument. So a piece improves when the importer does, and
 * changing instrument re-fingers the music — see the note on `library.ts` for
 * why that is worth the extra work over storing the finished exercise.
 */

import type { Clef, Instrument } from '../domain/instruments';
import { readScoreFile } from '../import/container';
import { parseMusicXml, partNames } from '../import/musicxml';
import { importPart, type Divisi, type Imported } from '../import/part';
import { barCount } from '../domain/metre';
import { titleFor, type PieceRecord, type PieceStore } from './library';

export interface SaveOptions {
  fileName: string;
  source: ArrayBuffer;
  doc: Document;
  partIndex: number;
  divisi: Divisi;
  /** As read, for the list. */
  bars: number;
  notes: number;
}

/**
 * A new identifier.
 *
 * `crypto.randomUUID` where it exists, which is everywhere the app runs, and a
 * timestamped fallback for anywhere it does not — an id only has to be unique
 * within one player's own library.
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Adds a piece, keeping its bytes and how it was read.
 *
 * **Keeping the same part of the same file again replaces it rather than adding
 * a second copy.** Re-exporting a piece after correcting it is the ordinary way
 * to work — the player did it three times in one morning — and a library that
 * grew a row each time would fill with stale duplicates of one march, every one
 * of them looking equally current.
 *
 * A different *part* of the same file is a different piece, because practising
 * two of them is a real thing to want.
 */
export async function savePiece(store: PieceStore, options: SaveOptions): Promise<PieceRecord> {
  const existing = (await store.list()).find(
    (piece) => piece.fileName === options.fileName && piece.partIndex === options.partIndex,
  );

  const record: PieceRecord = {
    // The same id, so the replacement takes the old one's place rather than
    // sitting beside it.
    id: existing?.id ?? newId(),
    title: titleFor(options.doc, options.fileName),
    fileName: options.fileName,
    partIndex: options.partIndex,
    partName: partNames(options.doc)[options.partIndex] ?? 'the part',
    divisi: options.divisi,
    addedAt: Date.now(),
    bars: options.bars,
    notes: options.notes,
  };
  await store.put(record, options.source);
  return record;
}

export type Opened =
  | {
      imported: Imported;
      record: PieceRecord;
      /**
       * The parsed score, handed back rather than dropped.
       *
       * Reading it again is what lets a saved piece be read *differently* —
       * a passage of it rather than the whole — without going back to the
       * bytes and parsing them twice. The importer takes a document and a
       * reading, so the document is the thing worth keeping hold of.
       */
      doc: Document;
      /** The bytes it was read from, for a screen that may want to keep it again. */
      source: ArrayBuffer;
    }
  | { problem: string };

/**
 * Reads a saved piece back, with today's instrument and the choices it was
 * saved with.
 *
 * Every failure here means the library and what is in it have got out of step,
 * which a player can do nothing about except be told plainly which piece is
 * the problem.
 */
export async function openPiece(
  store: PieceStore,
  record: PieceRecord,
  options: { instrument: Instrument; clef?: Clef },
): Promise<Opened> {
  const source = await store.source(record.id);
  if (!source) return { problem: `“${record.title}” is in the list but its file has gone` };

  const opened = await readScoreFile(source);
  if ('problem' in opened) return { problem: `“${record.title}” could not be opened: ${opened.problem}` };

  const parsed = parseMusicXml(opened.xml);
  if ('problem' in parsed) return { problem: `“${record.title}” could not be read: ${parsed.problem}` };

  const imported = importPart(parsed.doc, {
    instrument: options.instrument,
    clef: options.clef,
    partIndex: record.partIndex,
    divisi: record.divisi,
  });
  if (!imported.exercise) {
    return { problem: imported.problems[0] ?? `nothing in “${record.title}” could be read` };
  }

  return { imported, record, doc: parsed.doc, source };
}

/** How a piece reads today, for keeping the list honest after a re-read. */
export function measure(imported: Imported): { bars: number; notes: number } {
  const exercise = imported.exercise;
  if (!exercise) return { bars: 0, notes: 0 };
  return {
    bars: barCount(exercise.metres, exercise.totalBeats),
    notes: exercise.notes.length,
  };
}
