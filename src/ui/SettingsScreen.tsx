import { useEffect, useRef, useState, type ReactNode } from 'react';
import { INSTRUMENTS, availableClefs, instrumentById, writtenRange } from '../domain/instruments';
import { describeFifths, MAJOR_KEYS, orderByCloseness } from '../domain/keys';
import { metreFor } from '../domain/metre';
import { FREE_TIER, isLimited, type Entitlements } from '../licensing/entitlements';
import { formatPitch } from '../domain/pitch';
import { spellInKey } from '../domain/keys';
import { DIFFICULTIES } from '../exercise/difficulty';
import { isPattern, patternSpanFor } from '../exercise/generate';
import { EXERCISE_KINDS } from '../exercise/types';
import { toleranceFor } from '../engine/judge';
import type { ExerciseKind } from '../exercise/types';
import { styleName } from '../render/conductor';
import { RangePicker } from './RangePicker';
import {
  CONDUCTOR_STYLE_RANGE,
  REGISTERS,
  DEFAULT_SETTINGS,
  FINGERING_MODES,
  MAX_KEYS_IN_PLAY,
  constrainToEntitlements,
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

/**
 * Keys to a row, which decides what the window opens on.
 *
 * Five, and not an arbitrary five: fifteen keys in rows of five puts B flat, F,
 * C, G and D — two flats to two sharps — in the middle row on their own, which
 * is where nearly all brass band reading lives. The rows either side hold the
 * keys a player goes looking for rather than the ones they land on.
 */
const KEYS_PER_ROW = 5;

const KEY_ROWS = Array.from(
  { length: Math.ceil(MAJOR_KEYS.length / KEYS_PER_ROW) },
  (_, row) => MAJOR_KEYS.slice(row * KEYS_PER_ROW, row * KEYS_PER_ROW + KEYS_PER_ROW),
);

/** Joins the parts of a collapsed section's summary line. */
function summarise(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' · ');
}

/**
 * A key's accidentals as a symbol and a count: `3♭`, `2♯`, or nothing for C.
 *
 * Enough for a player to recognise a key they half-know without the sentence
 * the dropdown used to spell out. The full wording is still there for a screen
 * reader, which cannot make anything of a sharp sign on its own.
 */
function accidentalCount(fifths: number): string {
  if (fifths === 0) return '';
  return `${Math.abs(fifths)}${fifths > 0 ? '♯' : '♭'}`;
}

function describeSpan(semitones: number): string {
  if (semitones >= 24) return 'two octaves';
  if (semitones >= 12) return 'one octave';
  if (semitones >= 7) return 'the first five notes';
  return 'a very short pattern';
}

interface SettingsScreenProps {
  settings: Settings;
  /**
   * What this copy is allowed to do, so the screen can say what it cannot
   * rather than accepting the choice and quietly substituting later.
   *
   * Read during render rather than captured, because entitlements can change
   * while the screen is open — `App` subscribes to them, so a purchase
   * mid-session re-renders this.
   */
  entitlements: Entitlements;
  onChange: (settings: Settings) => void;
  onStart: () => void;
  /** Opens My Music, where a part is read out of a file rather than generated. */
  onImport: () => void;
}

