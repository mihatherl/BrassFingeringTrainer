import { useCallback, useEffect, useState } from 'react';
import { instrumentById } from '../domain/instruments';
import { barCount } from '../domain/metre';
import type { Exercise } from '../exercise/types';
import { readScoreFile } from '../import/container';
import { parseMusicXml, partNames } from '../import/musicxml';
import { importPart, type Divisi } from '../import/part';
import type { Settings } from '../storage/settings';
import {
  indexedDbStore,
  memoryStore,
  requestPersistence,
  storageAvailable,
  type PieceRecord,
} from '../storage/library';
import { openPiece, savePiece } from '../storage/pieces';

/**
 * My Music: choosing a file and reading a part out of it.
 *
 * A plain `<input type="file">` rather than the File System Access API, which
 * is Chromium-only and absent on iOS — this is an app for a rehearsal room, and
 * a picker that does not exist on a phone is not a picker. See
 * `docs/musicxml-import-plan.md`.
 *
 * The screen exists to say what happened. An import that quietly drops a
 * second voice or reduces chords has changed the music, and the player is the
 * only one who can judge whether that matters — so what could not be read is
 * shown before anything is played, counted and named, never "some content could
 * not be imported".
 */

interface ImportScreenProps {
  settings: Settings;
  onPlay: (exercise: Exercise) => void;
  onBack: () => void;
}

interface Loaded {
  doc: Document;
  names: string[];
  fileName: string;
  /** Kept so the piece can be saved with the bytes it was read from. */
  source: ArrayBuffer;
}

/**
 * Where the library lives.
 *
 * Made once rather than per render, and falling back to memory where the
 * browser has no IndexedDB — a private window, mostly. The screen then works
 * for this session and says nothing was kept, which beats refusing to open a
 * file at all.
 */
const STORE = storageAvailable() ? indexedDbStore() : memoryStore();

interface Read {
  exercise: Exercise;
  problems: string[];
  part: string;
  from: string;
  /** Whether the part divides anywhere, which decides whether to offer a choice. */
  divides: boolean;
}

