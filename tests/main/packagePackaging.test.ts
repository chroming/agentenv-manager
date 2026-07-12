import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const readPngRgba = async (path: string) => {
  const file = await readFile(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  let idat = Buffer.alloc(0);

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const chunk = file.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      expect(chunk[8]).toBe(8);
      expect(chunk[9]).toBe(6);
    }
    if (type === "IDAT") {
      idat = Buffer.concat([idat, chunk]);
    }
    if (type === "IEND") {
      break;
    }
  }

  const raw = inflateSync(idat);
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const rows: Buffer[] = [];
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const scanline = raw.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const row = Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      const paeth = left + up - upperLeft;
      const pa = Math.abs(paeth - left);
      const pb = Math.abs(paeth - up);
      const pc = Math.abs(paeth - upperLeft);
      const paethPredictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
      const prior =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : filter === 4
                ? paethPredictor
                : 0;
      row[x] = (scanline[x] + prior) & 0xff;
    }

    rows.push(row);
    previous = row;
  }

  return {
    height,
    pixel: (x: number, y: number) => {
      const index = x * bytesPerPixel;
      const row = rows[y];
      return [row[index], row[index + 1], row[index + 2], row[index + 3]];
    },
    width
  };
};

describe("package metadata", () => {
  it("provides a painted renderer state before React mounts", async () => {
    const rendererHtml = await readFile(
      join(process.cwd(), "src", "renderer", "index.html"),
      "utf8"
    );

    expect(rendererHtml).toContain("data-agentenv-boot");
    expect(rendererHtml).toContain("background: #f6f8fc");
    expect(rendererHtml).toContain("prefers-reduced-motion: reduce");
  });

  it("exposes Electron packaging entrypoints", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
      build?: {
        appId?: string;
        productName?: string;
        directories?: { output?: string };
        mac?: { icon?: string; target?: string[] };
      };
    };

    expect(packageJson.devDependencies).toHaveProperty("electron-builder");
    expect(packageJson.scripts?.["icons:mac"]).toBe(
      "swift scripts/generate-mac-icon.swift"
    );
    expect(packageJson.scripts?.pack).toBe(
      "npm run icons:mac && npm run build && electron-builder --dir"
    );
    expect(packageJson.scripts?.dist).toBe(
      "npm run icons:mac && npm run build && electron-builder"
    );
    expect(packageJson.scripts?.["dist:mac"]).toBe(
      "npm run icons:mac && npm run build && electron-builder --mac"
    );
    expect(packageJson.scripts?.["test:e2e:packaged"]).toBe(
      "npm run pack && node scripts/test-packaged-app.mjs"
    );
    expect(packageJson.build).toMatchObject({
      appId: "com.agentenv.manager",
      productName: "AgentEnv Manager",
      directories: { output: "release" },
      mac: { icon: "build/icon.icns", target: ["dmg", "zip"] }
    });
    await expect(stat(join(process.cwd(), "build", "icon.icns"))).resolves.toMatchObject({
      size: expect.any(Number)
    });
    await expect(
      stat(join(process.cwd(), "src", "renderer", "assets", "app-icon.png"))
    ).resolves.toMatchObject({
      size: expect.any(Number)
    });
  });

  it("keeps the macOS icon corners transparent", async () => {
    const icon = await readPngRgba(join(process.cwd(), "build", "icon.png"));
    const cornerPixels = [
      icon.pixel(0, 0),
      icon.pixel(icon.width - 1, 0),
      icon.pixel(0, icon.height - 1),
      icon.pixel(icon.width - 1, icon.height - 1)
    ];

    for (const [, , , alpha] of cornerPixels) {
      expect(alpha).toBe(0);
    }
    expect(icon.pixel(Math.floor(icon.width / 2), Math.floor(icon.height / 2))[3]).toBe(255);
  });
});
