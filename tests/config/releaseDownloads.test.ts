import { describe, expect, it, vi } from "vitest";
import { startReleaseDownloads } from "../../scripts/with-release-downloads.mjs";

const redirect = "https://release-assets.githubusercontent.com/example?signature=fixture";
const file = "icons-bundle.tar.gz";
const path = `/builder/icons@1.2.3/${file}`;
const direct = "https://github.com/electron-userland/electron-builder-binaries/releases/download";
const api = "https://api.github.com/repos/electron-userland/electron-builder-binaries/releases";
const log = () => ({ warn: vi.fn(), error: vi.fn() });

describe("official release downloads", () => {
  it("keeps the direct official route and does not send credentials to it", async () => {
    const fetchAsset = vi.fn().mockResolvedValue(Response.redirect(redirect, 302));
    const downloads = await startReleaseDownloads({ fetchAsset, log: log() });
    try {
      const response = await fetch(downloads.origin + path, { redirect: "manual" });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(redirect);
      expect(fetchAsset).toHaveBeenCalledExactlyOnceWith(
        direct + "/icons@1.2.3/" + file,
        expect.objectContaining({ method: "HEAD", redirect: "manual" }),
      );
      expect(fetchAsset.mock.calls[0][1].headers).toBeUndefined();
    } finally {
      await downloads.close();
    }
  });

  it("recovers from the observed 504 using the exact asset in the official tag", async () => {
    const fetchAsset = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 504 }))
      .mockResolvedValueOnce(Response.json({ assets: [{ id: 12, name: "other.tar.gz" }, { id: 14, name: file }] }))
      .mockResolvedValueOnce(new Response("fixture archive", { headers: { "Content-Type": "application/octet-stream" } }));
    const downloads = await startReleaseDownloads({ fetchAsset, log: log() });
    try {
      const response = await fetch(downloads.origin + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("fixture archive");
      expect(fetchAsset).toHaveBeenNthCalledWith(2, api + "/tags/icons%401.2.3", expect.anything());
      expect(fetchAsset).toHaveBeenNthCalledWith(3, api + "/assets/14", expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/octet-stream" }),
        redirect: "manual",
      }));
    } finally {
      await downloads.close();
    }
  });

  it("rejects unknown routes and does not follow redirects outside GitHub asset hosts", async () => {
    const fetchAsset = vi.fn().mockResolvedValue(Response.redirect("https://example.invalid/file", 302));
    const downloads = await startReleaseDownloads({ fetchAsset, log: log() });
    try {
      expect((await fetch(downloads.origin + "/other/v1/file")).status).toBe(404);
      expect(fetchAsset).not.toHaveBeenCalled();
      const response = await fetch(downloads.origin + path, { redirect: "manual" });
      expect(response.status).toBe(502);
      expect(response.headers.get("location")).toBeNull();
      expect(fetchAsset).toHaveBeenCalledTimes(1);
    } finally {
      await downloads.close();
    }
  });
});
