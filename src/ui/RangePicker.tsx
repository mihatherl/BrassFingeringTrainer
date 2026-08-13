/**
 * Choosing the notes free material is drawn from.
 *
 * Two ends and a stave. The stave draws them because that is where a player
 * reads a note — the same reasoning `note-chart.ts` sets out for the weak-note
 * chart: a letter and an octave number ask the reader to translate, and
 * translating is the very thing someone practising this is not yet fluent at.
 * The fingering sits over each, from the same `drawFingeringHint` the play
 * surface uses, so a bound reads as a note you can put your fingers on.
 *
 * Under each note is the dial that moves it, on the same fractions of the width
 * the notes are drawn at, so the control is beneath the thing it controls. They
 * turn in stave steps within the key, which is the unit the figure above them
 * is drawn in: one turn of a dial, one line or space.
 *
 * Neither dial may pass the other. Blocking rather than shoving is deliberate —
 * a dial that pushed its neighbour along would move a note the player was not
 * touching, and the pair would drift up the horn together with no way to see
 * why. Stopped against each other, the two can still meet on one note, which is
 * a legitimate thing to ask for and reads as one.
 *
 * Free material only: a scale is placed by its tonic and asks `register` where
 * to sit, and a theme finds its own octave from the degrees it is written in.
 * Neither would mean the same thing by a range, so neither is offered one.
 */

import { useCallback, useMemo } from 'react';
import { formatMask, primaryFingering } from '../domain/fingering';
import { soundingFromWritten, writtenRange, type Clef, type Instrument } from '../domain/instruments';
import { keyLadder } from '../domain/ladder';
import { spellInKey } from '../domain/keys';
import { formatPitch } from '../domain/pitch';
import { BOUND_X, drawRangeStave } from '../render/range-stave';
import { NoteDial } from './NoteDial';
import { StaveCanvas } from './StaveCanvas';

interface RangePickerProps {
  instrument: Instrument;
  clef: Clef;
  /** Key the bounds are spelled in, so they read as the exercise will. */
  fifths: number;
  /** The chosen range, or null to leave it to the difficulty. */
  range: { low: number; high: number } | null;
  onChange: (range: { low: number; high: number } | null) => void;
}

/** Semitones described the way a player would say it, for the summary line. */
function describeSpan(semitones: number): string {
  if (semitones === 0) return 'one note';
  const octaves = Math.floor(semitones / 12);
  const rest = semitones % 12;
  const parts: string[] = [];
  if (octaves > 0) parts.push(octaves === 1 ? 'an octave' : `${octaves} octaves`);
  if (rest > 0) parts.push(`${rest} semitone${rest === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

export function RangePicker({ instrument, clef, fifths, range, onChange }: RangePickerProps) {
  const [lowest, highest] = writtenRange(instrument, clef);
  const ladder = useMemo(() => keyLadder(fifths, lowest, highest), [fifths, lowest, highest]);

  const chosen = range ?? { low: lowest, high: highest };
  const name = useCallback(
    (midi: number) => formatPitch(spellInKey(midi, fifths)),
    [fifths],
  );

  const draw = useCallback(
    (canvas: HTMLCanvasElement, theme: Parameters<typeof drawRangeStave>[1]['theme']) => {
      const bound = (midi: number) => {
        const sounding = soundingFromWritten(midi, instrument, clef);
        const mask = primaryFingering(sounding, instrument)?.mask;
        return { writtenMidi: midi, fingering: mask === undefined ? '—' : formatMask(mask) };
      };
      drawRangeStave(canvas, {
        low: bound(chosen.low),
        high: bound(chosen.high),
        clef,
        fifths,
        theme,
      });
    },
    [chosen.low, chosen.high, instrument, clef, fifths],
  );

  return (
    <div className="field">
      <label className="field field--inline">
        <input
          type="checkbox"
          checked={range !== null}
          onChange={(event) =>
            /*
             * Switched on, it opens at the whole compass rather than at some
             * guess: the player is about to narrow it, and starting from
             * everything makes the next move obvious in a way starting from
             * somebody else's idea of a middle does not.
             */
            onChange(event.target.checked ? { low: lowest, high: highest } : null)
          }
        />
        <span>Choose the range myself</span>
      </label>

      {range !== null && (
        <>
          <StaveCanvas
            className="range__stave"
            draw={draw}
            label={`Range: ${name(range.low)} to ${name(range.high)}`}
          />

          {/*
            Absolute, on the fractions the notes are drawn at. The canvas fills
            this container, so a percentage here and a fraction of the canvas
            width are the same measurement — which is what keeps each dial
            under its own note at every screen size, with nothing measured in
            JavaScript to fall out of step.
          */}
          <div className="range__dials">
            {(
              [
                {
                  key: 'low' as const,
                  label: 'Lowest',
                  value: range.low,
                  min: lowest,
                  max: range.high,
                  set: (midi: number) => onChange({ low: midi, high: range.high }),
                },
                {
                  key: 'high' as const,
                  label: 'Highest',
                  value: range.high,
                  min: range.low,
                  max: highest,
                  set: (midi: number) => onChange({ low: range.low, high: midi }),
                },
              ] as const
            ).map((bound, index) => (
              <div
                key={bound.key}
                className="range__dial"
                style={{ left: `${BOUND_X[index] * 100}%` }}
              >
                <NoteDial
                  label={bound.label}
                  values={ladder}
                  value={bound.value}
                  min={bound.min}
                  max={bound.max}
                  name={name}
                  onChange={bound.set}
                />
              </div>
            ))}
          </div>

          <p className="field__note muted">
            {/* What the choice actually amounts to, since a pair of note names
                does not say how much of the horn it covers. */}
            {describeSpan(range.high - range.low)} — every note in it, not
            favouring the middle.
          </p>
        </>
      )}
    </div>
  );
}
