// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { parseMusicXml, partNames, readNavigation } from './musicxml';
import { unfold } from './unfold';

/**
 * Reading MusicXML, against documents written by hand.
 *
 * A DOM is opted into here — the repo's tests run in node, where `DOMParser`
 * is undefined — and happy-dom was verified to parse MusicXML correctly,
 * including the `sound`, `ending` and `repeat` attributes these depend on.
 *
 * The documents are small on purpose. What is being checked is that the
 * navigation comes out of the format correctly; whether it then unfolds
 * correctly is `unfold.test.ts`'s job and is not repeated here, bar the one
 * end-to-end case at the bottom that proves the two halves meet.
 */

/** A partwise score around some measures. */
function score(measures: string, parts = '<score-part id="P1"><part-name>Eb Bass</part-name></score-part>'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>${parts}</part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;
}

function bars(...contents: string[]): string {
  return contents.map((c, i) => `<measure number="${i + 1}">${c}</measure>`).join('');
}

function navOf(measures: string): ReturnType<typeof readNavigation> {
  const parsed = parseMusicXml(score(measures));
  if ('problem' in parsed) throw new Error(parsed.problem);
  return readNavigation(parsed.doc);
}

describe('deciding whether there is anything to read', () => {
  it('catches malformed XML, which does not throw', () => {
    // `DOMParser` hands back a document with a `parsererror` node rather than
    // raising, so a reader that only caught exceptions would sail past this.
    const parsed = parseMusicXml('<score-partwise><part></score-partwise>');
    expect(parsed).toHaveProperty('problem');
    expect('problem' in parsed && parsed.problem).toContain('not readable as XML');
  });

  it('catches XML that is not MusicXML', () => {
    const parsed = parseMusicXml('<html><body>not music</body></html>');
    expect('problem' in parsed && parsed.problem).toContain('not MusicXML');
  });

  it('names timewise scores rather than calling them not MusicXML', () => {
    // Legal and rare. "Export it as partwise" is an instruction the player can
    // act on; "not MusicXML" about a MusicXML file is not.
    const parsed = parseMusicXml('<score-timewise version="4.0"></score-timewise>');
    expect('problem' in parsed && parsed.problem).toContain('partwise');
  });

  it('accepts a well-formed partwise score', () => {
    expect(parseMusicXml(score(bars('')))).toHaveProperty('doc');
  });
});

describe('reading the repeat signs', () => {
  it('reads a forward and a backward repeat off the barlines', () => {
    const nav = navOf(
      bars(
        '<barline location="left"><repeat direction="forward"/></barline>',
        '<barline location="right"><repeat direction="backward"/></barline>',
      ),
    );
    expect(nav[0].forwardRepeat).toBe(true);
    expect(nav[1].backwardRepeat).toEqual({});
  });

  it('reads the play count and the after-jump flag', () => {
    const nav = navOf(
      bars('<barline><repeat direction="backward" times="3" after-jump="yes"/></barline>'),
    );
    expect(nav[0].backwardRepeat).toEqual({ times: 3, afterJump: true });
  });

  it('reads a forward repeat written only in the sound layer', () => {
    const nav = navOf(bars('<sound forward-repeat="yes"/>'));
    expect(nav[0].forwardRepeat).toBe(true);
  });
});

describe('reading first- and second-time bars', () => {
  it('reads the numbers as a list, since "1,2" is legal', () => {
    const nav = navOf(bars('<barline><ending number="1,2" type="start"/></barline>'));
    expect(nav[0].endingStart).toEqual([1, 2]);
  });

  it('treats an unnumbered bracket as a first-time bar', () => {
    const nav = navOf(bars('<barline><ending type="start"/></barline>'));
    expect(nav[0].endingStart).toEqual([1]);
  });

  it('closes on discontinue as well as on stop', () => {
    // They differ only in whether a downward hook is drawn, which is a matter
    // for the engraver and not for the walk.
    const stop = navOf(bars('<barline><ending number="1" type="stop"/></barline>'));
    const cut = navOf(bars('<barline><ending number="1" type="discontinue"/></barline>'));
    expect(stop[0].endingStop).toBe(true);
    expect(cut[0].endingStop).toBe(true);
  });
});

