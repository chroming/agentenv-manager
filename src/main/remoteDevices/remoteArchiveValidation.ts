export const validateRemoteSnapshotArchive = (archive: Buffer) => {
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return;
    const type = String.fromCharCode(header[156] ?? 0).replace("\0", "");
    if (type === "1") throw new Error("Remote Agent snapshot contains a hard link");
    if (type === "2") {
      throw new Error("Remote Agent snapshot contains a symbolic link that could not be materialized safely");
    }
    if (!["", "0", "5", "7", "x", "g", "L", "K"].includes(type)) {
      throw new Error("Remote Agent snapshot contains an unsupported filesystem entry");
    }
    const rawSize = header.subarray(124, 136);
    if ((rawSize[0] ?? 0) & 0x80) {
      throw new Error("Remote Agent snapshot uses an unsupported archive size encoding");
    }
    const encodedSize = rawSize.toString("ascii").replaceAll("\0", "").trim();
    const size = encodedSize ? Number.parseInt(encodedSize, 8) : 0;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Remote Agent snapshot has an invalid archive entry size");
    }
    offset += 512 + Math.ceil(size / 512) * 512;
    if (offset > archive.length) {
      throw new Error("Remote Agent snapshot is truncated");
    }
  }
  if (offset !== archive.length) {
    throw new Error("Remote Agent snapshot is malformed");
  }
};
