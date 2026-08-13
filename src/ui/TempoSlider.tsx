/**
 * The tempo, under the player's hand while they are playing.
 *
 * The one setting a player reaches for constantly is the speed, and until now
 * reaching for it meant stopping, going back to the settings screen and
 * starting the exercise again — which is a strange thing to have to do about
 * the single most common instruction in a practice room. It sits where the list
 * of recent notes used to: the same corner of every layout, already sized to be
 * reachable while the other hand is on the valves.
 *
 * The number is what the player is watching, so it changes on the instant. The
 * clock is told separately, and takes the change at the next whole beat it has
 * not already committed to the audio thread — see `Transport.changeTempo`.
 */

import type { ChangeEvent } from 'react';
import { TEMPO_RANGE } from '../domain/tempo';

interface TempoSliderProps {
  tempo: number;
  onChange: (bpm: number) => void;
  /** True in compound time, where the number counts dotted crotchets. */
  compound?: boolean;
}

export function TempoSlider({ tempo, onChange, compound }: TempoSliderProps) {
  return (
    <label className="tempo-live">
      <span className="tempo-live__value">
        <strong>{tempo}</strong> {compound ? 'dotted' : 'bpm'}
      </span>
      <input
        type="range"
        min={TEMPO_RANGE.min}
        max={TEMPO_RANGE.max}
        step={1}
        value={tempo}
        aria-label="Tempo"
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