describe('reading the jumps', () => {
  it('reads segno and dal segno with their labels', () => {
    const nav = navOf(
      bars('<direction><sound segno="verse"/></direction>', '<sound dalsegno="verse"/>'),
    );
    expect(nav[0].segno).toBe('verse');
    expect(nav[1].dalsegno).toBe('verse');
  });

  it('reads a sound element wherever it sits', () => {
    // Legal both inside a `direction` and loose in the measure, and exporters
    // differ, so both are read rather than whichever one was expected.
    const nav = navOf(bars('<direction><sound dacapo="yes"/></direction>', '<sound fine="yes"/>'));
    expect(nav[0].dacapo).toBe(true);
    expect(nav[1].fine).toBe(true);
  });

  it('reads to-coda and the coda it lands on', () => {
    const nav = navOf(bars('<sound tocoda="c1"/>', '<sound coda="c1"/>'));
    expect(nav[0].tocoda).toBe('c1');
    expect(nav[1].coda).toBe('c1');
  });

  it('reads time-only as the list of passes it is', () => {
    const nav = navOf(bars('<sound dalsegno="s" time-only="1,3"/>'));
    expect(nav[0].timeOnly).toEqual([1, 3]);
  });

  it('takes an engraved segno when nothing semantic was written beside it', () => {
    /*
     * The one concession to the printed layer. Exporters that draw the sign
     * without writing the `sound` attribute are common, and refusing them
     * would cost more than this does — the mark registers under no name, which
     * is enough for a part with one segno and not enough to guess between two.
     */
    const nav = navOf(
      bars('<direction><direction-type><segno/></direction-type></direction>', '<sound dalsegno=""/>'),
    );
    expect(nav[0].segno).toBe('');
  });

  it('prefers the label when both layers are written', () => {
    const nav = navOf(
      bars(
        '<direction><direction-type><segno/></direction-type><sound segno="named"/></direction>',
      ),
    );
    expect(nav[0].segno).toBe('named');
  });
});

describe('choosing a part', () => {
  it('names the parts, falling back when the name is missing', () => {
    const doc = parseMusicXml(
      `<score-partwise version="4.0">
        <part-list>
          <score-part id="P1"><part-name>Eb Bass</part-name></score-part>
          <score-part id="P2"/>
        </part-list>
        <part id="P1"/><part id="P2"/>
      </score-partwise>`,
    );
    if ('problem' in doc) throw new Error(doc.problem);
    expect(partNames(doc.doc)).toEqual(['Eb Bass', 'P2']);
  });

  it('reads the part asked for, not always the first', () => {
    const doc = parseMusicXml(
      `<score-partwise version="4.0">
        <part-list><score-part id="P1"/><score-part id="P2"/></part-list>
        <part id="P1">${bars('')}</part>
        <part id="P2">${bars('<sound dacapo="yes"/>', '')}</part>
      </score-partwise>`,
    );
    if ('problem' in doc) throw new Error(doc.problem);
    expect(readNavigation(doc.doc, 0)[0].dacapo).toBeUndefined();
    expect(readNavigation(doc.doc, 1)[0].dacapo).toBe(true);
  });

  it('comes back empty for a part that is not there', () => {
    const parsed = parseMusicXml(score(bars('')));
    if ('problem' in parsed) throw new Error(parsed.problem);
    expect(readNavigation(parsed.doc, 9)).toEqual([]);
  });
});

describe('the two halves meeting', () => {
  it('unfolds a part with a repeat, a first-time bar and a D.S. al Fine', () => {
    /*
     * The end-to-end case, written as a part would be:
     *
     *   1  segno, forward repeat
     *   2  first-time bar, backward repeat
     *   3  second-time bar
     *   4  Fine
     *   5  D.S. al Fine
     *
     * Played 1 2, back for 1 3 4 5, then the D.S. sends it to the segno and
     * the Fine stops it: 1 3 4. The repeat is not taken past the jump, and the
     * *second*-time bar is the one played there — the first-time bar's whole
     * job is to lead back into a repeat that is no longer being taken.
     */
    const nav = navOf(
      bars(
        '<direction><sound segno="s"/></direction><barline location="left"><repeat direction="forward"/></barline>',
        '<barline location="right"><ending number="1" type="start"/><repeat direction="backward"/></barline>' +
          '<barline location="right"><ending number="1" type="stop"/></barline>',
        '<barline location="left"><ending number="2" type="start"/></barline>' +
          '<barline location="right"><ending number="2" type="stop"/></barline>',
        '<sound fine="yes"/>',
        '<sound dalsegno="s"/>',
      ),
    );

    const { order, problems } = unfold(nav);
    expect(problems).toEqual([]);
    expect(order.map((i) => i + 1)).toEqual([1, 2, 1, 3, 4, 5, 1, 3, 4]);
  });

  it('says so, and plays straight through, when the D.S. has no segno', () => {
    const nav = navOf(bars('', '', '<sound dalsegno="missing"/>'));
    const { order, problems } = unfold(nav);

    expect(order).toEqual([0, 1, 2]);
    expect(problems[0]).toContain('bar 3');
    expect(problems[0]).toContain('segno');
  });
});
