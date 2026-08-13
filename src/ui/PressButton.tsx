/**
 * A button that answers the finger that arrives, not only the first one.
 *
 * A touchscreen raises `click` for the *primary* pointer alone — the first
 * finger down — so a player already holding valves reaches for a button with a
 * second finger and no click is ever generated. The button looks broken exactly
 * when it is most needed, which is while playing, since that is the only time a
 * hand is already on the screen.
 *
 * So: pressed on `pointerdown`, which arrives for every finger and is also the
 * right feel for a control used mid-bar. Keyboard activation still comes
 * through as a click with no pointer behind it — `detail` is zero for those,
 * and non-zero for the compatibility click a mouse would otherwise double up
 * with.
 *
 * The play screen's big Stop button did this first and inline; it moved here
 * when the transport buttons beside it needed the same trick, which is the
 * second time of writing it and therefore the last.
 */

import type { ReactNode } from 'react';

interface PressButtonProps {
  onPress: () => void;
  className?: string;
  disabled?: boolean;
  /** For a button whose face is a glyph rather than a word. */
  label?: string;
  children: ReactNode;
}

export function PressButton({ onPress, className, disabled, label, children }: PressButtonProps) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault();
        if (!disabled) onPress();
      }}
      onClick={(event) => {
        if (event.detail === 0 && !disabled) onPress();
      }}
    >
      {children}
    </button>
  );
}
