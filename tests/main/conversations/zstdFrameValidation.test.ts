import { Readable } from "node:stream";
import { constants, zstdCompressSync } from "node:zlib";
import { expect, it } from "vitest";
import { validateZstdFrames } from "../../../src/main/conversations/zstdFrameValidation";
import { decodeHistoryBytes } from "../../../src/main/conversations/historyFileReader";

const validate = async (bytes: Buffer) => {
  const output: Buffer[] = [];
  for await (const chunk of validateZstdFrames(Readable.from([...bytes].map((byte) => Buffer.from([byte]))))) output.push(chunk);
  return Buffer.concat(output);
};

it("rejects every truncated prefix, including checksum bytes, with byte-sized chunks", async () => {
  const bytes = zstdCompressSync("fixture history", { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
  expect(await validate(bytes)).toEqual(bytes);
  for (let end = 0; end < bytes.length; end++) {
    await expect(validate(bytes.subarray(0, end))).rejects.toThrow("incomplete");
    await expect(decodeHistoryBytes("fixture.zst", bytes.subarray(0, end))).rejects.toThrow();
  }
});

it("accepts empty, concatenated and skippable frames and rejects trailing partial frames", async () => {
  const skip = Buffer.alloc(11);
  skip.writeUInt32LE(0x184d2a50);
  skip.writeUInt32LE(3, 4);
  const bytes = Buffer.concat([zstdCompressSync(""), skip, zstdCompressSync("one"), zstdCompressSync("two")]);
  expect(await validate(bytes)).toEqual(bytes);
  expect(await decodeHistoryBytes("fixture.zst", bytes)).toBe("onetwo");
  await expect(validate(Buffer.concat([bytes, Buffer.from([0x28])]))).rejects.toThrow("incomplete");
});

it("accepts streamed multi-block frames without a content-size field", async () => {
  const text = "fixture history\n".repeat(30000);
  const bytes = zstdCompressSync(text, { params: { [constants.ZSTD_c_contentSizeFlag]: 0 } });
  expect(await validate(bytes)).toEqual(bytes);
  expect(await decodeHistoryBytes("fixture.zst", bytes)).toBe(text);
});
