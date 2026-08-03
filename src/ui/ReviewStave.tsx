/**
 * The marked exercise on the results screen.
 *
 * A canvas rather than React, because the drawing is the same notation code the
 * play surface uses. React's only job is to mount it and redraw when the width
 * or the colour scheme changes.
 */

import { useEffect, useRef } from 'react';
import { drawReview } from '../render/review';
import { currentTheme } from '../render/surface';
import type { Verdict } from '../engine/judge';
import type { Exercise } from '../exercise/types';

interface ReviewStaveProps {
  exercise: Exercise;
  verdicts: Array<Verdict | undefined>;
}

export function ReviewStave({ exercise, verdicts }: ReviewStaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = canvas?.parentElement;
    if (!canvas || !frame) return;

    const redraw = () => drawReview(canvas, { exercise, verdicts, theme: currentTheme() });
    redraw();

    /*
     * The frame is observed rather than the canvas itself.
     *
     * Drawing sets the canvas height, so observing the canvas would see its own
     * effect and loop. The frame's height comes from the canvas inside it, but
     * only its width is acted on here, so the cycle never closes.
     */
    let lastWidth = frame.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const width = frame.getBoundingClientRect().width;
      if (width === lastWidth) return;
      lastWidth = width;
      redraw();
    });
    observer.observe(frame);

    const colourScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    colourScheme?.addEventListener('change', redraw);

    return () => {
      observer.disconnect();
      colourScheme?.removeEventListener('change', redraw);
    };
  }, [exercise, verdicts]);

  return (
    <div className="review">
      <canvas ref={canvasRef} className="review__canvas" />
    </div>
  );
}
