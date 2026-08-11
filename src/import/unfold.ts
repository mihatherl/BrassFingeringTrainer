/**
 * Unfolding: repeats, endings and jumps resolved into playing order.
 *
 * In, the navigation marks of each written measure. Out, a list of source
 * measure indices in the order they are played — bar 5 appearing twice because
 * it is inside a repeat, the first-time bar appearing once, the coda arriving
 * where the sign sends you. Nothing else: no notes, no rendering, no audio.
 *
 * **Why unfolding rather than following the page.** Settled by the player on
 * 2026-08-11: a flat run is the shape every existing consumer already
 * understands, so the renderer, the transport and the scoring window need no
 * change at all. The cost is a piece longer than the printed part with its
 * structure gone from the page. See `docs/musicxml-import-plan.md`.
 *
 * **It reads the semantic layer, not the printed one.** MusicXML states
 * navigation twice: as engraved marks (`<words>D.S. al Coda</words>`) and as
 * `<sound>` attributes that exist so software can play the piece. This takes
 * the second, which is why a `dalsegno` here names its target and a piece with
 * two segnos is unambiguous. Parsing English out of free text is what the
 * first would require, and it is not done.
 *
 * Deliberately free of the DOM. The reader that turns a parsed document into
 * `MeasureNav[]` is the part that touches MusicXML; this part is the part with
 * the algorithm in it, and it is tested on structures written by hand.
 */

/**
 * What one written measure says about where to go next.
 *
 * Everything is optional because nearly every measure says nothing at all: a
 * part of two hundred bars carries perhaps six of these marks.
 */
export interface MeasureNav {
  /** The printed bar number, used only in problem messages. */
  number?: string;
  /** A forward repeat sign at the start of this measure. */
  forwardRepeat?: boolean;
  /** A backward repeat at the end of this measure. */
  backwardRepeat?: {
    /**
     * How many times the section is **played** — 2 by default, meaning played
     * twice and jumped back once. The count of jumps is one less, and
     * conflating the two is the bug this comment exists to prevent.
     */
    times?: number;
    /** Taken only after a jump. See `taking a repeat` below. */
    afterJump?: boolean;
  };
  /** An ending (a first- or second-time bar) opens here, played on these passes. */
  endingStart?: number[];
  /** An ending closes at the end of this measure. */
  endingStop?: boolean;
  /** This measure carries a segno, under this label. */
  segno?: string;
  /** This measure carries a coda, under this label. */
  coda?: string;
  /** Jump to the segno of this name. */
  dalsegno?: string;
  /** Jump to the beginning. */
  dacapo?: boolean;
  /** Jump to the coda of this name, once a jump has armed it. */
  tocoda?: string;
  /** Stop here, once a jump has been taken. */
  fine?: boolean;
  /**
   * Passes on which this measure's jumps apply, from `time-only`.
   *
   * Applies to the jumps and to `fine`, not to the repeats: a repeat's own
   * count already says which passes it acts on.
   */
  timeOnly?: number[];
}

export interface Unfolded {
  /**
   * Source measure indices in playing order.
   *
   * **Straight through when `problems` is not empty.** A part whose navigation
   * cannot be resolved is still a part: every note in it is present and
   * correct, and only the route through them is broken, so it is played as
   * printed rather than half-unfolded. A piece played once through is a
   * legitimate thing to practise; a piece unfolded halfway is not. The caller
   * says so to the player rather than quietly presenting it as the whole work.
   */
  order: number[];
  /** Empty when the navigation was followed to the end. */
  problems: string[];
}

/**
 * A ceiling on how long the output may get before the walk is abandoned.
 *
 * Every rule here is bounded on its own — a repeat by its count, an ending by
 * its passes, a jump because it is taken once — so this should be unreachable,
 * and it is here precisely because "should be" is not a guarantee to give a
 * file someone else wrote. The reachable way in is a corrupt `times`: nothing
 * stops a file saying a bar is played a million times, and an importer that
 * hangs or eats the memory on a bad file is worse than one that refuses it.
 *
 * Sixty-four passes over the whole part is far past anything written and far
 * short of a wait anyone would notice.
 */
const MAX_PASSES = 64;

/** Where an ending region closes, by the index it opens at. */
function endingRegions(measures: readonly MeasureNav[]): Map<number, number> {
  const stops = new Map<number, number>();
  for (let i = 0; i < measures.length; i++) {
    if (!measures[i].endingStart) continue;
    let stop = -1;
    for (let j = i; j < measures.length; j++) {
      /*
       * A new ending opening is what closes the one before it, where the
       * engraver left the stop off — and it is checked *before* the stop,
       * because the measure that opens the second-time bar usually closes it
       * too. Read the other way round, the first-time bar would be recorded as
       * running to the end of the second, and skipping it on the second pass
       * would skip both.
       */
      if (j > i && measures[j].endingStart) {
        stop = j - 1;
        break;
      }
      if (measures[j].endingStop) {
        stop = j;
        break;
      }
    }
    stops.set(i, stop);
  }
  return stops;
}

/** Where each labelled mark sits. An unlabelled mark answers to any name. */
function marksNamed(
  measures: readonly MeasureNav[],
  pick: (m: MeasureNav) => string | undefined,
): Map<string, number> {
  const at = new Map<string, number>();
  for (let i = 0; i < measures.length; i++) {
    const label = pick(measures[i]);
    if (label === undefined) continue;
    if (!at.has(label)) at.set(label, i);
    // The first unnamed one also answers to the empty label, so a file that
    // writes `<sound segno="x"/>` against `<sound dalsegno=""/>` still lands.
    if (!at.has('')) at.set('', i);
  }
  return at;
}

