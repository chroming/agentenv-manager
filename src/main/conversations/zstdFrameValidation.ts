// Validate framing only; Node's native decoder still owns decompression and checksums.
// Node 22 can silently accept truncated Zstd streams.
// https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
export async function* validateZstdFrames(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let state: "magic" | "descriptor" | "skip-size" | "block" = "magic";
  let header = Buffer.alloc(0);
  let skip = 0;
  let checksum = false;
  let frames = 0;
  const invalid = () => new Error("Compressed history is incomplete or invalid; cached history is kept. Refresh after the source file finishes writing.");
  for await (const chunk of source) {
    let offset = 0;
    let emitted = 0;
    while (offset < chunk.length) {
      if (skip > 0) {
        const count = Math.min(skip, chunk.length - offset);
        skip -= count;
        offset += count;
        if (skip === 0 && state === "magic") {
          yield chunk.subarray(emitted, offset);
          emitted = offset;
        }
        continue;
      }
      const required = state === "descriptor" ? 1 : state === "block" ? 3 : 4;
      const count = Math.min(required - header.length, chunk.length - offset);
      header = Buffer.concat([header, chunk.subarray(offset, offset + count)]);
      offset += count;
      if (header.length < required) continue;
      if (state === "magic") {
        const magic = header.readUInt32LE();
        if (magic === 0xfd2fb528) state = "descriptor";
        else if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) state = "skip-size";
        else throw invalid();
        frames++;
      } else if (state === "descriptor") {
        const flags = header[0];
        if (flags & 8) throw invalid();
        const single = Boolean(flags & 32);
        const sizeFlag = flags >> 6;
        const sizeBytes = sizeFlag === 0 ? (single ? 1 : 0) : 2 ** sizeFlag;
        skip = (single ? 0 : 1) + [0, 1, 2, 4][flags & 3] + sizeBytes;
        checksum = Boolean(flags & 4);
        state = "block";
      } else if (state === "skip-size") {
        skip = header.readUInt32LE();
        state = "magic";
      } else {
        const block = header.readUIntLE(0, 3);
        const type = (block >> 1) & 3;
        if (type === 3) throw invalid();
        skip = type === 1 ? 1 : block >> 3;
        if (block & 1) {
          skip += checksum ? 4 : 0;
          state = "magic";
        }
      }
      header = Buffer.alloc(0);
      // Older native decoders stop after the first frame in each input chunk.
      if (state === "magic" && skip === 0) {
        yield chunk.subarray(emitted, offset);
        emitted = offset;
      }
    }
    if (emitted < chunk.length) yield chunk.subarray(emitted);
  }
  if (!frames || state !== "magic" || skip || header.length) throw invalid();
}
