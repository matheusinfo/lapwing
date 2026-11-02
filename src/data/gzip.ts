/**
 * Decompression with the browser's built-in `DecompressionStream` (no
 * dependency): gzip for `.gz` activity files, raw deflate for ZIP entries.
 */

/** Whether the bytes start with the gzip magic number (1f 8b). */
export const isGzip = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

/** Concatenates chunks into one array. */
export function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/**
 * Runs `bytes` through a `DecompressionStream`. The input is written directly
 * (rather than through `Blob.stream()`), which also works with Blob
 * implementations that lack streams. Rejects on corrupt data.
 */
export async function decompress(bytes: Uint8Array, format: CompressionFormat): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new DecompressionStream(format);
  const writer = stream.writable.getWriter();
  // Errors surface on the reader too; don't leave this promise unhandled.
  const writing = (async () => {
    await writer.write(bytes as Uint8Array<ArrayBuffer>);
    await writer.close();
  })().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await writing;
  return concatBytes(chunks);
}

/** Decompresses a gzip file. */
export const gunzip = (bytes: Uint8Array) => decompress(bytes, 'gzip');
