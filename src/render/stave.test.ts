import { describe, expect, it } from 'vitest';
import { parsePitch } from '../domain/pitch';
import { GLYPHS, glyphWidth, type GlyphName } from './glyphs';
import { isOnLine, measureStaveHeader, staveMetrics, yForPitch } from './stave';

/**
 * Vertical placement is the part of notation that is silently, embarrassingly
 * wrong if the reference pitches are off by a step — and it is not covered by
 * anything else, since drawing needs a real canvas. These check the geometry
 * against pitches every musician knows the position of by sight.
 */

const STAVE_SPACE = 10;
const TOP_LINE_Y = 100;
const treble = staveMetrics('treble', TOP_LINE_Y, STAVE_SPACE);
const bass = staveMetrics('bass', TOP_LINE_Y, STAVE_SPACE);

const line = (n: number) => TOP_LINE_Y + n * STAVE_SPACE;
const y = (m: typeof treble, name: string) => yForPitch(m, parsePitch(name));

describe('treble clef placement', () => {
  it('puts the five lines on E4 G4 B4 D5 F5, bottom to top', () => {
    expect(y(treble, 'E4')).toBe(line(4));
    expect(y(treble, 'G4')).toBe(line(3));
    expect(y(treble, 'B4')).toBe(line(2));
    expect(y(treble, 'D5')).toBe(line(1));
    expect(y(treble, 'F5')).toBe(line(0));
  });

  it('puts F4 A4 C5 E5 in the spaces', () => {
    expect(y(treble, 'F4')).toBe(line(3.5));
    expect(y(treble, 'A4')).toBe(line(2.5));
    expect(y(treble, 'C5')).toBe(line(1.5));
    expect(y(treble, 'E5')).toBe(line(0.5));
  });

  it('puts middle C one ledger line below the stave', () => {
    expect(y(treble, 'C4')).toBe(line(5));
    expect(isOnLine(treble, 35)).toBe(true); // C4
  });
});

describe('bass clef placement', () => {
  it('puts the five lines on G2 B2 D3 F3 A3, bottom to top', () => {
    expect(y(bass, 'G2')).toBe(line(4));
    expect(y(bass, 'B2')).toBe(line(3));
    expect(y(bass, 'D3')).toBe(line(2));
    expect(y(bass, 'F3')).toBe(line(1));
    expect(y(bass, 'A3')).toBe(line(0));
  });

  it('puts middle C one ledger line above the stave', () => {
    expect(y(bass, 'C4')).toBe(line(-1));
  });

  it('places the same written pitch differently from treble clef', () => {
    expect(y(bass, 'C4')).not.toBe(y(treble, 'C4'));
  });
});

describe('accidentals and position', () => {
  it('does not move a note', () => {
    // The whole point of separating spelling from pitch: F, F sharp and F flat
    // all sit on the F line.
    expect(y(treble, 'F4')).toBe(y(treble, 'F#4'));
    expect(y(treble, 'F4')).toBe(y(treble, 'Fb4'));
  });

  it('keeps enharmonics on their own letter’s line', () => {
    // Same sounding pitch, a stave position apart.
    expect(y(treble, 'F#4')).not.toBe(y(treble, 'Gb4'));
  });
});

describe('header measurement', () => {
  it('grows with the number of accidentals in the key signature', () => {
    const c = measureStaveHeader(treble, 0, 4, 4);
    const eFlat = measureStaveHeader(treble, -3, 4, 4);
    const cSharp = measureStaveHeader(treble, 7, 4, 4);

    expect(eFlat).toBeGreaterThan(c);
    expect(cSharp).toBeGreaterThan(eFlat);
  });

  it('leaves room for a two-digit time signature', () => {
    expect(measureStaveHeader(treble, 0, 12, 8)).toBeGreaterThan(
      measureStaveHeader(treble, 0, 4, 4),
    );
  });
});

describe('glyph data', () => {
  const names = Object.keys(GLYPHS) as GlyphName[];

  it('has outlines for every glyph the renderer asks for', () => {
    const required: GlyphName[] = [
      'gClef',
      'fClef',
      'accidentalSharp',
      'accidentalFlat',
      'accidentalNatural',
      'noteheadBlack',
      'noteheadHalf',
      'noteheadWhole',
      'flag8thUp',
      'flag8thDown',
      'flag16thUp',
      'flag16thDown',
      'restQuarter',
      'rest8th',
      'rest16th',
      'augmentationDot',
    ];
    for (const name of required) expect(names).toContain(name);
  });

  it.each(names)('%s has a usable outline and bounding box', (name) => {
    const glyph = GLYPHS[name];
    expect(glyph.d.length).toBeGreaterThan(10);
    expect(glyph.d.startsWith('M')).toBe(true);
    expect(glyph.bbox.right).toBeGreaterThan(glyph.bbox.left);
    expect(glyph.bbox.bottom).toBeGreaterThan(glyph.bbox.top);
  });

  it('is measured in stave spaces, not font units', () => {
    // A black notehead is a little over one stave space wide; if the scaling
    // were wrong this would be in the hundreds.
    expect(glyphWidth('noteheadBlack')).toBeGreaterThan(1);
    expect(glyphWidth('noteheadBlack')).toBeLessThan(2);
    // A treble clef spans about seven stave spaces vertically.
    const gClef = GLYPHS.gClef.bbox;
    expect(gClef.bottom - gClef.top).toBeGreaterThan(6);
    expect(gClef.bottom - gClef.top).toBeLessThan(9);
  });
});
