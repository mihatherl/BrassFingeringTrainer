import { describe, expect, it } from 'vitest';
import { unfold, type MeasureNav } from './unfold';

/**
 * Unfolding, checked against the shapes a real part actually uses.
 *
 * Written as bar letters rather than indices — `A B B C` reads as music and
 * `[0, 1, 1, 2]` does not, and every one of these cases was worked out by
 * asking what a player would do with the page in front of them.
 */

/** Names the bars A, B, C… so an expectation reads as the run of music it is. */
function played(measures: MeasureNav[]): string {
  const { order, problems } = unfold(measures);
  expect(problems, problems.join('; ')).toEqual([]);
  return order.map((i) => String.fromCharCode(65 + i)).join(' ');
}

/** Bars with nothing to say, which is nearly all of them. */
function plain(count: number): MeasureNav[] {
  return Array.from({ length: count }, (_, i) => ({ number: String(i + 1) }));
}

describe('a part with nothing in it', () => {
  it('plays straight through', () => {
    expect(played(plain(4))).toBe('A B C D');
  });

  it('survives being empty', () => {
    expect(unfold([])).toEqual({ order: [], problems: [] });
  });
});

describe('repeats', () => {
  it('plays a repeated section twice', () => {
    const bars = plain(4);
    bars[1].forwardRepeat = true;
    bars[2].backwardRepeat = {};
    expect(played(bars)).toBe('A B C B C D');
  });

  it('returns to the start when there is no forward repeat to return to', () => {
    // A backward repeat with nothing opening the section goes back to the top
    // of the part, which is what the sign means when it stands alone.
    const bars = plain(3);
    bars[1].backwardRepeat = {};
    expect(played(bars)).toBe('A B A B C');
  });

  it('counts playings, not jumps', () => {
    // `times="3"` is played three times — two jumps. Reading it as three jumps
    // is the easy mistake and gives four playings.
    const bars = plain(2);
    bars[0].forwardRepeat = true;
    bars[0].backwardRepeat = { times: 3 };
    expect(played(bars)).toBe('A A A B');
  });

  it('takes two repeated sections independently', () => {
    const bars = plain(4);
    bars[0].forwardRepeat = true;
    bars[0].backwardRepeat = {};
    bars[2].forwardRepeat = true;
    bars[3].backwardRepeat = {};
    expect(played(bars)).toBe('A A B C D C D');
  });
});

describe('first- and second-time bars', () => {
  it('plays the first time bar once and the second time bar once', () => {
    //  |: A  B :| with B a first-time bar and C a second-time bar
    const bars = plain(4);
    bars[0].forwardRepeat = true;
    bars[1].endingStart = [1];
    bars[1].endingStop = true;
    bars[1].backwardRepeat = {};
    bars[2].endingStart = [2];
    bars[2].endingStop = true;
    expect(played(bars)).toBe('A B A C D');
  });

  it('plays an ending marked for both passes on both', () => {
    // "1,2" over one bar is a legal way to write a bar played on either pass.
    const bars = plain(3);
    bars[0].forwardRepeat = true;
    bars[1].endingStart = [1, 2];
    bars[1].endingStop = true;
    bars[1].backwardRepeat = {};
    expect(played(bars)).toBe('A B A B C');
  });

  it('handles a first-time bar the engraver left unclosed', () => {
    // No stop on the first ending; the second one opening is what ends it.
    const bars = plain(4);
    bars[0].forwardRepeat = true;
    bars[1].endingStart = [1];
    bars[1].backwardRepeat = {};
    bars[2].endingStart = [2];
    bars[2].endingStop = true;
    expect(played(bars)).toBe('A B A C D');
  });
});

describe('da capo and dal segno', () => {
  it('goes back to the beginning and stops at Fine', () => {
    // A B C D, Fine at B, D.C. at D — the commonest shape there is.
    const bars = plain(4);
    bars[1].fine = true;
    bars[3].dacapo = true;
    expect(played(bars)).toBe('A B C D A B');
  });

  it('goes back to the segno by name', () => {
    const bars = plain(4);
    bars[1].segno = 'x';
    bars[3].dalsegno = 'x';
    bars[3].fine = true;
    // Plays through, jumps to B, and the Fine on D now stops it.
    expect(played(bars)).toBe('A B C D B C D');
  });

  it('tells two segnos apart, which is why the semantic layer is read', () => {
    // The printed layer says "D.S." twice and cannot say which; `dalsegno`
    // names its target, so this is unambiguous.
    const bars = plain(5);
    bars[0].segno = 'one';
    bars[2].segno = 'two';
    bars[4].dalsegno = 'two';
    bars[4].fine = true;
    expect(played(bars)).toBe('A B C D E C D E');
  });

  it('ignores a Fine reached before the jump', () => {
    // A Fine on the way through is an instruction for later. Stopping there
    // the first time would end the piece halfway and look deliberate.
    const bars = plain(3);
    bars[0].fine = true;
    bars[2].dacapo = true;
    expect(played(bars)).toBe('A B C A');
  });

  it('runs to the end when the jump has no Fine to stop it', () => {
    const bars = plain(3);
    bars[2].dacapo = true;
    expect(played(bars)).toBe('A B C A B C');
  });
});