export function ImportScreen({ settings, onPlay, onBack }: ImportScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [divisi, setDivisi] = useState<Divisi>('upper');
  const [partIndex, setPartIndex] = useState(0);
  const [library, setLibrary] = useState<PieceRecord[]>([]);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(() => {
    void STORE.list().then(setLibrary);
  }, []);
  useEffect(refresh, [refresh]);

  const readPart = useCallback(
    (source: Loaded, index: number, line: Divisi) => {
      const { exercise, problems } = importPart(source.doc, {
        instrument: instrumentById(settings.instrumentId),
        partIndex: index,
        clef: settings.clef,
        divisi: line,
      });

      if (!exercise) {
        setRead(null);
        setProblem(problems[0] ?? 'nothing in this part could be read');
        return;
      }
      setProblem(null);
      setRead({
        exercise,
        problems,
        part: source.names[index] ?? 'the part',
        from: source.fileName,
        divides: problems.some((line) => line.includes('divided note')),
      });
    },
    [settings.instrumentId, settings.clef],
  );

  const choose = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      setRead(null);
      setLoaded(null);
      setProblem(null);

      // Decided from the bytes rather than the extension: a `.musicxml` that is
      // really a zip and an `.mxl` that is really plain XML both turn up.
      const bytes = await file.arrayBuffer();
      const opened = await readScoreFile(bytes);
      if ('problem' in opened) {
        setProblem(opened.problem);
        setBusy(false);
        return;
      }

      const parsed = parseMusicXml(opened.xml);
      if ('problem' in parsed) {
        setProblem(parsed.problem);
        setBusy(false);
        return;
      }

      const source: Loaded = {
        doc: parsed.doc,
        names: partNames(parsed.doc),
        fileName: file.name,
        source: bytes,
      };
      setLoaded(source);
      setPartIndex(0);
      // Straight to the first part: a single-part file is the common case and
      // should not need a choice made about it.
      setSaved(false);
      readPart(source, 0, divisi);
      setBusy(false);
    },
    [readPart, divisi],
  );

  const keep = useCallback(async () => {
    if (!loaded || !read) return;
    // Asked for on the first save rather than at start-up: a browser is more
    // likely to grant persistence to an app the player has actually put
    // something into, and asking before they have is a prompt about nothing.
    void requestPersistence();
    await savePiece(STORE, {
      fileName: loaded.fileName,
      source: loaded.source,
      doc: loaded.doc,
      partIndex,
      divisi,
      bars: barCount(read.exercise.metres, read.exercise.totalBeats),
      notes: read.exercise.notes.length,
    });
    setSaved(true);
    refresh();
  }, [loaded, read, partIndex, divisi, refresh]);

  const open = useCallback(
    async (record: PieceRecord) => {
      setBusy(true);
      setProblem(null);
      const result = await openPiece(STORE, record, {
        instrument: instrumentById(settings.instrumentId),
        clef: settings.clef,
      });
      setBusy(false);

      if ('problem' in result) {
        setProblem(result.problem);
        return;
      }
      onPlay(result.imported.exercise!);
    },
    [settings.instrumentId, settings.clef, onPlay],
  );

  const forget = useCallback(
    async (record: PieceRecord) => {
      await STORE.remove(record.id);
      refresh();
    },
    [refresh],
  );

  return (
    <div className="screen">
      <header className="masthead">
        <h1>My Music</h1>
        <p>
          Open a MusicXML part — <code>.musicxml</code> or <code>.mxl</code>, as exported by
          MuseScore, Sibelius or Finale. Repeats, first- and second-time bars and D.S. jumps are
          played out in full.
        </p>
      </header>

      {library.length > 0 && (
        <ul className="library">
          {library.map((piece) => (
            <li key={piece.id} className="library__item">
              <button
                type="button"
                className="library__open"
                onClick={() => void open(piece)}
                disabled={busy}
              >
                <span className="library__title">{piece.title}</span>
                <span className="library__detail">
                  {piece.partName} · {piece.bars} bars
                </span>
              </button>
              <button
                type="button"
                className="button button--quiet library__forget"
                onClick={() => void forget(piece)}
                aria-label={`Forget ${piece.title}`}
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="button button--primary button--large import__choose">
        {busy ? 'Reading…' : 'Choose a file'}
        <input
          type="file"
          accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml"
          className="import__input"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </label>

      {problem !== null && (
        <p className="import__problem" role="alert">
          {problem}
        </p>
      )}

      {loaded && loaded.names.length > 1 && (
        <label className="field">
          <span className="field__label">Which part</span>
          <select
            value={partIndex}
            onChange={(event) => {
              const next = Number(event.target.value);
              setPartIndex(next);
              readPart(loaded, next, divisi);
            }}
          >
            {loaded.names.map((name, index) => (
              <option key={`${name}-${index}`} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}

      {loaded && read?.divides && (
        <label className="field">
          <span className="field__label">Where the part divides, play the</span>
          <select
            value={divisi}
            onChange={(event) => {
              const next = event.target.value as Divisi;
              setDivisi(next);
              readPart(loaded, partIndex, next);
            }}
          >
            <option value="upper">Upper line</option>
            <option value="lower">Lower line</option>
          </select>
          <p className="field__note">
            One line is read, so the notation, the playback and what you are marked against all
            agree — whichever your section gave you. Where the two are an octave apart the
            fingering is the same either way.
          </p>
        </label>
      )}

      {read && (
        <section className="import__summary">
          <h2>{read.part}</h2>
          <p className="import__count">
            {barCount(read.exercise.metres, read.exercise.totalBeats)} bars,{' '}
            {read.exercise.notes.length} notes — from {read.from}
          </p>
          {/*
            * The bar count is the *played* one, which is larger than the
            * printed part wherever a repeat was unfolded. Said plainly here
            * rather than left to surprise someone counting along.
            */}

          {read.problems.length > 0 && (
            <>
              {/*
                * Shown before playing, not after. An import that dropped a
                * second voice has changed the music, and whether that matters
                * is the player's judgement to make against the printed part.
                */}
              <p className="import__warnings-heading">Read with changes:</p>
              <ul className="import__warnings">
                {read.problems.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <div className="actions actions--sticky">
        {read && (
          <button
            type="button"
            className="button button--primary button--large"
            onClick={() => onPlay(read.exercise)}
          >
            Play it
          </button>
        )}
        {read && (
          <button type="button" className="button" onClick={() => void keep()} disabled={saved}>
            {saved ? 'Kept in My Music' : 'Keep it'}
          </button>
        )}
        {read && !storageAvailable() && (
          <p className="field__note">
            This browser will not keep anything between sessions — a private window, most likely.
            The piece will play now and be gone when the tab is.
          </p>
        )}
        <button type="button" className="button button--quiet" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
