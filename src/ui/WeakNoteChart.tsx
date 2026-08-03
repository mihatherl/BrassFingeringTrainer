/**
 * The notes worth drilling, drawn rather than named.
 *
 * A list of pitch names asks the reader to translate "G flat 3" back into a
 * position on a stave, and the player who most needs the practice is exactly
 * the one for whom that translation is the difficulty rather than an aside.
 */

import { useCallback } from 'react';
import { drawNoteChart, type ChartNote } from '../render/note-chart';
import type { Clef } from '../domain/instruments';
import type { StaveTheme } from '../render/surface';
import { StaveCanvas } from './StaveCanvas';

interface WeakNoteChartProps {
  notes: ChartNote[];
  clef: Clef;
  fifths: number;
}

export function WeakNoteChart({ notes, clef, fifths }: WeakNoteChartProps) {
  const draw = useCallback(
    (canvas: HTMLCanvasElement, theme: StaveTheme) =>
      void drawNoteChart(canvas, { notes, clef, fifths, theme }),
    [notes, clef, fifths],
  );

  return <StaveCanvas draw={draw} className="review" />;
}
