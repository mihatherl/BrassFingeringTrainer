import { describe, expect, it } from 'vitest';
import { isCompressed, openContainer, readScoreFile } from './container';

/**
 * Opening a `.mxl`.
 *
 * The archives here are built byte by byte rather than fetched, so the test
 * says what a zip *is* and does not depend on a fixture nobody can read. Both
 * compression methods a `.mxl` uses are covered, because the two take different
 * paths through `readEntry` and only one of them involves inflating anything.
 */

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A zip holding the given entries, stored or deflated. */
async function zip(
  files: Array<{ name: string; text: string }>,
  method: 0 | 8 = 8,
): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const raw = encoder.encode(file.text);
    const data = method === 8 ? await deflate(raw) : raw;
    const name = encoder.encode(file.name);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc32(raw), true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(10, method, true);
    entryView.setUint32(16, crc32(raw), true);
    entryView.setUint32(20, data.length, true);
    entryView.setUint32(24, raw.length, true);
    entryView.setUint16(28, name.length, true);
    entryView.setUint32(42, offset, true);
    entry.set(name, 46);

    parts.push(local, data);
    directory.push(entry);
    offset += local.length + data.length;
  }

  const directorySize = directory.reduce((sum, e) => sum + e.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);

  const all = [...parts, ...directory, end];
  const total = all.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

const SCORE = '<score-partwise version="4.0"><part id="P1"/></score-partwise>';
const MANIFEST =
  '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>';

describe('opening a container', () => {
  it('reads the score the manifest points at', async () => {
    const bytes = await zip([
      { name: 'META-INF/container.xml', text: MANIFEST },
      { name: 'score.musicxml', text: SCORE },
    ]);
    expect(await openContainer(bytes)).toEqual({ xml: SCORE });
  });

  it('reads a stored entry as well as a deflated one', async () => {
    // Small scores are sometimes stored rather than compressed, and the two
    // take different paths — only one of them inflates anything.
    const bytes = await zip(
      [
        { name: 'META-INF/container.xml', text: MANIFEST },
        { name: 'score.musicxml', text: SCORE },
      ],
      0,
    );
    expect(await openContainer(bytes)).toEqual({ xml: SCORE });
  });

  it('falls back to the first score outside META-INF when the manifest is missing', async () => {
    // A container that lost its manifest still has its score, and refusing it
    // would be pedantry.
    const bytes = await zip([{ name: 'sheet.xml', text: SCORE }]);
    expect(await openContainer(bytes)).toEqual({ xml: SCORE });
  });

  it('ignores a manifest pointing at an entry that is not there', async () => {
    const bytes = await zip([
      { name: 'META-INF/container.xml', text: '<rootfile full-path="missing.xml"/>' },
      { name: 'actual.musicxml', text: SCORE },
    ]);
    expect(await openContainer(bytes)).toEqual({ xml: SCORE });
  });

  it('says so when there is no score in the archive', async () => {
    const bytes = await zip([{ name: 'notes.txt', text: 'hello' }]);
    expect(await openContainer(bytes)).toEqual({ problem: 'this .mxl file holds no score' });
  });

  it('says so when the archive is damaged', async () => {
    const damaged = encoder.encode('PK and then nonsense').buffer;
    expect(await openContainer(damaged)).toHaveProperty('problem');
  });
});

describe('deciding what a file is', () => {
  it('knows a zip from plain XML by its first bytes, not its name', async () => {
    // A `.musicxml` that is really a zip and an `.mxl` that is really plain XML
    // both turn up. The first four bytes never lie.
    const compressed = await zip([{ name: 'score.musicxml', text: SCORE }]);
    expect(isCompressed(compressed)).toBe(true);
    expect(isCompressed(encoder.encode(SCORE).buffer)).toBe(false);
  });

  it('reads either kind through one door', async () => {
    const compressed = await zip([{ name: 'score.musicxml', text: SCORE }]);
    expect(await readScoreFile(compressed)).toEqual({ xml: SCORE });
    expect(await readScoreFile(encoder.encode(SCORE).buffer)).toEqual({ xml: SCORE });
  });
});
