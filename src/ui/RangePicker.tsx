/**
 * Choosing the notes free material is drawn from.
 *
 * Two ends and a stave. The dropdowns name the notes because a control has to
 * be operated, and the stave draws them because that is where a player reads a
 * note — the same reasoning `note-chart.ts` sets out for the weak-note chart:
 * a letter and an octave number ask the reader to translate, and translating
 * is the very thing someone practising this is not yet fluent at.
 *
 * The fingering sits under each, from the same `drawFingeringHint` the play
 * surface uses, so a bound reads as a note you can put your fingers on.
 *
 * Free material only: a scale is placed by its tonic and asks `register` where
 * to sit, and a theme finds its own octave from the degrees it is written in.
 * Neither would mean the same thing by a range, so neither is offered one.
 */

import { useCallback } from 'react';
import { formatMask, primaryFingering } from '../domain/fingering';
import { soundingFromWritten, writtenRange, type Clef, type Instrument } from '../domain/instruments';
import { spellInKey } from '../domain/keys';
import { formatPitch } from '../domain/pitch';
import { drawNoteChart } from '../render/note-chart';
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

/** How a note is offered in the list: where it is, and what holds it down. */
function label(midi: number, fifths: number, instrument: Instrument, clef: Clef): string {
  const sounding = soundingFromWritten(midi, instrument, clef);
  const mask = primaryFingering(sounding, instrument)?.mask;
  const name = formatPitch(spellInKey(midi, fifths));
  return mask === undefined ? name : `${name} · ${formatMask(mask)}`;
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
  const notes: number[] = [];
  for (let midi = lowest; midi <= highest; midi++) notes.push(midi);

  const chosen = range ?? { low: lowest, high: highest };

  const draw = useCallback(
    (canvas: HTMLCanvasElement, theme: Parameters<typeof drawNoteChart>[1]['theme']) => {
      const chart = (midi: number) => {
        const sounding = soundingFromWritten(midi, instrument, clef);
        const mask = primaryFingering(sounding, instrument)?.mask;
        return { writtenMidi: midi, fingering: mask === undefined ? '—' : formatMask(mask) };
      };
      // No percentages: nothing here has been played, and a figure under these
      // two would be an answer to a question nobody asked.
      drawNoteChart(canvas, {
        notes: chosen.low === chosen.high ? [chart(chosen.low)] : [chart(chosen.low), chart(chosen.high)],
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
          <div className="field-row">
            <label className="field">
              <span className="field__label">Lowest</span>
              <select
                value={range.low}
                onChange={(event) => {
                  const low = Number(event.target.value);
                  onChange({ low, high: Math.max(low, range.high) });
                }}
              >
                {notes.map((midi) => (
                  <option key={midi} value={midi}>
                    {label(midi, fifths, instrument, clef)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Highest</span>
              <select
                value={range.high}
                onChange={(event) => {
                  const high = Number(event.target.value);
                  onChange({ low: Math.min(high, range.low), high });
                }}
              >
                {notes.map((midi) => (
                  <option key={midi} value={midi}>
                    {label(midi, fifths, instrument, clef)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <StaveCanvas
            className="range-stave"
            draw={draw}
            label={`Range: ${formatPitch(spellInKey(range.low, fifths))} to ${formatPitch(
              spellInKey(range.high, fifths),
            )}`}
          />

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
