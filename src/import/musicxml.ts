/**
 * Reading navigation out of a MusicXML document.
 *
 * The half of the importer that touches the format. `unfold.ts` holds the
 * algorithm and knows nothing about XML; this knows about XML and holds no
 * algorithm, which is why the algorithm can be tested on structures written by
 * hand and this can be tested on documents written by hand.
 *
 * **The semantic layer, not the printed one.** Navigation appears twice in
 * MusicXML: as marks to engrave (`<words>D.S. al Coda</words>`, `<segno/>`)
 * and as `<sound>` attributes that exist so that software can play the piece.
 * The second is what is read, because it *names* its targets — a piece with two
 * segnos is unambiguous — and because the first would mean parsing English.
 *
 * The one concession: an engraved `<segno/>` or `<coda/>` with no `<sound>`
 * beside it still registers the mark, under no name. Exporters that write the
 * sign but not the semantics are common enough that refusing them would cost
 * more than the concession does, and an unnamed mark answers to any name, so a
 * part with one segno works and a part with two still needs the labels.
 */

import type { MeasureNav } from './unfold';

/** What `parseMusicXml` gives back: a document, or the reason there isn't one. */
export type Parsed = { doc: Document } | { problem: string };

/** The roots a MusicXML score can have. */
const PARTWISE = 'score-partwise';
const TIMEWISE = 'score-timewise';

/**
 * Parses the text of a MusicXML file.
 *
 * **`DOMParser` does not throw on malformed input.** It returns a document
 * containing a `parsererror` node, so the check has to be made explicitly —
 * which is the whole reason this function exists rather than the caller
 * calling `DOMParser` itself. Verified against both the browser and the test
 * environment.
 */
export function parseMusicXml(text: string): Parsed {
  const doc = new DOMParser().parseFromString(text, 'application/xml');

  if (doc.querySelector('parsererror')) {
    return { problem: 'this file is not readable as XML, so nothing could be imported' };
  }

  const root = doc.documentElement?.nodeName;
  if (root === TIMEWISE) {
    // Legal MusicXML, and vanishingly rare: it holds parts inside measures
    // rather than measures inside parts. Naming it beats "not MusicXML", which
    // is what a reader looking only for `score-partwise` would have said.
    return { problem: 'this is timewise MusicXML, which is not supported — export it as partwise' };
  }
  if (root !== PARTWISE) {
    return { problem: 'this file is XML but not MusicXML, so nothing could be imported' };
  }

  return { doc };
}

/** The parts in the document, in score order, for choosing between them. */
export function parts(doc: Document): Element[] {
  return [...doc.querySelectorAll(`${PARTWISE} > part`)];
}

/**
 * Names of the parts, for asking the player which one they are reading.
 *
 * Falls back to the part's id, then to its position: a `part-list` is required
 * but exporters have been known to leave the names off, and "Part 2" beats an
 * empty row in a chooser.
 */
export function partNames(doc: Document): string[] {
  return parts(doc).map((part, index) => {
    const id = part.getAttribute('id');
    const named = id
      ? doc.querySelector(`score-part[id="${CSS.escape(id)}"] > part-name`)
      : null;
    return named?.textContent?.trim() || id || `Part ${index + 1}`;
  });
}

/** Splits a MusicXML list attribute — `"1,2"`, `"1, 3"` — into numbers. */
function numberList(value: string | null): number[] | undefined {
  if (value === null) return undefined;
  const numbers = value
    .split(',')
    .map((piece) => Number(piece.trim()))
    .filter((n) => Number.isFinite(n));
  return numbers.length > 0 ? numbers : undefined;
}

function yes(value: string | null): boolean {
  return value === 'yes';
}

/**
 * The navigation marks of every measure of one part, in written order.
 *
 * Everything `unfold` needs and nothing else — no notes, no attributes, no
 * text. A part of two hundred bars usually comes back as two hundred nearly
 * empty objects, which is what makes this cheap enough to do on import.
 */
export function readNavigation(doc: Document, partIndex = 0): MeasureNav[] {
  const part = parts(doc)[partIndex];
  if (!part) return [];

  return [...part.querySelectorAll(':scope > measure')].map((measure) => {
    const nav: MeasureNav = {};
    const number = measure.getAttribute('number');
    if (number) nav.number = number;

    /*
     * `<sound>` sits either inside a `<direction>` or directly in the measure,
     * and both are legal and both occur — so every one in the measure is read
     * rather than only the ones in the place an exporter happened to choose.
     */
    for (const sound of measure.querySelectorAll('sound')) {
      const timeOnly = numberList(sound.getAttribute('time-only'));
      if (timeOnly) nav.timeOnly = timeOnly;

      const segno = sound.getAttribute('segno');
      if (segno !== null) nav.segno = segno;
      const coda = sound.getAttribute('coda');
      if (coda !== null) nav.coda = coda;
      const dalsegno = sound.getAttribute('dalsegno');
      if (dalsegno !== null) nav.dalsegno = dalsegno;
      const tocoda = sound.getAttribute('tocoda');
      if (tocoda !== null) nav.tocoda = tocoda;
      if (yes(sound.getAttribute('dacapo'))) nav.dacapo = true;
      if (yes(sound.getAttribute('fine'))) nav.fine = true;
      if (yes(sound.getAttribute('forward-repeat'))) nav.forwardRepeat = true;
    }

    // The engraved sign, where nothing semantic was written beside it. Under no
    // name, which is what lets a single segno still be found.
    if (nav.segno === undefined && measure.querySelector('direction-type > segno')) {
      nav.segno = '';
    }
    if (nav.coda === undefined && measure.querySelector('direction-type > coda')) {
      nav.coda = '';
    }

    for (const barline of measure.querySelectorAll(':scope > barline')) {
      const repeat = barline.querySelector(':scope > repeat');
      if (repeat) {
        if (repeat.getAttribute('direction') === 'forward') {
          nav.forwardRepeat = true;
        } else {
          const times = Number(repeat.getAttribute('times'));
          nav.backwardRepeat = {
            ...(Number.isFinite(times) && times > 0 ? { times } : {}),
            ...(yes(repeat.getAttribute('after-jump')) ? { afterJump: true } : {}),
          };
        }
      }

      const ending = barline.querySelector(':scope > ending');
      if (ending) {
        const type = ending.getAttribute('type');
        if (type === 'start') {
          // `number` may be absent or empty on a bracket that is drawn but not
          // numbered. Played on the first pass is the only sane reading.
          nav.endingStart = numberList(ending.getAttribute('number')) ?? [1];
        } else {
          // Both `stop` and `discontinue` close the bracket. They differ only
          // in whether a downward hook is drawn at the end of it.
          nav.endingStop = true;
        }
      }
    }

    return nav;
  });
}
