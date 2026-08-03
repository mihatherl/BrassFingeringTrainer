/**
 * The marked exercise on the results screen.
 *
 * Every note in the colour of its verdict, with the fingering it wanted written
 * under each mistake — the teaching that play itself has no room for.
 */

import { useCallback } from 'react';
import { drawReview } from '../render/review';
import type { StaveTheme } from '../render/surface';
import type { Verdict } from '../engine/judge';
import type { Exercise } from '../exercise/types';
import { StaveCanvas } from './StaveCanvas';

interface ReviewStaveProps {
  exercise: Exercise;
  verdicts: Array<Verdict | undefined>;
}

export function ReviewStave({ exercise, verdicts }: ReviewStaveProps) {
  const draw = useCallback(
    (canvas: HTMLCanvasElement, theme: StaveTheme) =>
      void drawReview(canvas, { exercise, verdicts, theme }),
    [exercise, verdicts],
  );

  return <StaveCanvas draw={draw} className="review" />;
}
