import { useState, type ReactNode } from 'react';
import { INSTRUMENTS, availableClefs, instrumentById, writtenRange } from '../domain/instruments';
import { describeFifths, MAJOR_KEYS } from '../domain/keys';
import { formatPitch } from '../domain/pitch';
import { spellInKey } from '../domain/keys';
import { DIFFICULTIES } from '../exercise/difficulty';
import { isPattern, patternSpanFor } from '../exercise/generate';
import { EXERCISE_KINDS } from '../exercise/types';
import { toleranceFor } from '../engine/judge';
import type { ExerciseKind } from '../exercise/types';
import {
  BARS_OPTIONS,
  CYCLE_OPTIONS,
  SCROLL_SPEED_RANGE,
  PLAYBACK_MODES,
  READING_MODES,
  TEMPO_RANGE,
  TIMING_TOLERANCE_RANGE,
  TIME_SIGNATURES,
  loadOpenPanels,
  saveOpenPanels,
  type Settings,
} from '../storage/settings';

/**
 * A collapsible settings section.
 *
 * Built on `<details>` rather than hand-rolled state, so it comes with keyboard
 * operation, the right roles for a screen reader and browser find-in-page
 * already working.
 */
interface PanelProps {
  id: string;
  title: string;
  /** What is currently chosen, shown only while the section is shut. */
  values: string;
  open: boolean;
  onToggle: (id: string, open: boolean) => void;
  children: ReactNode;
}

function Panel({ id, title, values, open, onToggle, children }: PanelProps) {
  return (
    <details
      className="panel"
      open={open}
      onToggle={(event) => onToggle(id, event.currentTarget.open)}
    >
      <summary className="panel__summary">
        <span className="panel__heading">
          <span className="panel__title">{title}</span>
          <span className="panel__values">{values}</span>
        </span>
      </summary>
      {children}
    </details>
  );
}

/** Joins the parts of a collapsed section's summary line. */
function summarise(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' · ');
}

/** Sections open the first time the app is used. */
const DEFAULT_OPEN_PANELS = ['exercise'];

function describeSpan(semitones: number): string {
  if (semitones >= 24) return 'two octaves';
  if (semitones >= 12) return 'one octave';
  if (semitones >= 7) return 'the first five notes';
  return 'a very short pattern';
}

interface SettingsScreenProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onStart: () => void;
}

