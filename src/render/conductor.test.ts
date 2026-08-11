import { describe, expect, it } from 'vitest';
import { metreFor } from '../domain/metre';
import {
  BEAT_IN_FEWER_ABOVE_BPM,
  CONDUCTOR_STYLE_RANGE,
  PANEL_ASPECT_RANGE,
  panelAspect,
  extentOf,
  gripFor,
  patternFor,
  placeInPattern,
  shapeFor,
  shapedPattern,
  styleName,
  SUBDIVIDE_BELOW_BPM,
  tipAt,
} from './conductor';
import { pulseAt } from '../domain/metre';
import { steppedTempoAt, type TempoEvent } from '../domain/tempo';

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

  it('subdivides compound time when it is slow enough, and only then', () => {
    /*
     * The reference's fast/slow rule: above Andante the conductor shows the
     * overall beat structure, below it they show each division, because that
     * is where the ensemble needs the beat clarified. So 6/8 is beaten in two
     * at a march and in six at a largo — the same metre, a different gesture.
     */
    const slow = SUBDIVIDE_BELOW_BPM - 1;
    const quick = SUBDIVIDE_BELOW_BPM;

    expect(patternFor(metreFor(6, 8), quick)!.length).toBe(2);
    expect(patternFor(metreFor(6, 8), slow)!.length).toBe(6);

    // No tempo at all is the fast shape, which keeps every caller that has not
    // been told the speed drawing what it always drew.
    expect(patternFor(metreFor(6, 8))!.length).toBe(2);
  });

  it('never subdivides simple time, however slow', () => {
    // A slow 3/4 is beaten in three. Reading the numerator without checking
    // for compound would find the three pattern and appear to work, and a slow
    // 2/4 would quietly become a two — right by accident, for the wrong reason.
    const slow = SUBDIVIDE_BELOW_BPM - 1;
    expect(patternFor(metreFor(3, 4), slow)!.length).toBe(3);
    expect(patternFor(metreFor(2, 4), slow)!.length).toBe(2);
    expect(patternFor(metreFor(4, 4), slow)!.length).toBe(4);
  });

  it('beats a fast simple bar in fewer gestures than it has pulses', () => {
    /*
     * "The one pattern is often used in very fast 2/4, 3/4 and 3/8" — past a
     * speed a hand cannot make an ictus per pulse that anyone can read, and
     * beating fewer is clearer than beating a blur.
     *
     * A four does not go to one: a quick common time is alla breve, and the
     * player ruled that takes the ordinary two pattern rather than wanting a
     * shape of its own. So above the threshold a 2/4 and a 4/4 both give a
     * gesture every two crotchets, which is the arithmetic working out rather
     * than a coincidence — it is why one threshold serves both.
     */
    const fast = BEAT_IN_FEWER_ABOVE_BPM + 1;
    expect(patternFor(metreFor(2, 4), fast)!.length).toBe(1);
    expect(patternFor(metreFor(3, 4), fast)!.length).toBe(1);
    expect(patternFor(metreFor(3, 8), fast)!.length).toBe(1);
    expect(patternFor(metreFor(4, 4), fast)!.length).toBe(2);

    // Compound is left alone: 6/8 in two is already what a fast one wants.
    expect(patternFor(metreFor(6, 8), fast)!.length).toBe(2);

    // At the threshold itself every metre is still beaten in its pulses, and
    // with no tempo given nothing changes for a caller not told the speed.
    expect(patternFor(metreFor(2, 4), BEAT_IN_FEWER_ABOVE_BPM)!.length).toBe(2);
    expect(patternFor(metreFor(4, 4), BEAT_IN_FEWER_ABOVE_BPM)!.length).toBe(4);
    expect(patternFor(metreFor(3, 4))!.length).toBe(3);
  });

  it('lands a fast four on the first and third crotchets', () => {
    /*
     * Which is what alla breve *means*, and the part a pattern length alone
     * does not say. Two gestures across a bar of four crotchets puts them on
     * the minims — beats one and three — and `placeInPattern` derives that from
     * the bar rather than from the pulse, so it needed nothing added.
     */
    const metre = metreFor(4, 4);
    const pattern = patternFor(metre, BEAT_IN_FEWER_ABOVE_BPM + 1)!;
    expect(placeInPattern(metre, pattern, 0)).toBe(0);
    expect(placeInPattern(metre, pattern, 2)).toBeCloseTo(1, 12);
    expect(placeInPattern(metre, pattern, 4)).toBeCloseTo(2, 12);
    // And the second crotchet is half way through the first gesture, not on one.
    expect(placeInPattern(metre, pattern, 1)).toBeCloseTo(0.5, 12);
  });

  it('keeps the fast shape where no subdivided one is drawn yet', () => {
    // 9/8 and 12/8 would want nine and twelve patterns. Until those exist the
    // honest answer is the one that is taught for a quicker tempo, not silence
    // and not a six borrowed from a metre with a different bar.
    const slow = SUBDIVIDE_BELOW_BPM - 1;
    expect(patternFor(metreFor(9, 8), slow)!.length).toBe(3);
    expect(patternFor(metreFor(12, 8), slow)!.length).toBe(4);
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

describe('the pattern following a change of tempo', () => {
  /*
   * The composition the play screen actually performs: the settled tempo picks
   * the pattern, so a step that crosses a threshold changes the gesture and a
   * rit bending through one does not.
   *
   * Tested here rather than only in a browser because the exercise a run gets
   * is seeded — watching for a switch in the app means waiting for a plan that
   * happens to step across the line, which it may not do.
   */
  const metre = metreFor(4, 4);
  const shapeAt = (nominal: number, events: TempoEvent[], beat: number) =>
    patternFor(metre, steppedTempoAt(nominal, events, beat))!.length;

  it('changes shape where the music steps to a genuinely new speed', () => {
    // Alla breve at 180, back to four when the join drops it to 144.
    const events: TempoEvent[] = [{ kind: 'tempo', atBeat: 16, bpm: 144 }];
    expect(shapeAt(180, events, 0)).toBe(2);
    expect(shapeAt(180, events, 15.9)).toBe(2);
    expect(shapeAt(180, events, 16)).toBe(4);
  });

  it('holds its shape through a rit, however far the rit bends', () => {
    /*
     * A closing rit from 180 down to 108 passes clean through the threshold.
     * The hand must not reorganise half way down and back again — the gesture
     * would be unfollowable exactly where following matters most.
     */
    const events: TempoEvent[] = [{ kind: 'ramp', fromBeat: 8, toBeat: 16, toBpm: 108 }];
    for (const beat of [8, 10, 12, 14, 16, 24]) {
      expect(shapeAt(180, events, beat), `beat ${beat}`).toBe(2);
    }
  });

  it('leaves an exercise that holds its speed alone from end to end', () => {
    for (const beat of [0, 8, 64]) expect(shapeAt(120, [], beat)).toBe(4);
  });
});

describe('placing a beat in its pattern', () => {
  it('agrees with the pulse wherever the pulses are what is beaten', () => {
    // Which is every metre but a slow compound one. If these two ever parted
    // company here, the conductor would be beating a bar of a different length
    // from the one the metronome is clicking.
    for (const [top, unit] of [[4, 4], [3, 4], [2, 4], [6, 8], [9, 8], [12, 8]] as const) {
      const metre = metreFor(top, unit);
      const pattern = patternFor(metre)!;
      for (const beat of [0, 0.5, 1, 2.25, 7]) {
        expect(placeInPattern(metre, pattern, beat), `${top}/${unit} at beat ${beat}`).toBeCloseTo(
          pulseAt(metre, beat),
          12,
        );
      }
    }
  });

  it('runs one position to the bar when the bar is beaten in one', () => {
    const metre = metreFor(3, 4);
    const pattern = patternFor(metre, BEAT_IN_FEWER_ABOVE_BPM + 1)!;
    // The whole bar is one gesture, so a bar of three crotchets is one trip
    // round the loop. `pulseAt` would say three and the hand would race.
    expect(placeInPattern(metre, pattern, 0)).toBe(0);
    expect(placeInPattern(metre, pattern, 1.5)).toBeCloseTo(0.5, 12);
    expect(placeInPattern(metre, pattern, 3)).toBeCloseTo(1, 12);
  });

  it('runs six positions to the bar in a subdivided six', () => {
    const metre = metreFor(6, 8);
    const pattern = patternFor(metre, SUBDIVIDE_BELOW_BPM - 1)!;
    // A bar of 6/8 is three crotchets, so each quaver is half a crotchet and
    // each is one position of the pattern. Asking `pulseAt` here would return
    // two across the whole bar and the hand would crawl round at a third speed.
    expect(placeInPattern(metre, pattern, 0)).toBe(0);
    expect(placeInPattern(metre, pattern, 0.5)).toBeCloseTo(1, 12);
    expect(placeInPattern(metre, pattern, 1.5)).toBeCloseTo(3, 12);
    expect(placeInPattern(metre, pattern, 3)).toBeCloseTo(6, 12);
  });

  it('goes negative through the count-in, as the gesture expects', () => {
    const metre = metreFor(4, 4);
    const pattern = patternFor(metre)!;
    expect(placeInPattern(metre, pattern, -4)).toBeCloseTo(-4, 12);
  });
});

describe('the style axis', () => {
  /*
   * That it *does* something, which nothing checked.
   *
   * Found by breaking `shapeFor` so every style returned the flowing gesture:
   * the whole suite still passed. The block below runs each property at four
   * points along the axis, which reads like thorough coverage and is — of the
   * gesture at each point. Not one of them compares two points, so an axis that
   * had quietly become a constant would have gone out looking tested.
   */
  it('gives a different gesture at each end, in every way it is meant to', () => {
    const flowing = shapeFor(CONDUCTOR_STYLE_RANGE.min);
    const marcato = shapeFor(CONDUCTOR_STYLE_RANGE.max);

    // The width runs the other way from everything else — a march is beaten
    // tight and close, a lyrical phrase broad — so it is asserted by direction
    // rather than lumped in with the rest.
    expect(marcato.width).toBeLessThan(flowing.width);
    expect(marcato.arcs).toBeGreaterThan(flowing.arcs);
    expect(marcato.downbeat).toBeGreaterThan(flowing.downbeat);
    expect(marcato.beats).toBeGreaterThan(flowing.beats);
    expect(marcato.lag).toBeGreaterThan(flowing.lag);
  });

  it('moves steadily between them rather than jumping', () => {
    // Every value at the middle sits between the ends, so a setting halfway
    // along is halfway there. A lookup table pretending to be an axis would
    // pass the test above and fail this one.
    const flowing = shapeFor(0);
    const middle = shapeFor(0.5);
    const marcato = shapeFor(1);
    for (const key of ['width', 'arcs', 'downbeat', 'beats', 'lag'] as const) {
      const [low, high] = [flowing[key], marcato[key]].sort((a, b) => a - b);
      expect(middle[key], key).toBeGreaterThan(low);
      expect(middle[key], key).toBeLessThan(high);
    }
  });

  it('reaches the ends and goes no further', () => {
    // The panel and the tests both read `CONDUCTOR_STYLE_RANGE`; a setting
    // outside it — from a stored file written by another version — must clamp
    // rather than extrapolate into a gesture nobody designed.
    expect(shapeFor(-1)).toEqual(shapeFor(CONDUCTOR_STYLE_RANGE.min));
    expect(shapeFor(5)).toEqual(shapeFor(CONDUCTOR_STYLE_RANGE.max));
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
  /*
   * The shaped patterns, which are the ones that reach a screen.
   *
   * Testing the raw entries in `PATTERNS` would be testing a diagram nobody
   * sees: the style setting scales the width, the arcs, the downbeat and the
   * spread of the beats before anything is drawn, and it is the result that has
   * to be a gesture. That distinction is not academic — the shaping moves the
   * beats relative to their own arcs, which is exactly what an ictus is made of.
   */
  const shape = shapeFor(STYLE);
  const patterns = [
    // The one pattern is the degenerate case and belongs here for that reason:
    // a single ictus, no "between beats" at all, and a hairpin so narrow that
    // the tip very nearly retraces its own line.
    { n: 1, pattern: patternFor(metreFor(2, 4), BEAT_IN_FEWER_ABOVE_BPM + 1)! },
    ...[2, 3, 4].map((n) => ({ n, pattern: patternFor(metreFor(n, 4))! })),
    // The subdivided six is held to every property the others are. It is the
    // most convoluted shape here — two elevated beats and a stroke that loops
    // back on itself — so it is the one most likely to lose an ictus.
    { n: 6, pattern: patternFor(metreFor(6, 8), SUBDIVIDE_BELOW_BPM - 1)! },
  ].map(({ n, pattern }) => ({ n, pattern: shapedPattern(pattern, shape) }));

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
        const before = tipAt(pattern, beat - 2 * d, shape.lag);
        const arriving = tipAt(pattern, beat - d, shape.lag);
        const leaving = tipAt(pattern, beat + d, shape.lag);
        const after = tipAt(pattern, beat + 2 * d, shape.lag);

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
     *
     * The tolerance is a hair of the gesture's own height, and it is needed
     * rather than tidy. Where the hand drops from a tall downbeat onto a very
     * shallow following arc — which is the flowing end of the axis exactly —
     * the curve's tangent carries it a few microns below the beat before it
     * comes back up. That is real, it is what a hand with momentum does, and it
     * is four orders of magnitude smaller than anything anyone could see. A
     * strict zero here tests floating point rather than conducting.
     */
    const window = 0.06;
    for (const { n, pattern } of patterns) {
      const slack = extentOf(pattern, shape.lag).height * 1e-3;
      for (let beat = 0; beat < pattern.length; beat++) {
        const d = 1e-4;
        const descending =
          tipAt(pattern, beat - window + d, shape.lag).y - tipAt(pattern, beat - window - d, shape.lag).y;
        const rising =
          tipAt(pattern, beat + window + d, shape.lag).y - tipAt(pattern, beat + window - d, shape.lag).y;
        expect(descending, `${n} pattern, beat ${beat + 1} approach`).toBeGreaterThan(-slack);
        expect(rising, `${n} pattern, beat ${beat + 1} rebound`).toBeLessThan(slack);
      }
    }
  });

  it('is quicker at the beat than between beats, bar one known stroke', () => {
    /*
     * Shape alone is not enough: traversed evenly the curve would be perfect
     * and the beat invisible. The phase warp is what makes it readable.
     *
     * **Scored per beat against the quietest drift either side of it**, which
     * is not the obvious way and is the only correct one. Comparing a beat with
     * the midpoint of the stroke leaving it assumes every ictus is announced by
     * the hand *departing*; it is not, an arrival can carry it just as well, and
     * on a long stroke that measure calls a perfectly readable gesture broken.
     * It rates the two pattern at 0.46 where this rates it 2.37.
     *
     * **The four pattern's second beat is the exception, and it is expected.**
     * Its stroke runs the whole width of the pattern, so the hand is genuinely
     * travelling fast in the middle of it, and that beat has never had much
     * speed contrast to give — it is what set the axis floor back when the
     * geometry was fixed. It is carried by its change of direction instead,
     * which the test above holds it to. Everything else must be quicker at the
     * beat, and the count is asserted so that a second beat going the same way
     * fails here rather than passing as another exception.
     */
    const speedAt = (pattern: typeof patterns[number]['pattern'], at: number) => {
      const d = 1e-4;
      const a = tipAt(pattern, at - d, shape.lag);
      const b = tipAt(pattern, at + d, shape.lag);
      return Math.hypot(b.x - a.x, b.y - a.y) / (2 * d);
    };

    const soft: string[] = [];
    for (const { n, pattern } of patterns) {
      const count = pattern.length;
      // The quietest the hand gets on each stroke, ends excluded — those belong
      // to the beats either side rather than to the drift between them.
      const quietest = Array.from({ length: count }, (_, stroke) => {
        let slowest = Infinity;
        for (let i = 5; i < 96; i++) slowest = Math.min(slowest, speedAt(pattern, stroke + i / 100));
        return slowest;
      });

      for (let beat = 0; beat < count; beat++) {
        const sharpest = Math.max(speedAt(pattern, beat - 1e-3), speedAt(pattern, beat + 1e-3));
        const drift = Math.min(quietest[(beat - 1 + count) % count], quietest[beat]);
        if (sharpest / drift <= 1) soft.push(`${n} pattern beat ${beat + 1}`);
      }
    }

    expect(soft).toEqual(soft.filter((where) => where === '4 pattern beat 2'));
    expect(soft.length, `soft beats: ${soft.join(', ') || 'none'}`).toBeLessThanOrEqual(1);
  });

  it('keeps the grip inside the tip’s travel', () => {
    // The grip is a smaller, concentric copy — so it can never reach further
    // than the tip in any direction, whatever the pattern.
    for (const { n, pattern } of patterns) {
      const extent = extentOf(pattern, shape.lag);
      for (let i = 0; i <= 200; i++) {
        const tip = tipAt(pattern, (i / 200) * pattern.length, shape.lag);
        const grip = gripFor(pattern, tip);
        expect(grip.x, `${n} pattern`).toBeGreaterThanOrEqual(extent.minX - 1e-9);
        expect(grip.x).toBeLessThanOrEqual(extent.maxX + 1e-9);
        expect(grip.y).toBeGreaterThanOrEqual(extent.minY - 1e-9);
        expect(grip.y).toBeLessThanOrEqual(extent.maxY + 1e-9);
      }
    }
  });

  it('measures an extent a panel can be fitted to', () => {
    /*
     * The panel takes the gesture's own proportions, so what matters is whether
     * those proportions are usable — and for one of them they are not. The one
     * pattern is a vertical line: asking for its true aspect gives a panel a few
     * pixels wide beside the note list, which is why `panelAspect` clamps.
     *
     * Asserted as *which* patterns need the clamp rather than merely that the
     * clamp works, since a clamp always works. If the one pattern were ever
     * widened, or another shape went extreme, this says so.
     */
    for (const { n, pattern } of patterns) {
      const extent = extentOf(pattern, shape.lag);
      expect(extent.width, `${n} pattern width`).toBeGreaterThan(0.02);
      expect(extent.height, `${n} pattern height`).toBeGreaterThan(0.2);

      const raw = extent.width / extent.height;
      if (n === 1) {
        expect(raw, 'the one pattern is a line and must be clamped').toBeLessThan(
          PANEL_ASPECT_RANGE.min,
        );
      } else {
        expect(raw, `${n} pattern aspect`).toBeGreaterThanOrEqual(PANEL_ASPECT_RANGE.min);
        expect(raw, `${n} pattern aspect`).toBeLessThanOrEqual(PANEL_ASPECT_RANGE.max);
      }

      const panel = panelAspect(extent);
      expect(panel, `${n} panel aspect`).toBeGreaterThanOrEqual(PANEL_ASPECT_RANGE.min);
      expect(panel, `${n} panel aspect`).toBeLessThanOrEqual(PANEL_ASPECT_RANGE.max);
    }
  });
});
