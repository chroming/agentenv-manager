import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGitHubSkillClient,
  parseGitHubSkillUrl
} from "../../src/main/githubSkillClient";

const responseFor = (value: unknown) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  headers: new Headers(),
  json: async () => value,
  text: async () => JSON.stringify(value)
});

describe("github skill client caching", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ));
  });

  it("reuses successful responses only within the same authenticated account", async () => {
    let token = "first-account";
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      responseFor({ value: token })
    );
    const client = createGitHubSkillClient({
      fetchImpl,
      authTokenProvider: async () => token
    });

    await client.fetchJson("https://api.github.com/repos/example/skills");
    await client.fetchJson("https://api.github.com/repos/example/skills");
    token = "second-account";
    await client.fetchJson("https://api.github.com/repos/example/skills");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer first-account"
    });
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer second-account"
    });
  });

  it("performs a fresh request when an explicit check asks for refresh", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      responseFor({ request: fetchImpl.mock.calls.length })
    );
    const client = createGitHubSkillClient({ fetchImpl });
    const url = "https://api.github.com/repos/example/skills";

    await client.fetchJson(url);
    await client.fetchJson(url);
    await client.fetchJson(url, { refresh: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reuses a checked repository tree and downloads preview files concurrently", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentenv-github-client-"));
    temporaryDirectories.push(root);
    const commitUrl = "https://api.github.com/repos/example/skills/commits/main";
    const treeUrl = "https://api.github.com/repos/example/skills/git/trees/root-tree?recursive=1";
    let releaseFiles!: () => void;
    const filesReleased = new Promise<void>((resolve) => {
      releaseFiles = resolve;
    });
    let startedFiles = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === commitUrl) {
        return responseFor({ commit: { tree: { sha: "root-tree" } } });
      }
      if (url === treeUrl) {
        return responseFor({
          tree: [
            { path: "review", type: "tree", sha: "review-tree", mode: "040000" },
            { path: "review/SKILL.md", type: "blob", sha: "skill-blob", mode: "100644" },
            { path: "review/reference.md", type: "blob", sha: "reference-blob", mode: "100644" }
          ]
        });
      }
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        startedFiles += 1;
        if (startedFiles === 2) releaseFiles();
        await filesReleased;
        const content = url.endsWith("SKILL.md") ? "# Review\n" : "Reference\n";
        return {
          ...responseFor(content),
          text: async () => content
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = createGitHubSkillClient({ fetchImpl });

    await client.fetchJson(commitUrl, { refresh: true });
    await client.fetchJson(treeUrl, { refresh: true });
    const result = await client.readTree(
      parseGitHubSkillUrl("https://github.com/example/skills/tree/main/review"),
      root
    );

    expect(result.hasSkillMd).toBe(true);
    expect(startedFiles).toBe(2);
    expect(fetchImpl.mock.calls.filter(([url]) => url === commitUrl)).toHaveLength(1);
    expect(fetchImpl.mock.calls.filter(([url]) => url === treeUrl)).toHaveLength(1);
    await expect(readFile(join(root, "SKILL.md"), "utf8")).resolves.toBe("# Review\n");
    await expect(readFile(join(root, "reference.md"), "utf8")).resolves.toBe("Reference\n");
  });
});
