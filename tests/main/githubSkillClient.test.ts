import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("reuses immutable commit files when the same preview is materialized again", async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), "agentenv-github-client-immutable-first-"));
    const secondRoot = await mkdtemp(join(tmpdir(), "agentenv-github-client-immutable-second-"));
    temporaryDirectories.push(firstRoot, secondRoot);
    const commitUrl = "https://api.github.com/repos/example/skills/commits/main";
    const treeUrl = "https://api.github.com/repos/example/skills/git/trees/root-tree?recursive=1";
    const rawUrl = "https://raw.githubusercontent.com/example/skills/0123456789abcdef0123456789abcdef01234567/review/SKILL.md";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === commitUrl) {
        return responseFor({
          sha: "0123456789abcdef0123456789abcdef01234567",
          commit: { tree: { sha: "root-tree" } }
        });
      }
      if (url === treeUrl) {
        return responseFor({
          tree: [
            { path: "review/SKILL.md", type: "blob", sha: "skill-blob", mode: "100644" }
          ]
        });
      }
      if (url === rawUrl) {
        return {
          ...responseFor("# Review\n"),
          text: async () => "# Review\n"
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = createGitHubSkillClient({ fetchImpl });
    const source = parseGitHubSkillUrl("https://github.com/example/skills/tree/main/review");

    await client.readTree(source, firstRoot, { refresh: true, refreshFiles: true });
    await client.readTree(source, secondRoot, { refresh: true, refreshFiles: true });

    expect(fetchImpl.mock.calls.filter(([url]) => url === rawUrl)).toHaveLength(1);
    await expect(readFile(join(secondRoot, "SKILL.md"), "utf8")).resolves.toBe("# Review\n");
  });

  it("downloads only files whose Git blob differs from the current Library copy", async () => {
    const currentRoot = await mkdtemp(join(tmpdir(), "agentenv-github-client-current-"));
    const nextRoot = await mkdtemp(join(tmpdir(), "agentenv-github-client-next-"));
    temporaryDirectories.push(currentRoot, nextRoot);
    const unchanged = "Reference\n";
    const blobSha = (content: string) => createHash("sha1")
      .update(`blob ${Buffer.byteLength(content)}\0`)
      .update(content)
      .digest("hex");
    await mkdir(join(currentRoot, "docs"), { recursive: true });
    await writeFile(join(currentRoot, "SKILL.md"), "# Old\n", "utf8");
    await writeFile(join(currentRoot, "docs", "reference.md"), unchanged, "utf8");
    const commitUrl = "https://api.github.com/repos/example/skills/commits/main";
    const treeUrl = "https://api.github.com/repos/example/skills/git/trees/root-tree?recursive=1";
    const changedRawUrl = "https://raw.githubusercontent.com/example/skills/0123456789abcdef0123456789abcdef01234567/review/SKILL.md";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === commitUrl) {
        return responseFor({
          sha: "0123456789abcdef0123456789abcdef01234567",
          commit: { tree: { sha: "root-tree" } }
        });
      }
      if (url === treeUrl) {
        return responseFor({
          tree: [
            { path: "review/SKILL.md", type: "blob", sha: blobSha("# New\n"), mode: "100644" },
            {
              path: "review/docs/reference.md",
              type: "blob",
              sha: blobSha(unchanged),
              mode: "100644"
            }
          ]
        });
      }
      if (url === changedRawUrl) {
        return {
          ...responseFor("# New\n"),
          text: async () => "# New\n"
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = createGitHubSkillClient({ fetchImpl });

    await client.readTree(
      parseGitHubSkillUrl("https://github.com/example/skills/tree/main/review"),
      nextRoot,
      { refresh: true, refreshFiles: true, reuseRoot: currentRoot }
    );

    expect(fetchImpl.mock.calls.filter(([url]) => String(url).startsWith(
      "https://raw.githubusercontent.com/"
    ))).toEqual([[changedRawUrl, undefined]]);
    await expect(readFile(join(nextRoot, "SKILL.md"), "utf8")).resolves.toBe("# New\n");
    await expect(readFile(join(nextRoot, "docs", "reference.md"), "utf8"))
      .resolves.toBe(unchanged);
  });

  it("includes repository links in revision checks but requires safe materialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentenv-github-client-link-"));
    temporaryDirectories.push(root);
    const commitUrl = "https://api.github.com/repos/example/skills/commits/main";
    const treeUrl = "https://api.github.com/repos/example/skills/git/trees/root-tree?recursive=1";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === commitUrl) {
        return responseFor({ commit: { tree: { sha: "root-tree" } } });
      }
      if (url === treeUrl) {
        return responseFor({
          tree: [
            { path: "SKILL.md", type: "blob", sha: "skill-blob", mode: "100644" },
            { path: "AGENTS.md", type: "blob", sha: "agents-blob", mode: "100644" },
            { path: "CLAUDE.md", type: "blob", sha: "link-blob", mode: "120000" }
          ]
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = createGitHubSkillClient({ fetchImpl });
    const source = parseGitHubSkillUrl("https://github.com/example/skills/tree/main");

    await expect(client.readTree(source)).resolves.toMatchObject({
      hasSkillMd: true,
      revision: expect.stringMatching(/^[a-f0-9]{40}$/)
    });
    await expect(client.readTree(source, root)).rejects.toThrow(
      "GitHub Skill contains a symbolic link: CLAUDE.md"
    );
  });
});
