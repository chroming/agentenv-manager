import { describe, expect, it, vi } from "vitest";
import { createReleaseClient } from "../../../src/main/appUpdates/releaseClient";

const releaseResponse = (overrides: Record<string, unknown> = {}) => ({
  tag_name: "v0.2.0",
  html_url: "https://github.com/chroming/agentenv-manager/releases/tag/v0.2.0",
  draft: false,
  prerelease: false,
  published_at: "2026-08-03T00:00:00Z",
  body: "Release notes",
  assets: [
    {
      name: "AgentEnv-Manager-0.2.0-mac-arm64.dmg",
      browser_download_url:
        "https://github.com/chroming/agentenv-manager/releases/download/v0.2.0/AgentEnv-Manager-0.2.0-mac-arm64.dmg",
      digest: `sha256:${"a".repeat(64)}`,
      size: 123
    }
  ],
  ...overrides
});

describe("release client", () => {
  it("accepts only an exact stable official release and architecture asset", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(releaseResponse()), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const client = createReleaseClient({ fetch });

    await expect(client.readLatest({ platform: "darwin", arch: "arm64" })).resolves.toMatchObject({
      version: "0.2.0",
      tag: "v0.2.0",
      releaseUrl: "https://github.com/chroming/agentenv-manager/releases/tag/v0.2.0",
      asset: {
        name: "AgentEnv-Manager-0.2.0-mac-arm64.dmg",
        sha256: "a".repeat(64)
      }
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/chroming/agentenv-manager/releases/latest",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: expect.any(String) }) })
    );
  });

  it("rejects prereleases, mutable URLs, missing digests, and wrong assets", async () => {
    for (const candidate of [
      releaseResponse({ prerelease: true }),
      releaseResponse({ html_url: "https://example.com/releases/v0.2.0" }),
      releaseResponse({ assets: [{ ...releaseResponse().assets[0], digest: null }] }),
      releaseResponse({ assets: [] })
    ]) {
      const client = createReleaseClient({
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(candidate), { status: 200 }))
      });
      await expect(client.readLatest({ platform: "darwin", arch: "arm64" })).rejects.toThrow();
    }
  });

  it("compares stable versions without accepting downgrades", () => {
    const client = createReleaseClient({ fetch: vi.fn() });
    expect(client.isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(client.isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(client.isNewer("0.1.9", "0.2.0")).toBe(false);
    expect(() => client.isNewer("nightly", "0.2.0")).toThrow("stable SemVer");
  });

  it("uses the saved GitHub account for release checks", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(releaseResponse()), {
      status: 200
    }));
    const client = createReleaseClient({
      fetch,
      authTokenProvider: vi.fn().mockResolvedValue("github-token")
    });

    await client.readLatest({ platform: "darwin", arch: "arm64" });

    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("Authorization")).toBe("Bearer github-token");
  });

  it("keeps checking anonymously when secure token storage is unavailable", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(releaseResponse()), {
      status: 200
    }));
    const client = createReleaseClient({
      fetch,
      authTokenProvider: vi.fn().mockRejectedValue(new Error("keychain unavailable"))
    });

    await client.readLatest({ platform: "darwin", arch: "arm64" });

    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).has("Authorization")).toBe(false);
  });

  it("turns GitHub rate limits into an actionable failure", async () => {
    const client = createReleaseClient({
      fetch: vi.fn().mockResolvedValue(new Response("rate limited", { status: 403 }))
    });

    await expect(client.readLatest({ platform: "darwin", arch: "arm64" })).rejects.toMatchObject({
      code: "rate-limited",
      message: "GitHub temporarily limited update checks. Connect GitHub or try again later."
    });
  });
});