describe('the coda', () => {
  it('leaves at the sign and lands on the coda, but only after the jump', () => {
    // A B(To Coda) C D(D.S. al Coda) E(coda). First time past B nothing
    // happens; after the jump it leaves.
    const bars = plain(5);
    bars[0].segno = 's';
    bars[1].tocoda = 'c';
    bars[3].dalsegno = 's';
    bars[4].coda = 'c';
    expect(played(bars)).toBe('A B C D A B E');
  });
});

describe('endings past a jump', () => {
  it('takes the last ending, not the first', () => {
    /*
     * |: A  B(1st) :| C(2nd)  D(Fine)  E(D.C.)
     *
     * A first-time bar exists to lead back into the repeat. A D.C. is not
     * repeating, so playing it there would end the section with a "go back"
     * gesture and then not go back — the ending that leads onward is the last
     * one, and that is the one taken.
     */
    const bars = plain(5);
    bars[0].forwardRepeat = true;
    bars[1].endingStart = [1];
    bars[1].endingStop = true;
    bars[1].backwardRepeat = {};
    bars[2].endingStart = [2];
    bars[2].endingStop = true;
    bars[3].fine = true;
    bars[4].dacapo = true;

    expect(played(bars)).toBe('A B A C D E A C D');
  });
});

describe('repeats across a jump', () => {
  it('does not take an ordinary repeat after a da capo', () => {
    /*
     * The ordinary reading of D.C.: go back and play through, without the
     * repeats. Taking them again is the fault that turns a three-minute march
     * into five.
     */
    const bars = plain(3);
    bars[0].forwardRepeat = true;
    bars[0].backwardRepeat = {};
    bars[2].dacapo = true;
    bars[2].fine = true;
    expect(played(bars)).toBe('A A B C A B C');
  });

  it('takes an after-jump repeat only after the jump', () => {
    // The exact opposite, and the case that makes hand-rolled unfolders wrong.
    const bars = plain(3);
    bars[0].forwardRepeat = true;
    bars[0].backwardRepeat = { afterJump: true };
    bars[2].dacapo = true;
    bars[2].fine = true;
    expect(played(bars)).toBe('A B C A A B C');
  });
});

describe('time-only', () => {
  it('takes a jump only on the pass it names', () => {
    // A D.S. written to act on the second pass and not the first.
    const bars = plain(3);
    bars[0].forwardRepeat = true;
    bars[1].backwardRepeat = {};
    bars[2].dacapo = true;
    bars[2].timeOnly = [2];
    // One pass through the repeat, then C, whose D.C. does not apply on pass 1.
    expect(played(bars)).toBe('A B A B C');
  });
});

describe('a part that cannot be unfolded', () => {
  it('plays straight through and says why, rather than half-unfolding', () => {
    /*
     * The decision recorded in `musicxml-import-plan.md`: a broken route
     * through the music is not missing music. Every note is present, so the
     * part is played as printed and the player is told the repeats were not
     * followed.
     */
    const bars = plain(3);
    bars[2].dalsegno = 'nowhere';

    const { order, problems } = unfold(bars);
    expect(order).toEqual([0, 1, 2]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('segno');
    expect(problems[0]).toContain('bar 3');
  });

  it('names the bar by its printed number, not by its index', () => {
    // Imported parts start at bar 1, at bar 0 with a pickup, or wherever the
    // movement began. The number on the page is the one to quote back.
    const bars = plain(2);
    bars[1].number = '48';
    bars[1].tocoda = 'missing';
    bars[1].dacapo = true;

    const { problems } = unfold(bars);
    expect(problems[0]).toContain('bar 48');
  });

  it('refuses a corrupt repeat count rather than hanging on it', () => {
    /*
     * Nothing in the format stops a file saying a bar is played a million
     * times. Every other rule here is bounded on its own, so this is the one
     * way in — and an importer that hangs or eats the memory on a bad file is
     * worse than one that refuses it.
     */
    const bars = plain(3);
    bars[0].forwardRepeat = true;
    bars[1].backwardRepeat = { times: 1_000_000 };

    const { order, problems } = unfold(bars);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('more music than a part could hold');
    expect(order).toEqual([0, 1, 2]);
  });

  it('takes a jump once, so a D.C. with no Fine ends the piece', () => {
    // Arriving at the same D.C. a second time means it has done its work. This
    // is the commonest shape in the repertoire and an endless loop without it,
    // so it is a rule rather than something the ceiling above catches.
    const bars = plain(2);
    bars[1].dacapo = true;
    expect(played(bars)).toBe('A B A B');
  });

  it('refuses an ending that never closes', () => {
    const bars = plain(3);
    bars[0].forwardRepeat = true;
    bars[1].endingStart = [1];
    bars[1].backwardRepeat = {};

    const { problems } = unfold(bars);
    expect(problems[0]).toContain('never closes');
  });
});