function appliesOnPass(m: MeasureNav, pass: number): boolean {
  return m.timeOnly === undefined || m.timeOnly.includes(pass);
}

/**
 * Resolves the written measures into the order they are played.
 *
 * The walk holds five things: where it is, which pass it is on through the
 * current repeated section, where that section began, how many times each
 * backward repeat has already sent it back, and whether a jump has been taken.
 *
 * **Order within a measure matters and is this.** A forward repeat and a segno
 * are at its start; everything else is at its end, and is read after the
 * measure has been played: to the coda, then stop, then the backward repeat,
 * then the jump. A bar carrying both a repeat and a D.C. therefore takes the
 * repeat first — which is right, since the repeat sign is inside the bar and
 * the D.C. is under it.
 *
 * **Taking a repeat.** A plain backward repeat is taken on the way through and
 * *not* after a jump; one marked `after-jump` is the exact opposite. That is
 * the ordinary reading of D.C. — go back and play through, without the repeats
 * — and the attribute's own shape argues for it: it is an opt-in, so the
 * behaviour it opts into cannot be the default.
 *
 * **Fine and the coda only act after a jump.** A Fine on the first pass is an
 * instruction for later, not a stop; a To Coda before the D.S. is the same. A
 * file that meant otherwise would have nowhere to go after them.
 */
export function unfold(measures: readonly MeasureNav[]): Unfolded {
  const problems: string[] = [];
  const straight = () => measures.map((_, i) => i);
  if (measures.length === 0) return { order: [], problems };

  const endings = endingRegions(measures);
  /*
   * The last ending of each run — the second-time bar, where there are two.
   *
   * After a jump this is the one that is played, and the others are not. A
   * first-time bar exists to lead back into the repeat; a D.C. or D.S. is not
   * repeating, so playing it would end the section with a "go back" gesture and
   * then not go back. The ending that leads onward is the last one.
   */
  const finalEndings = new Set<number>();
  for (const [start, stop] of endings) {
    if (stop >= 0 && !measures[stop + 1]?.endingStart) finalEndings.add(start);
  }
  const segnos = marksNamed(measures, (m) => m.segno);
  const codas = marksNamed(measures, (m) => m.coda);

  const named = (m: MeasureNav, i: number) => `bar ${m.number ?? i + 1}`;
  const fail = (message: string): Unfolded => {
    problems.push(message);
    return { order: straight(), problems };
  };

  const order: number[] = [];
  const backJumps = new Map<number, number>();
  /**
   * Jumps already taken, because a D.C. or D.S. is taken once.
   *
   * Arriving at one a second time — which is exactly what happens when a D.C.
   * has no Fine and the walk runs off the end again — means the jump has done
   * its work and the piece is over. Without this the commonest shape in the
   * repertoire is an endless loop.
   */
  const jumpsTaken = new Set<number>();
  const limit = measures.length * MAX_PASSES;

  let i = 0;
  let pass = 1;
  let sectionFrom = 0;
  let jumped = false;
  let codaArmed = false;

  while (i < measures.length) {
    if (order.length > limit) {
      return fail(
        'the repeats describe more music than a part could hold, so it cannot be unfolded',
      );
    }

    const m = measures[i];

    // A new section opens here. Arriving back at the one already open is the
    // repeat doing its job and must not reset the pass count.
    if (m.forwardRepeat && i !== sectionFrom) {
      sectionFrom = i;
      pass = 1;
    }

    // A first-time bar on the second pass is not played, and the walk steps
    // over the whole ending rather than into it.
    const opensEnding = m.endingStart;
    const playsEnding = jumped ? finalEndings.has(i) : opensEnding?.includes(pass);
    if (opensEnding && !playsEnding) {
      const stop = endings.get(i) ?? -1;
      if (stop < 0) {
        return fail(`${named(m, i)} opens a first- or second-time bar that never closes`);
      }
      i = stop + 1;
      continue;
    }

    order.push(i);

    if (codaArmed && m.tocoda !== undefined && appliesOnPass(m, pass)) {
      const target = codas.get(m.tocoda) ?? codas.get('');
      if (target === undefined) {
        return fail(`${named(m, i)} sends you to a coda that is not in the part`);
      }
      codaArmed = false;
      i = target;
      continue;
    }

    if (m.fine && jumped && appliesOnPass(m, pass)) break;

    const repeat = m.backwardRepeat;
    if (repeat && (jumped ? repeat.afterJump === true : repeat.afterJump !== true)) {
      // `times` counts playings; the jumps are one fewer.
      const plays = Math.max(2, repeat.times ?? 2);
      const done = backJumps.get(i) ?? 0;
      if (done < plays - 1) {
        backJumps.set(i, done + 1);
        pass++;
        i = sectionFrom;
        continue;
      }
      // Leaving the section behind, so the next one starts counting afresh.
      pass = 1;
    }

    if (appliesOnPass(m, pass) && !jumpsTaken.has(i) && (m.dalsegno !== undefined || m.dacapo)) {
      let target = 0;
      if (m.dalsegno !== undefined) {
        const found = segnos.get(m.dalsegno) ?? segnos.get('');
        if (found === undefined) {
          return fail(`${named(m, i)} sends you to a segno that is not in the part`);
        }
        target = found;
      }
      jumpsTaken.add(i);
      jumped = true;
      codaArmed = true;
      // Repeats are counted afresh past the jump, so an `after-jump` repeat is
      // taken now rather than being told it has already had its turn.
      backJumps.clear();
      pass = 1;
      sectionFrom = target;
      i = target;
      continue;
    }

    i++;
  }

  return { order, problems };
}
