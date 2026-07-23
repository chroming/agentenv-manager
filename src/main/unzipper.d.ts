declare module "unzipper" {
  import type { Readable } from "node:stream";

  export interface ZipEntry {
    path: string;
    type: "Directory" | "File";
    flags: number;
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    externalFileAttributes: number;
    stream(password?: string): Readable;
  }

  export interface ZipDirectory {
    files: ZipEntry[];
  }

  export const Open: {
    file(path: string): Promise<ZipDirectory>;
  };
}
