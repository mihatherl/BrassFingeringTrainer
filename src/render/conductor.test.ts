import { describe, expect, it } from 'vitest';
import { metreFor } from '../domain/metre';
import { CONDUCTOR_STYLE_RANGE, extentOf, gripFor, patternFor, styleName, tipAt } from './conductor';

/**
 * The style axis, sampled end to end.
 *
 * Every one of these used to run at the single value the panel had hardcoded.
 * Now that the player sets it, each of the properties below — no corners at the
 * beats, a real ictus, a readable speed contrast, a fittable extent — has to
 * hold everywhere on the axis, not at one point on it. A style that turned the
 * gesture into an even crawl or a stutter would be a setting that quietly
 * stopped being conducting.
 */
const STYLES = [CONDUCTOR_STYLE_RANGE.min, 0.55, 0.8, CONDUCTOR_STYLE_RANGE.max];

describe('choosing a pattern', () => {
  it('beats a bar by its pulses, not by its numerator', () => {
    // The whole reason compound time needs no pattern of its own: 6/8 is beaten
    // in two, 9/8 in three, 12/8 in four. Reading the top number instead would
    // give 6/8 a six pattern, which is a thing conductors do only very slowly.
    const beats = (n: number, unit: number) => patternFor(metreFor(n, unit))?.length;

    expect(beats(4, 4)).toBe(4);
    expect(beats(3, 4)).toBe(3);
    expect(beats(2, 4)).toBe(2);
    expect(beats(2, 2)).toBe(2);

    expect(beats(6, 8)).toBe(2);
    expect(beats(9, 8)).toBe(3);
    expect(beats(12, 8)).toBe(4);
  });

  it('has no pattern for a metre it was never taught', () => {
    /*
     * Null switches the conductor off and leaves the metronome running. A
     * conducting pattern is a specific taught shape, not something to
     * interpolate — a five is not a four with a beat wedged in — and imported
     * music guarantees metres we have none for.
     */
    expect(patternFor(metreFor(5, 4))).toBeNull();
    expect(patternFor(metreFor(7, 8))).toBeNull();
    expect(patternFor(metreFor(11, 8))).toBeNull();
  });
});

describe('naming a style', () => {
  it('has a word for every point the player can set', () => {
    // The slider shows the name, not the number, so a gap would put a settings
    // screen in front of someone with nothing written where the value goes.
    for (let style = CONDUCTOR_STYLE_RANGE.min; style <= CONDUCTOR_STYLE_RANGE.max; style += 0.05) {
      expect(styleName(style), `style ${style.toFixed(2)}`).toBeTruthy();
    }
  });

  it('runs from smooth to marcato', () => {
    expect(styleName(CONDUCTOR_STYLE_RANGE.min)).toBe('smooth');
    expect(styleName(CONDUCTOR_STYLE_RANGE.max)).toBe('marcato');
  });
});

describe.each(STYLES)('the gesture, at style %s', (STYLE) => {
  const patterns = [2, 3, 4].map((n) => ({ n, pattern: patternFor(metreFor(n, 4))! }));

  it('turns no corners at the beats', () => {
    /*
     * The correction the whole shape turned on. A beat is a point *on* one
     * continuous curve, not the seam between two of them: at a seam the tangent
     * jumps, so the tip turns a hard corner, and a hand with mass cannot do
     * that. Stitched cubics measured a 180 degree flip here.
     */
    for (const { n, pattern } of patterns) {
      for (let beat = 0; beat < pattern.length; beat++) {
        const d = 1e-4;
        const before = tipAt(pattern, beat - 2 * d, STYLE);
        const arriving = tipAt(pattern, beat - d, STYLE);
        const leaving = tipAt(pattern, beat + d, STYLE);
        const after = tipAt(pattern, beat + 2 * d, STYLE);

        // Continuous in position...
        expect(Math.hypot(leaving.x - arriving.x, leaving.y - arriving.y)).toBeLessThan(0.01);

        // ...and in direction.
        const into = Math.atan2(arriving.y - before.y, arriving.x - before.x);
        const outOf = Math.atan2(after.y - leaving.y, after.x - leaving.x);
        let turn = Math.abs(outOf - into);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        expect((turn * 180) / Math.PI, `${n} pattern, beat ${beat + 1}`).toBeLessThan(5);
      }
    }
  });

  it('drops onto every beat and lifts away from it', () => {
    /*
     * The ictus is "the change in direction that is interpreted by an ensemble
     * as the actual beat" — so every beat must be approached downwards and left
     * upwards. Sampled a little either side rather than at the instant, since
     * on a smooth curve the vertical velocity is exactly zero at the beat
     * however sharp the turn.
     */
    const window = 0.06;
    for (const { n, pattern } of patterns) {
      for (let beat = 0; beat < pattern.length; beat++) {
        const d = 1e-4;
        const descending =
          tipAt(pattern, beat - window + d, STYLE).y - tipAt(pattern, beat - window - d, STYLE).y;
        const rising =
          tipAt(pattern, beat + window + d, STYLE).y - tipAt(pattern, beat + window - d, STYLE).y;
        expect(descending, `${n} pattern, beat ${beat + 1} approach`).toBeGreaterThan(0);
        expect(rising, `${n} pattern, beat ${beat + 1} rebound`).toBeLessThan(0);
      }
    }
  });

  it('is quicker at the beat than between beats', () => {
    // Shape alone is not enough: traversed evenly the curve would be perfect
    // and the beat invisible. The phase warp is what makes it readable.
    for (const { n, pattern } of patterns) {
      const speedAt = (at: number) => {
        const d = 1e-4;
        const a = tipAt(pattern, at - d, STYLE);
        const b = tipAt(pattern, at + d, STYLE);
        return Math.hypot(b.x - a.x, b.y - a.y);
      };
      for (let beat = 0; beat < pattern.length; beat++) {
        const atBeat = Math.max(speedAt(beat - 0.02), speedAt(beat + 0.02));
        const between = speedAt(beat + 0.5);
        expect(atBeat, `${n} pattern, beat ${beat + 1}`).toBeGreaterThan(between);
      }
    }
  });

  it('keeps the grip inside the tip’s travel', () => {
    // The grip is a smaller, concentric copy — so it can never reach further
    // than the tip in any direction, whatever the pattern.
    for (const { n, pattern } of patterns) {
      const extent = extentOf(pattern, STYLE);
      for (let i = 0; i <= 200; i++) {
        const tip = tipAt(pattern, (i / 200) * pattern.length, STYLE);
        const grip = gripFor(pattern, tip);
        expect(grip.x, `${n} pattern`).toBeGreaterThanOrEqual(extent.minX - 1e-9);
        expect(grip.x).toBeLessThanOrEqual(extent.maxX + 1e-9);
        expect(grip.y).toBeGreaterThanOrEqual(extent.minY - 1e-9);
        expect(grip.y).toBeLessThanOrEqual(extent.maxY + 1e-9);
      }
    }
  });

  it('measures an extent a panel can be fitted to', () => {
    for (const { n, pattern } of patterns) {
      const extent = extentOf(pattern, STYLE);
      expect(extent.width, `${n} pattern width`).toBeGreaterThan(0.2);
      expect(extent.height, `${n} pattern height`).toBeGreaterThan(0.2);
      // Nothing so extreme that it cannot be fitted into a panel beside a list.
      const aspect = extent.width / extent.height;
      expect(aspect).toBeGreaterThan(0.25);
      expect(aspect).toBeLessThan(4);
    }
  });
});
