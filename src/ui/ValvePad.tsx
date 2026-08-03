/**
 * The three valve buttons.
 *
 * Pointer capture is taken on press so the matching release always arrives at
 * the same element even if the finger drifts off it — without that, a slide off
 * the edge leaves a valve stuck down for the rest of the exercise.
 */

import { maskToValves } from '../domain/fingering';

interface ValvePadProps {
  mask: number;
  onPress: (pointerId: number, valve: number) => void;
  onRelease: (pointerId: number) => void;
  disabled?: boolean;
}

const VALVES = [1, 2, 3];
const KEY_HINTS: Record<number, string> = { 1: '1 / J', 2: '2 / K', 3: '3 / L' };

export function ValvePad({ mask, onPress, onRelease, disabled }: ValvePadProps) {
  const held = new Set(maskToValves(mask));

  return (
    <div className="valve-pad" role="group" aria-label="Valves">
      {VALVES.map((valve) => (
        <button
          key={valve}
          type="button"
          className={`valve ${held.has(valve) ? 'valve--down' : ''}`}
          disabled={disabled}
          aria-pressed={held.has(valve)}
          aria-label={`Valve ${valve}`}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onPress(event.pointerId, valve);
          }}
          onPointerUp={(event) => onRelease(event.pointerId)}
          onPointerCancel={(event) => onRelease(event.pointerId)}
          onLostPointerCapture={(event) => onRelease(event.pointerId)}
        >
          <span className="valve__number">{valve}</span>
          <span className="valve__hint">{KEY_HINTS[valve]}</span>
        </button>
      ))}
    </div>
  );
}