export function SettingsScreen({
  settings,
  entitlements,
  onChange,
  onStart,
  onImport,
}: SettingsScreenProps) {
  /*
   * What will actually be played, as against what is stored.
   *
   * Every *value* on this screen is read from `shown`, and every write goes to
   * `settings`. That split is the whole point: disabling the withheld controls
   * stops a locked choice being made, but it does nothing about one already
   * held — a fresh install defaults to E flat, so a free copy sat there saying
   * "E flat major" while the generator built the exercise in C. The screen has
   * to state what will happen, not what was once asked for.
   *
   * The stored choice survives untouched underneath, which is the reason not to
   * simply overwrite it: a licence returning should bring back the key the
   * player had picked, not the substitute they were given meanwhile.
   */
  const shown = constrainToEntitlements(settings, entitlements);

  const instrument = instrumentById(settings.instrumentId);
  const clefs = availableClefs(instrument);
  const [low, high] = writtenRange(instrument, settings.clef);
  const difficulty = DIFFICULTIES.find((d) => d.id === shown.difficultyId)!;

  // What the tempo number counts, among other things: the beat is the pulse,
  // which is not the crotchet in compound time.
  const metre = metreFor(settings.beatsPerBar, settings.beatUnit);

  // Scales and arpeggios are described by their reach rather than by a level
  // name, and that reach depends on whether the key's tonic leaves room for it.
  const patternKind = isPattern(shown.kind);
  const actualSpan = patternSpanFor(instrument, settings.clef, shown.fifths, difficulty);
  const shortenedSpan =
    patternKind && actualSpan < difficulty.patterns.spanSemitones ? describeSpan(actualSpan) : null;

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  /*
   * What this copy withholds, asked in the form each control needs.
   *
   * Derived here rather than stored, so a purchase mid-session simply
   * re-renders into an unlocked screen. Every one of these mirrors a clause of
   * `constrainToEntitlements`, which stays exactly as it is: that is the
   * backstop for settings which outlive the screen — saved before a licence
   * lapsed, or edited in storage — and this is the screen being honest in
   * front of it, not a replacement for it.
   *
   * The free tier's limits are *values*, not merely flags, so a withheld
   * control can be shown in its place rather than hidden. Hiding would make the
   * app look smaller than it is and give nobody a reason to buy; disabling
   * shows the shape of what is on offer.
   */
  const locked = {
    key: (fifths: number) => !entitlements.allKeys && fifths !== FREE_TIER.fifths,
    kind: (id: string) =>
      !entitlements.allMaterial && !FREE_TIER.kinds.includes(id as ExerciseKind),
    difficulty: (id: string) =>
      !entitlements.allDifficulties && !FREE_TIER.difficultyIds.includes(id),
    reading: (id: string) => !entitlements.pagedReading && id !== FREE_TIER.readingMode,
  };

  // Enough of each section to see at a glance what is set, without reproducing
  // the whole screen in miniature — the long sections show only what matters.
  const keySignature = MAJOR_KEYS.find((k) => k.fifths === shown.fifths);
  const material = EXERCISE_KINDS.find((k) => k.id === shown.kind);
  const reading = READING_MODES.find((m) => m.id === shown.readingMode);
  const sound = PLAYBACK_MODES.find((m) => m.id === settings.playbackMode);

  const panelValues = {
    instrument: summarise(instrument.name, settings.clef === 'treble' ? 'Treble' : 'Bass'),
    exercise: summarise(
      // Every key in play, opening one first, since a summary that named only
      // the first would hide the whole of a modulating exercise.
      shown.keySet.length > 1
        ? orderByCloseness(shown.fifths, shown.keySet)
            .map((f) => MAJOR_KEYS.find((k) => k.fifths === f)?.name)
            .filter(Boolean)
            .join(' → ')
        : keySignature && `${keySignature.name} major`,
      material?.name,
      patternKind ? difficulty.patterns.label : difficulty.name,
      // Only when it has been asked for. Left to the difficulty it is not a
      // choice the player made, and a summary should not recite the defaults.
      !patternKind && settings.kind !== 'themes' && settings.range
        ? `${formatPitch(spellInKey(settings.range.low, shown.fifths))}–${formatPitch(
            spellInKey(settings.range.high, shown.fifths),
          )}`
        : undefined,
    ),
    playing: summarise(
      reading?.name,
      sound?.name,
      settings.conductorEnabled ? 'conductor' : settings.metronomeEnabled ? 'metronome' : undefined,
    ),
    // Only what has been moved off its default, so a section nobody has opened
    // says nothing rather than reciting the settings it came with.
    advanced: summarise(
      settings.variableTempo ? 'variable tempo' : undefined,
      settings.countInBars !== DEFAULT_SETTINGS.countInBars
        ? settings.countInBars === 0
          ? 'no count-in'
          : `${settings.countInBars}-bar count-in`
        : undefined,
      settings.timingTolerance !== DEFAULT_SETTINGS.timingTolerance ? 'timing' : undefined,
      settings.scrollSpeed !== DEFAULT_SETTINGS.scrollSpeed ? 'scroll speed' : undefined,
      settings.conductorStyle !== DEFAULT_SETTINGS.conductorStyle ? 'conductor style' : undefined,
      shown.weakNoteDrilling !== DEFAULT_SETTINGS.weakNoteDrilling ? 'weak notes' : undefined,
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

  /*
   * Which row of keys the window rests on.
   *
   * The window is two rows tall and the rows are three, so it shows one row
   * whole with half of a row above and below — enough to say *there is more this
   * way* without a scrollbar having to say it, and enough that a thumb knows
   * which way to move.
   *
   * It opens on the row holding the key the exercise starts in, rather than
   * always on the middle one. Nearly always they are the same row: two flats to
   * two sharps is the middle five by construction, and that is where brass band
   * reading lives. When they are not — an Eb player, which is the default — a
   * control that opened with the current choice half out of sight would be
   * hiding the one thing it most has to say.
   *
   * Set when the section opens rather than on mount: a shut `<details>` hides
   * its children outright, and an element with no box has no scroll to set.
   */
  const keysWindow = useRef<HTMLDivElement>(null);
  const exerciseOpen = isOpen('exercise');
  const startingKey = shown.keySet[0];

  useEffect(() => {
    const window_ = keysWindow.current;
    if (!window_ || !exerciseOpen) return;
    const row = window_.children[
      Math.floor(MAJOR_KEYS.findIndex((k) => k.fifths === startingKey) / KEYS_PER_ROW)
    ] as HTMLElement | undefined;
    if (!row) return;
    // Centred by hand rather than by `scrollIntoView`, which would also scroll
    // the page to bring the window itself into view — and the player has just
    // opened the section, so the page is already where they put it.
    window_.scrollTop = row.offsetTop - (window_.clientHeight - row.offsetHeight) / 2;
  }, [exerciseOpen, startingKey]);


  /*
   * The fields a material's box holds, built here and placed by the accordion
   * below rather than laid out in one fixed column.
   *
   * Every one of them applies to some materials and not to others, which is the
   * whole reason the boxes exist: a register is a question about where a scale
   * sits and means nothing to a written tune, a range is a question about the
   * pool free material is drawn from and means nothing to either.
   *
   * Values rather than components, so they close over `settings`, `shown`,
   * `locked` and `update` exactly as they did when they were written inline —
   * and so that each is plainly the same one control wherever it is shown.
   */
  const keysField = (
    <div className="field">
      <span className="field__label">Keys</span>
      {/*
        One control for keys, not two.

        There used to be a dropdown naming the starting key and a grid naming the
        keys in play, which said the same thing twice: `keySet[0]` *is* the
        starting key and always was. The pair also needed a rule to keep them
        agreeing — the starting key's chip could not be deselected — which is a
        rule that only existed because there were two controls.

        Pick keys in the order you want them. The first is where the exercise
        opens; the collapsed summary spells the whole route out, so the order is
        never a secret you have to remember choosing.
      */}
      <div className="keys" ref={keysWindow}>
        {KEY_ROWS.map((row) => (
          <div className="keys__row" key={row[0].fifths}>
            {row.map((key) => {
              const chosen = shown.keySet.includes(key.fifths);
              const start = shown.keySet[0] === key.fifths;
              const full = shown.keySet.length >= MAX_KEYS_IN_PLAY;
              const only = chosen && shown.keySet.length === 1;
              return (
                <button
                  key={key.fifths}
                  type="button"
                  /*
                   * Beyond the cap only what is already chosen can be undone,
                   * and the last one standing cannot be — an exercise has to be
                   * in some key. Neither is a *withheld* control, which is why
                   * the locked marker is separate from the disabled attribute.
                   */
                  disabled={only || (!chosen && full) || locked.key(key.fifths)}
                  aria-pressed={chosen}
                  // The accidentals are shown as "3♭" beside the name, which a
                  // screen reader would spell out as a number and a symbol.
                  aria-label={`${key.name} major, ${describeFifths(key.fifths)}`}
                  className={`segmented__option key ${chosen ? 'is-selected' : ''} ${
                    start ? 'is-start' : ''
                  } ${locked.key(key.fifths) ? 'is-locked' : ''}`}
                  onClick={() => {
                    const next = chosen
                      ? settings.keySet.filter((f) => f !== key.fifths)
                      : [...settings.keySet, key.fifths];
                    if (next.length === 0) return;
                    onChange(sanitise({ ...settings, keySet: next }));
                  }}
                >
                  <span className="key__name">{key.name}</span>
                  <span className="key__accidentals muted">{accidentalCount(key.fifths)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {shown.keySet.length > 1 && (
        <p className="field__note muted">
          Starts in {MAJOR_KEYS.find((k) => k.fifths === shown.keySet[0])?.name}, and changes key
          as it goes.
        </p>
      )}
    </div>
  );

  const difficultyField = (
        <div className="field">
          <span className="field__label">Difficulty</span>
          <div className="segmented segmented--wrap">
            {DIFFICULTIES.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={locked.difficulty(option.id)}
                className={`segmented__option ${
                  shown.difficultyId === option.id ? 'is-selected' : ''
                } ${locked.difficulty(option.id) ? 'is-locked' : ''}`}
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
  );

  const timeSignatureField = (
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
  );

  const rangeField = (
    <RangePicker
      instrument={instrument}
      clef={settings.clef}
      fifths={shown.fifths}
      range={settings.range}
      onChange={(range) => update('range', range)}
    />
  );

  const registerField = (
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
  );

  return (
    <div className="screen screen--settings">
      <header className="masthead">
        <h1>Brass Fingering Trainer</h1>
      </header>

      {/*
        My Music sits at the top, beside the settings rather than under them.
        It was in the footer beneath the licence credits to begin with, where
        the player who asked for it could not find it — credits read as the end
        of a page, so anything below them reads as furniture. This is not a
        setting for the exercise about to be generated; it is the other door out
        of this screen, and it belongs where a door goes.
      */}
      <button type="button" className="entry" onClick={onImport}>
        <span className="entry__title">My Music</span>
        <span className="entry__detail">Open a part you have imported, or add one</span>
      </button>

      {/*
        Said once, near the top, rather than six times beside six controls.

        It names what this copy *has* rather than listing what it lacks, and
        says nothing about buying anything — there is nothing to buy yet, and a
        screen that nags before there is even a price is the wrong first
        impression for a practice tool. Assembled from `FREE_TIER` so it cannot
        drift away from what is actually enforced.
      */}
      {isLimited(entitlements) && (
        <p className="notice">
          This copy is limited to{' '}
          {[
            !entitlements.allKeys &&
              `${MAJOR_KEYS.find((k) => k.fifths === FREE_TIER.fifths)?.name} major`,
            // Named as what it takes away rather than as a number, because
            // that is what it now is: every tier is given the same exercise,
            // and only a paid one may carry on past the end of it.
            !entitlements.playOn && 'one exercise at a time',
            // Only where it actually withholds something. `FREE_TIER.kinds`
            // currently names every kind there is, and a notice announcing the
            // whole list as a limitation reads as a much smaller app than it is.
            !entitlements.allMaterial &&
              FREE_TIER.kinds.length < EXERCISE_KINDS.length &&
              FREE_TIER.kinds
                .map((id) => EXERCISE_KINDS.find((k) => k.id === id)?.name?.toLowerCase())
                .filter(Boolean)
                .join(' and '),
            !entitlements.allDifficulties &&
              `${DIFFICULTIES.find((d) => d.id === FREE_TIER.difficultyIds.at(-1))?.name} and below`,
          ]
            .filter(Boolean)
            .join(', ')}
          . The rest is shown but cannot be chosen.
        </p>
      )}

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

        {/*
          One box per material, and the open one is the material.

          Chosen over a chooser with the settings underneath it, on the player's
          call and for the reason they gave: presented with too many options at
          once, attention snaps. Most of what used to be on this screen applies
          to one material and is noise beside the others — a register is a
          question about where a scale sits and means nothing to a written tune,
          a range is a question about the pool free material is drawn from and
          means nothing to either.

          **Opening a box is choosing that material.** Deliberately not two
          separate things: a selected box and an expanded box are two states
          saying almost the same thing, and two states saying almost the same
          thing can disagree — the screen would then have to answer what it means
          to expand Themes while Scales is selected, and there is no good answer.
          So there is one state, `settings.kind`, and the open box shows it.

          Which is also why the open box does not close. Closing it would leave
          no material chosen, and an exercise has to be made of something. The
          button carries both `aria-pressed` and `aria-expanded` because both are
          true of it and neither implies the other to a screen reader.
        */}
        <div className="modes">
          {EXERCISE_KINDS.map((kind) => {
            const chosen = shown.kind === kind.id;
            const bodyId = `mode-${kind.id}`;
            return (
              <div
                key={kind.id}
                className={`mode ${chosen ? 'is-open' : ''} ${
                  locked.kind(kind.id) ? 'is-locked' : ''
                }`}
              >
                <button
                  type="button"
                  className="mode__summary"
                  disabled={locked.kind(kind.id)}
                  aria-pressed={chosen}
                  aria-expanded={chosen}
                  aria-controls={bodyId}
                  onClick={() => update('kind', kind.id as ExerciseKind)}
                >
                  <strong>{kind.name}</strong>
                  <span className="muted">{kind.blurb}</span>
                </button>
                {chosen && (
                  <div className="mode__body" id={bodyId}>
                    {keysField}
                    {difficultyField}
                    {/* A scale is a shape played against a click rather than a
                        piece with a metre, so it is always four-four and asks
                        instead which end of the horn to sit at. */}
                    {isPattern(kind.id) ? registerField : timeSignatureField}
                    {/* The pool free material is drawn from. A pattern is placed
                        by its tonic and a theme is written already, so neither
                        has a pool to ask about. */}
                    {kind.id === 'phrases' && rangeField}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel id="playing" title="Playing" values={panelValues.playing} open={isOpen('playing')} onToggle={setOpen}>

        <div className="field">
          <div className="cards">
            {READING_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                disabled={locked.reading(mode.id)}
                className={`card ${shown.readingMode === mode.id ? 'is-selected' : ''} ${
                  locked.reading(mode.id) ? 'is-locked' : ''
                }`}
                onClick={() => update('readingMode', mode.id)}
              >
                <strong>{mode.name}</strong>
                {mode.blurb && <span className="muted">{mode.blurb}</span>}
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
                {mode.blurb && <span className="muted">{mode.blurb}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Fingerings</span>
          <div className="cards">
            {FINGERING_MODES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={`card ${settings.fingerings === choice.id ? 'is-selected' : ''}`}
                onClick={() => update('fingerings', choice.id)}
              >
                <strong>{choice.name}</strong>
                {choice.blurb && <span className="muted">{choice.blurb}</span>}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {/*
        Everything with a sensible answer already in it.

        Not lesser settings — the conductor's liveliness is a difficulty axis
        and the timing tolerance decides what counts as right. But every one of
        them is abstract until you have played a few exercises, and a beginner
        meeting "Scroll speed 110" on the way to their first note has been asked
        a question they have no way to answer. The defaults are what the app
        would have used anyway; this is where to go once the number means
        something to you.
      */}
      <Panel id="advanced" title="Advanced" values={panelValues.advanced} open={isOpen('advanced')} onToggle={setOpen}>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={settings.variableTempo}
            onChange={(event) => update('variableTempo', event.target.checked)}
          />
          <span>Variable tempo</span>
        </label>

        {/* Only where it does something. Paged reading holds the music still
            and engraves it; `layout` returns before this is ever read, so in
            that mode the slider was a control that moved nothing. */}
        {settings.readingMode === 'scrolling' && (
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
              How fast the music travels, whatever the tempo. Spacing follows it.
            </p>
          </label>
        )}

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

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={shown.weakNoteDrilling}
            disabled={!entitlements.weakNoteDrilling}
            onChange={(event) => update('weakNoteDrilling', event.target.checked)}
          />
          <span>Favour notes I get wrong</span>
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

      {/*
        Tempo sits with Start rather than inside a panel.

        It is the one setting a player reaches for every single time — the same
        exercise slower is most of what practice *is* — and it was two taps down
        inside a collapsed section, beneath things that get chosen once and left
        alone. Nothing else on this screen has that pattern of use, so nothing
        else joins it here.
      */}
      <div className="actions actions--sticky">
        <label className="field tempo">
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

        <button type="button" className="button button--primary button--large" onClick={onStart}>
          Start
        </button>
      </div>
    </div>
  );
}