export function SettingsScreen({ settings, onChange, onStart }: SettingsScreenProps) {
  const instrument = instrumentById(settings.instrumentId);
  const clefs = availableClefs(instrument);
  const [low, high] = writtenRange(instrument, settings.clef);
  const difficulty = DIFFICULTIES.find((d) => d.id === settings.difficultyId)!;

  // Scales and arpeggios are described by their reach rather than by a level
  // name, and that reach depends on whether the key's tonic leaves room for it.
  const patternKind = isPattern(settings.kind);
  const actualSpan = patternSpanFor(instrument, settings.clef, settings.fifths, difficulty);
  const shortenedSpan =
    patternKind && actualSpan < difficulty.patterns.spanSemitones ? describeSpan(actualSpan) : null;

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  // Enough of each section to see at a glance what is set, without reproducing
  // the whole screen in miniature — the long sections show only what matters.
  const keySignature = MAJOR_KEYS.find((k) => k.fifths === settings.fifths);
  const material = EXERCISE_KINDS.find((k) => k.id === settings.kind);
  const reading = READING_MODES.find((m) => m.id === settings.readingMode);
  const sound = PLAYBACK_MODES.find((m) => m.id === settings.playbackMode);

  const panelValues = {
    instrument: summarise(instrument.name, settings.clef === 'treble' ? 'Treble' : 'Bass'),
    exercise: summarise(
      keySignature && `${keySignature.name} major`,
      material?.name,
      patternKind ? difficulty.patterns.label : difficulty.name,
    ),
    reading: summarise(reading?.name),
    playback: summarise(`${settings.tempo} bpm`, sound?.name),
  };

  const [openPanels, setOpenPanels] = useState(() => loadOpenPanels(DEFAULT_OPEN_PANELS));
  const isOpen = (id: string) => openPanels.includes(id);
  const setOpen = (id: string, open: boolean) => {
    setOpenPanels((current) => {
      const next = open ? [...new Set([...current, id])] : current.filter((p) => p !== id);
      saveOpenPanels(next);
      return next;
    });
  };

  return (
    <div className="screen screen--settings">
      <header className="masthead">
        <h1>Brass Fingering Trainer</h1>
        <p className="muted">
          Hold the right valves as each note crosses the line.
        </p>
      </header>

      <Panel id="instrument" title="Instrument" values={panelValues.instrument} open={isOpen('instrument')} onToggle={setOpen}>

        <label className="field">
          <span className="field__label">Instrument</span>
          <select
            value={settings.instrumentId}
            onChange={(event) => {
              const next = instrumentById(event.target.value);
              const clef = availableClefs(next).includes(settings.clef)
                ? settings.clef
                : availableClefs(next)[0];
              onChange({ ...settings, instrumentId: next.id, clef });
            }}
          >
            {INSTRUMENTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field__label">Clef</span>
          <div className="segmented">
            {clefs.map((clef) => (
              <button
                key={clef}
                type="button"
                className={`segmented__option ${settings.clef === clef ? 'is-selected' : ''}`}
                onClick={() => update('clef', clef)}
              >
                {clef === 'treble' ? 'Treble' : 'Bass'}
              </button>
            ))}
          </div>
          {clefs.length === 1 && (
            <p className="field__note muted">{instrument.name} reads treble clef only.</p>
          )}
        </div>

        <p className="field__note muted">
          Written range {formatPitch(spellInKey(low, settings.fifths))} to{' '}
          {formatPitch(spellInKey(high, settings.fifths))}
          {settings.clef === 'bass' ? ' (concert pitch)' : ''}.
        </p>
      </Panel>

      <Panel id="exercise" title="Exercise" values={panelValues.exercise} open={isOpen('exercise')} onToggle={setOpen}>

        <label className="field">
          <span className="field__label">Key signature (as written)</span>
          <select
            value={settings.fifths}
            onChange={(event) => update('fifths', Number(event.target.value))}
          >
            {MAJOR_KEYS.map((key) => (
              <option key={key.fifths} value={key.fifths}>
                {key.name} major ({describeFifths(key.fifths)}) / {key.relativeMinor} minor
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field__label">Material</span>
          <div className="cards">
            {EXERCISE_KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                className={`card ${settings.kind === kind.id ? 'is-selected' : ''}`}
                onClick={() => update('kind', kind.id as ExerciseKind)}
              >
                <strong>{kind.name}</strong>
                <span className="muted">{kind.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Difficulty</span>
          <div className="segmented segmented--wrap">
            {DIFFICULTIES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`segmented__option ${settings.difficultyId === option.id ? 'is-selected' : ''}`}
                onClick={() => update('difficultyId', option.id)}
              >
                {/* For scales and arpeggios the useful thing to know is how far
                    the pattern reaches, not what the level is called. */}
                {patternKind ? option.patterns.label : option.name}
              </button>
            ))}
          </div>
          <p className="field__note muted">
            {patternKind ? difficulty.patterns.blurb : difficulty.blurb}
          </p>
          {patternKind && shortenedSpan && (
            <p className="field__note muted">
              {instrument.name} in {MAJOR_KEYS.find((k) => k.fifths === settings.fifths)?.name} has
              only room for {shortenedSpan}, so that is what you will get — the tonic sits too high
              for anything further.
            </p>
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Time signature</span>
            <select
              value={`${settings.beatsPerBar}/${settings.beatUnit}`}
              onChange={(event) => {
                const [beatsPerBar, beatUnit] = event.target.value.split('/').map(Number);
                onChange({ ...settings, beatsPerBar, beatUnit });
              }}
            >
              {TIME_SIGNATURES.map((time) => (
                <option key={time.label} value={`${time.beatsPerBar}/${time.beatUnit}`}>
                  {time.label}
                </option>
              ))}
            </select>
          </label>

          {/* A scale is measured in times through rather than in bars: the
              cycle is the thing being practised, and how many bars it fills
              follows from how many notes it has. */}
          <label className="field">
            <span className="field__label">Length</span>
            {patternKind ? (
              <select
                value={settings.cycles}
                onChange={(event) => update('cycles', Number(event.target.value))}
              >
                {CYCLE_OPTIONS.map((cycles) => (
                  <option key={cycles} value={cycles}>
                    {cycles === 1 ? 'Once through' : `${cycles} times through`}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={settings.bars}
                onChange={(event) => update('bars', Number(event.target.value))}
              >
                {BARS_OPTIONS.map((bars) => (
                  <option key={bars} value={bars}>
                    {bars} bars
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>
      </Panel>

      <Panel id="reading" title="Reading mode" values={panelValues.reading} open={isOpen('reading')} onToggle={setOpen}>

        <div className="field">
          <div className="cards">
            {READING_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`card ${settings.readingMode === mode.id ? 'is-selected' : ''}`}
                onClick={() => update('readingMode', mode.id)}
              >
                <strong>{mode.name}</strong>
                <span className="muted">{mode.blurb}</span>
              </button>
            ))}
          </div>
          {settings.readingMode === 'paged' && !settings.metronomeEnabled && (
            <p className="field__note muted">
              Turn the metronome on below — in this mode it is the only thing keeping time.
            </p>
          )}
        </div>
      </Panel>

      <Panel id="playback" title="Playback" values={panelValues.playback} open={isOpen('playback')} onToggle={setOpen}>

        <label className="field">
          <span className="field__label">
            Tempo <strong>{settings.tempo}</strong> bpm
          </span>
          <input
            type="range"
            min={TEMPO_RANGE.min}
            max={TEMPO_RANGE.max}
            step={1}
            value={settings.tempo}
            onChange={(event) => update('tempo', Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span className="field__label">
            Scroll speed <strong>{settings.scrollSpeed}</strong>
          </span>
          <input
            type="range"
            min={SCROLL_SPEED_RANGE.min}
            max={SCROLL_SPEED_RANGE.max}
            step={10}
            value={settings.scrollSpeed}
            onChange={(event) => update('scrollSpeed', Number(event.target.value))}
          />
          <p className="field__note muted">
            How fast the music travels across the screen. The same on every device and at every
            tempo — a bigger screen shows more bars rather than moving faster. Dense runs of short
            notes may still go past quicker, so they stay far enough apart to read.
          </p>
        </label>

        <div className="field">
          <span className="field__label">Sound</span>
          <div className="cards">
            {PLAYBACK_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`card ${settings.playbackMode === mode.id ? 'is-selected' : ''}`}
                onClick={() => update('playbackMode', mode.id)}
              >
                <strong>{mode.name}</strong>
                <span className="muted">{mode.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={settings.metronomeEnabled}
            onChange={(event) => update('metronomeEnabled', event.target.checked)}
          />
          <span>Metronome</span>
        </label>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={settings.conductorEnabled}
            onChange={(event) => update('conductorEnabled', event.target.checked)}
          />
          <span>Conductor</span>
        </label>
        <p className="field__note muted">
          A baton beating the bar, beside the notes you have played. Not either/or with the
          metronome — watch the stick while hearing the click, then turn the click off. Upright
          screens only, and not for metres it has no pattern for.
        </p>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={settings.weakNoteDrilling}
            onChange={(event) => update('weakNoteDrilling', event.target.checked)}
          />
          <span>Favour notes I get wrong</span>
        </label>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={settings.fingeringHints}
            onChange={(event) => update('fingeringHints', event.target.checked)}
          />
          <span>Show fingerings for notes I get wrong</span>
        </label>
        <p className="field__note muted">
          Printed above the note, and only where there is time to read one — never in a run, and
          at most one to a bar.
        </p>

        <label className="field">
          <span className="field__label">
            Timing tolerance{' '}
            <strong>
              {/* Quoted for a crotchet, which is the note the figure is easiest
                  to picture against. */}
              ±{Math.round(toleranceFor(60 / settings.tempo, settings.timingTolerance) * 1000)} ms
            </strong>
          </span>
          <input
            type="range"
            min={TIMING_TOLERANCE_RANGE.min * 100}
            max={TIMING_TOLERANCE_RANGE.max * 100}
            step={25}
            value={Math.round(settings.timingTolerance * 100)}
            onChange={(event) => update('timingTolerance', Number(event.target.value) / 100)}
          />
          <p className="field__note muted">
            How far off the beat a fingering still counts, shown here for a crotchet at{' '}
            {settings.tempo} bpm. Shorter notes get proportionally less. Reading a note and then
            moving takes most people around 200 ms, so give yourself room if you are sight-reading
            rather than playing from memory.
          </p>
        </label>

        <label className="field">
          <span className="field__label">Count-in</span>
          <select
            value={settings.countInBars}
            onChange={(event) => update('countInBars', Number(event.target.value))}
          >
            <option value={0}>None</option>
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
          </select>
        </label>
      </Panel>

      {/* CC-BY requires the attribution to travel with the app itself, not only
          with the source, so it lives here rather than only in the README. */}
      <p className="field__note muted credits">
        Instrument samples from FluidR3_GM by Frank Wen, licensed{' '}
        <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">
          CC-BY 3.0
        </a>
        . Notation drawn with Bravura by Steinberg, SIL OFL 1.1.
      </p>
      {/* So a stale cached copy announces itself rather than being mistaken for
          a change that did not work. */}
      <p className="field__note muted credits">
        v{__APP_VERSION__} · build {__BUILD_TIME__}
      </p>

      <div className="actions actions--sticky">
        <button type="button" className="button button--primary button--large" onClick={onStart}>
          Start
        </button>
      </div>
    </div>
  );
}
