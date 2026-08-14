/**
 * The key, under the player's hand while they are playing.
 *
 * The third dial in the app and the same gesture as the other two, but the one
 * that differs in what a turn *costs*. Moving the tempo is a number the clock
 * reads next beat; moving the key rewrites every bar the player has not reached
 * yet. So this dial separates turning from choosing: the face follows the finger
 * detent by detent, and the music is rewritten once, when the finger comes off.
 *
 * That is not for the sake of the work — two hundred bars regenerate in a few
 * milliseconds, which was measured before this was built rather than assumed.
 * It is because **a key is a destination and not a path**. Sliding from one flat
 * to two sharps passes through C and G, and putting those on the page on the way
 * would show the player two keys they did not ask for and respell the music
 * twice to do it.
 *
 * **Where the change lands is part of the reading.** A key signature has to be
 * seen before the bar it governs, so the change goes in at a bar line ahead of
 * the playhead — and while the dial is turning, the callout says which bar, so
 * the player knows whether the change is coming in time to matter to the phrase
 * they are in.
 */

import type { CSSProperties } from 'react';
import { describeFifths, MAJOR_KEYS } from '../domain/keys';
import { useDial } from './useDial';

/**
 * Travel to one step round the circle of fifths, in CSS pixels.
 *
 * Longer than the tempo dial's detent, because the two dials are answering
 * different sorts of question. There are fifteen keys in all and a player wants
 * a particular one; there are a hundred and eighty tempos and a player wants
 * *slightly slower*. A long detent makes the neighbouring key hard to hit by
 * accident, which matters when hitting it rewrites the music.
 */
const STEP_PX = 22;

/** The circle, from seven flats to seven sharps. */
const MIN_FIFTHS = -7;
const MAX_FIFTHS = 7;

/** How the signature is drawn on the face: "3♭", "2♯", or nothing for C. */
function accidentals(fifths: number): string {
  if (fifths === 0) return '♮';
  return `${Math.abs(fifths)}${fifths > 0 ? '♯' : '♭'}`;
}

function keyName(fifths: number): string {
  return MAJOR_KEYS.find((key) => key.fifths === fifths)?.name ?? 'C';
}

interface KeyDialProps {
  /** The key the dial is pointing at, which is not yet the key of the music. */
  fifths: number;
  /** Every detent, so the face and the callout can follow the finger. */
  onChange: (fifths: number) => void;
  /** Once, on release: the key to actually rewrite the music in. */
  onCommit: (fifths: number) => void;
  /**
   * The printed number of the bar a change would start at, or null when it would
   * be the whole exercise — which is what turning the dial during the count-in
   * means.
   */
  fromBar: string | null;
}

export function KeyDial({ fifths, onChange, onCommit, fromBar }: KeyDialProps) {
  const dial = useDial({
    value: fifths,
    resolve: (from, delta) => Math.min(MAX_FIFTHS, Math.max(MIN_FIFTHS, from + delta)),
    onChange,
    onCommit,
    stepPx: STEP_PX,
    ends: { min: MIN_FIFTHS, max: MAX_FIFTHS },
  });

  // From the key itself rather than from the drag, so the same key always shows
  // the same face and a change made with the keyboard turns the wheel as far as
  // a finger would have. See the same line in `TempoDial`.
  const phase = -(fifths * STEP_PX + dial.offset);

  return (
    <div className="key-dial">
      {dial.turning && (
        <span className="key-dial__callout" aria-hidden="true">
          <strong>{keyName(fifths)}</strong>
          <span className="key-dial__from">{fromBar === null ? 'all' : `bar ${fromBar}`}</span>
        </span>
      )}
      <div
        ref={dial.ref}
        className={`key-dial__wheel ${dial.turning ? 'is-turning' : ''}`}
        style={{ '--phase': `${phase}px` } as CSSProperties}
        role="spinbutton"
        tabIndex={0}
        aria-label="Key"
        aria-valuemin={MIN_FIFTHS}
        aria-valuemax={MAX_FIFTHS}
        aria-valuenow={fifths}
        aria-valuetext={`${keyName(fifths)} major, ${describeFifths(fifths)}`}
        {...dial.handlers}
      >
        <span className="key-dial__face" aria-hidden="true">
          <strong>{keyName(fifths)}</strong>
          <span className="key-dial__count">{accidentals(fifths)}</span>
        </span>
      </div>
    </div>
  );
}
