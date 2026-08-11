/**
 * Opening a `.mxl` file: compressed MusicXML, which is what notation software
 * saves by default.
 *
 * A `.mxl` is a zip holding the score plus a `META-INF/container.xml` that says
 * which entry is the score. Both MuseScore and Sibelius export this in
 * preference to plain XML, so an importer that only reads `.musicxml` fails on
 * the first file most people try.
 *
 * **No dependency.** `DecompressionStream('deflate-raw')` is built into both
 * the browser and the test environment, and deflate-raw is exactly what a zip
 * entry holds. What is left is the container format — a few offsets — and that
 * is what this file is. A zip library would be several hundred kilobytes to
 * read two entries out of an archive that has never had more than three.
 *
 * Only what a `.mxl` actually uses is implemented: stored and deflated entries,
 * no encryption, no spanning, no zip64. Anything else is reported rather than
 * guessed at.
 */

/** Signatures, little-endian, as they appear in the file. */
const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

/** Compression methods a `.mxl` uses. Anything else is refused. */
const STORED = 0;
const DEFLATED = 8;

/**
 * The end-of-directory record sits at the very end, after a comment that may be
 * up to 64k. Searching back that far and no further is the standard way in.
 */
const MAX_COMMENT = 0xffff;

export type Opened = { xml: string } | { problem: string };

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderAt: number;
}

/** Where the central directory begins, or -1 when this is not a zip at all. */
function findDirectory(view: DataView): number {
  const from = Math.max(0, view.byteLength - MAX_COMMENT - 22);
  for (let at = view.byteLength - 22; at >= from; at--) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) return view.getUint32(at + 16, true);
  }
  return -1;
}

function readDirectory(view: DataView, at: number): Entry[] {
  const entries: Entry[] = [];
  let cursor = at;

  while (cursor + 46 <= view.byteLength && view.getUint32(cursor, true) === DIRECTORY_ENTRY) {
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const name = new TextDecoder().decode(
      new Uint8Array(view.buffer, view.byteOffset + cursor + 46, nameLength),
    );

    entries.push({
      name,
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      localHeaderAt: view.getUint32(cursor + 42, true),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * The bytes of one entry.
 *
 * The compressed data does not begin at the local header: the name and the
 * extra field come first, and **the extra field's length in the local header
 * may differ from the one in the directory**, which is the classic way to read
 * a zip slightly wrong. So it is taken from the local header, where the data
 * actually is.
 */
async function readEntry(bytes: Uint8Array, view: DataView, entry: Entry): Promise<Uint8Array | null> {
  const at = entry.localHeaderAt;
  if (at + 30 > view.byteLength || view.getUint32(at, true) !== LOCAL_HEADER) return null;

  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  const from = at + 30 + nameLength + extraLength;
  const data = bytes.subarray(from, from + entry.compressedSize);

  if (entry.method === STORED) return data;
  if (entry.method !== DEFLATED) return null;

  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Which entry holds the score.
 *
 * `META-INF/container.xml` names it, and is the answer when it is there. The
 * fallback is the first XML entry outside `META-INF`, because a container that
 * has lost its manifest still has its score and refusing it would be pedantry.
 */
function scoreEntryName(entries: Entry[], manifest: string | null): string | null {
  if (manifest !== null) {
    const path = /full-path\s*=\s*"([^"]+)"/.exec(manifest)?.[1];
    if (path && entries.some((e) => e.name === path)) return path;
  }
  const fallback = entries.find(
    (e) => !e.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(e.name),
  );
  return fallback?.name ?? null;
}

/** Whether these bytes look like a zip rather than plain XML. */
export function isCompressed(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false;
  return new DataView(bytes).getUint32(0, true) === LOCAL_HEADER;
}

/** Reads the score XML out of a `.mxl` container. */
export async function openContainer(buffer: ArrayBuffer): Promise<Opened> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const directoryAt = findDirectory(view);
  if (directoryAt < 0 || directoryAt >= view.byteLength) {
    return { problem: 'this .mxl file is damaged and could not be opened' };
  }

  const entries = readDirectory(view, directoryAt);
  if (entries.length === 0) return { problem: 'this .mxl file is empty' };

  const manifest = entries.find((e) => e.name === 'META-INF/container.xml');
  const manifestText = manifest
    ? new TextDecoder().decode((await readEntry(bytes, view, manifest)) ?? new Uint8Array())
    : null;

  const name = scoreEntryName(entries, manifestText);
  if (name === null) return { problem: 'this .mxl file holds no score' };

  const entry = entries.find((e) => e.name === name);
  const data = entry ? await readEntry(bytes, view, entry) : null;
  if (!data) return { problem: 'the score inside this .mxl file could not be unpacked' };

  return { xml: new TextDecoder().decode(data) };
}

/**
 * Reads a chosen file, compressed or not.
 *
 * The one entry point a picker needs: it decides from the bytes rather than
 * from the extension, because a `.musicxml` that is really a zip and an `.mxl`
 * that is really plain XML both turn up, and the first four bytes never lie.
 */
export async function readScoreFile(buffer: ArrayBuffer): Promise<Opened> {
  if (isCompressed(buffer)) return openContainer(buffer);
  return { xml: new TextDecoder().decode(buffer) };
}
