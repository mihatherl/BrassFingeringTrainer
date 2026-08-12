/**
 * A canvas that draws notation and sizes itself to its own content.
 *
 * The results screen has two of these — the marked exercise and the fingering
 * chart — and both want the same three things: draw on mount, redraw when the
 * width changes, redraw when the colour scheme flips. React's only job is to
 * mount the element; the drawing is the same notation code the play surface
 * uses, which knows nothing about React.
 */

import { useEffect, useRef, type ReactElement } from 'react';
import { currentTheme, type StaveTheme } from '../render/surface';

interface StaveCanvasProps {
  /** Draws into the canvas at its current width, and sets its height to suit. */
  draw: (canvas: HTMLCanvasElement, theme: StaveTheme) => void;
  className?: string;
  /**
   * A tap on the notation, in CSS pixels from the canvas's top left.
   *
   * Converted here because the canvas is the only thing that knows where it is
   * on the page, and every caller would otherwise repeat the same rectangle
   * arithmetic to find out.
   */
  onPick?: (x: number, y: number, canvas: HTMLCanvasElement) => void;
  /** Named for a screen reader, which cannot see a canvas at all. */
  label?: string;
}

export function StaveCanvas({ draw, className, onPick, label }: StaveCanvasProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = canvas?.parentElement;
    if (!canvas || !frame) return;

    const redraw = () => draw(canvas, currentTheme());
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
  }, [draw]);

  return (
    <div className={className ?? 'stave-figure'}>
      <canvas
        ref={canvasRef}
        className="stave-figure__canvas"
        aria-label={label}
        onClick={
          onPick &&
          ((event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onPick(event.clientX - rect.left, event.clientY - rect.top, event.currentTarget);
          })
        }
      />
    </div>
  );
}
