import { createReadStream } from "node:fs";
import * as zlib from "node:zlib";
import { Readable } from "node:stream";
import { validateZstdFrames } from "./zstdFrameValidation";

// Read retries belong to observation, never to a cached mutation precondition.
export const retryHistoryRead = async <T>(read: () => Promise<T>, platform = process.platform): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === "ENOENT" || code === "EBUSY" ||
        (platform === "win32" && (code === "EPERM" || code === "EACCES"));
      if (!transient || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
};

export const isHistoryTextFile = (path: string) => /\.jsonl(?:\.zst)?$/i.test(path);

const decompress = () => {
  if (typeof zlib.createZstdDecompress !== "function") throw new Error("This runtime cannot decode compressed history. Update AgentEnv or use Node 22.15 or newer for development.");
  return zlib.createZstdDecompress();
};

export const historyTextStream = (path: string, start = 0) => {
  if (path.endsWith(".zst") && start !== 0) throw new Error("Compressed history cannot be resumed at a byte offset");
  const decoder = path.endsWith(".zst") ? decompress() : undefined;
  const source = createReadStream(path, { start });
  return decoder ? source.compose(validateZstdFrames).compose(decoder) : source;
};

// Bound decoded bytes too: a small compressed file can expand far beyond its size.
const collectText = async (input: Readable, maxBytes: number) => {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) throw new Error("History exceeds the text indexing limit; cached history is kept. Open the original conversation to read it.");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { input.destroy(); }
};

export const readHistoryText = (path: string, maxBytes = 256 * 1024 * 1024) =>
  retryHistoryRead(() => collectText(historyTextStream(path), maxBytes));

export const decodeHistoryBytes = (path: string, bytes: Buffer, maxBytes = 256 * 1024 * 1024) => {
  const input = Readable.from([bytes]);
  return collectText(path.endsWith(".zst") ? input.compose(validateZstdFrames).compose(decompress()) : input, maxBytes);
};
