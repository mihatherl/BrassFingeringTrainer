import { useState, type ReactNode } from 'react';
import { INSTRUMENTS, availableClefs, instrumentById, writtenRange } from '../domain/instruments';
import { describeFifths, MAJOR_KEYS, orderByCloseness } from '../domain/keys';
import { metreFor } from '../domain/metre';
import { formatPitch } from '../domain/pitch';
import { spellInKey } from '../domain/keys';
import { DIFFICULTIES } from '../exercise/difficulty';
import { isPattern, patternSpanFor } from '../exercise/generate';
import { EXERCISE_KINDS } from '../exercise/types';
import { toleranceFor } from '../engine/judge';
import type { ExerciseKind } from '../exercise/types';
import { styleName } from '../render/conductor';
import {
  BARS_OPTIONS,
  CONDUCTOR_STYLE_RANGE,
  CYCLE_OPTIONS,
  REGISTERS,
  THEME_OPTIONS,
  MAX_KEYS_IN_PLAY,
  sanitise,
  SCROLL_SPEED_RANGE,
  PLAYBACK_MODES,
  READING_MODES,
  TEMPO_RANGE,
  TIMING_TOLERANCE_RANGE,
  TIME_SIGNATURES,
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
  // What the tempo number counts, among other things: the beat is the pulse,
  // which is not the crotchet in compound time.
  const metre = metreFor(settings.beatsPerBar, settings.beatUnit);

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
      // Every key in play, opening one first, since a summary that named only
      // the first would hide the whole of a modulating exercise.
      settings.keySet.length > 1
        ? orderByCloseness(settings.fifths, settings.keySet)
            .map((f) => MAJOR_KEYS.find((k) => k.fifths === f)?.name)
            .filter(Boolean)
            .join(' → ')
        : keySignature && `${keySignature.name} major`,
      material?.name,
      patternKind ? difficulty.patterns.label : difficulty.name,
    ),
    reading: summarise(reading?.name),
    playback: summarise(
      `${settings.tempo} bpm`,
      settings.variableTempo ? 'variable' : undefined,
      sound?.name,
    ),
  };

  /*
   * Every section shut on arrival, every time.
   *
   * The state used to be remembered, which meant coming back from a run to
   * whatever had been left open — usually everything, since opening a section
   * is how you change anything. Shut, the whole screen is six lines saying
   * what is set and a Start button, which is what someone returning for
   * another go actually wants to see.
   */
  const [openPanels, setOpenPanels] = useState<string[]>([]);
  const isOpen = (id: string) => openPanels.includes(id);
  const setOpen = (id: string, open: boolean) => {
    setOpenPanels((current) =>
      open ? [...new Set([...current, id])] : current.filter((p) => p !== id),
    );
  };

  return (
    <div className="screen screen--settings">
      <header className="masthead">
        <h1>Brass Fingering Trainer</h1>
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
            onChange={(event) => {
              // The set always holds the key you start in; `sanitise` enforces
              // it, so changing the start carries the old one into the set
              // rather than dropping it.
              const fifths = Number(event.target.value);
              onChange(sanitise({ ...settings, fifths }));
            }}
          >
            {MAJOR_KEYS.map((key) => (
              <option key={key.fifths} value={key.fifths}>
                {key.name} major ({describeFifths(key.fifths)}) / {key.relativeMinor} minor
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field__label">Change key during the exercise</span>
          <div className="segmented segmented--wrap">
            {MAJOR_KEYS.map((key) => {
              const chosen = settings.keySet.includes(key.fifths);
              const start = key.fifths === settings.fifths;
              const full = settings.keySet.length >= MAX_KEYS_IN_PLAY;
              return (
                <button
                  key={key.fifths}
                  type="button"
                  // The starting key is always in play and cannot be removed;
                  // beyond the cap, only what is already chosen can be undone.
                  disabled={start || (!chosen && full)}
                  className={`segmented__option ${chosen ? 'is-selected' : ''}`}
                  onClick={() =>
                    onChange(
                      sanitise({
                        ...settings,
                        keySet: chosen
                          ? settings.keySet.filter((f) => f !== key.fifths)
                          : [...settings.keySet, key.fifths],
                      }),
                    )
                  }
                >
                  {key.name}
                </button>
              );
            })}
          </div>
        </div>

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
            {/* A scale is a shape played against a click rather than a piece
                with a metre, so it is always four-four; the choice is kept
                and comes back with the next material that has one. */}
            <select
              value={patternKind ? '4/4' : `${settings.beatsPerBar}/${settings.beatUnit}`}
              disabled={patternKind}
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
            {settings.kind === 'themes' ? (
              <select
                value={settings.themeCount}
                onChange={(event) => update('themeCount', Number(event.target.value))}
              >
                {THEME_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count === 1 ? 'One theme' : `${count} themes`}
                  </option>
                ))}
              </select>
            ) : patternKind ? (
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

        {/* Only where the compass leaves a choice to make: a two-octave scale
            takes most of a brass instrument and usually has one place to go. */}
        {patternKind && (
          <div className="field">
            <span className="field__label">Register</span>
            <div className="segmented">
              {REGISTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`segmented__option ${settings.register === option.id ? 'is-selected' : ''}`}
                  onClick={() => update('register', option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
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
          {/* Nothing on the page marks the beat in this mode, so something
              else has to — either will do, and the conductor is the better
              teacher of the two. */}
          {settings.readingMode === 'paged' &&
            !settings.metronomeEnabled &&
            !settings.conductorEnabled && (
              <p className="field__note muted">
                Turn on the metronome or the conductor below — in this mode nothing on the page
                keeps time for you.
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
          {/* Said out loud only where it is not obvious. In 4/4 the beat is
              the crotchet and nobody needs telling; in 6/8 the number counts
              dotted crotchets, two to the bar, which is the beat conducted
              and the one a march is quoted in. */}
          {metre.isCompound && (
            <p className="field__note muted">
              Dotted crotchets — {metre.pulsesPerBar} to the bar, the beat you count.
            </p>
          )}
        </label>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={settings.variableTempo}
            onChange={(event) => update('variableTempo', event.target.checked)}
          />
          <span>Variable tempo</span>
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

        {/* Only when there is a conductor to have a style. The screen was
            quietened on purpose, and a slider shaping something switched off
            is exactly the noise that was taken out of it. */}
        {settings.conductorEnabled && (
          <label className="field">
            <span className="field__label">
              Conductor style <strong>{styleName(settings.conductorStyle)}</strong>
            </span>
            <input
              type="range"
              min={CONDUCTOR_STYLE_RANGE.min}
              max={CONDUCTOR_STYLE_RANGE.max}
              step={0.05}
              value={settings.conductorStyle}
              onChange={(event) => update('conductorStyle', Number(event.target.value))}
            />
            <p className="field__note muted">
              How sharply the beat lands. Smooth is harder to follow, and meant to be.
            </p>
          </label>
        )}

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
