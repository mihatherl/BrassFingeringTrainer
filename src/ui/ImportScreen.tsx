import { useCallback, useState } from 'react';
import { instrumentById } from '../domain/instruments';
import { barCount } from '../domain/metre';
import type { Exercise } from '../exercise/types';
import { readScoreFile } from '../import/container';
import { parseMusicXml, partNames } from '../import/musicxml';
import { importPart } from '../import/part';
import type { Settings } from '../storage/settings';

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
}

interface Read {
  exercise: Exercise;
  problems: string[];
  part: string;
  from: string;
}

export function ImportScreen({ settings, onPlay, onBack }: ImportScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const readPart = useCallback(
    (source: Loaded, index: number) => {
      const { exercise, problems } = importPart(source.doc, {
        instrument: instrumentById(settings.instrumentId),
        partIndex: index,
        clef: settings.clef,
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
      const opened = await readScoreFile(await file.arrayBuffer());
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
      };
      setLoaded(source);
      // Straight to the first part: a single-part file is the common case and
      // should not need a choice made about it.
      readPart(source, 0);
      setBusy(false);
    },
    [readPart],
  );

  return (
    <div className="screen screen--centred">
      <header className="masthead">
        <h1>My Music</h1>
        <p>
          Open a MusicXML part — <code>.musicxml</code> or <code>.mxl</code>, as exported by
          MuseScore, Sibelius or Finale. Repeats, first- and second-time bars and D.S. jumps are
          played out in full.
        </p>
      </header>

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
            onChange={(event) => readPart(loaded, Number(event.target.value))}
          >
            {loaded.names.map((name, index) => (
              <option key={`${name}-${index}`} value={index}>
                {name}
              </option>
            ))}
          </select>
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
        <button type="button" className="button button--quiet" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
