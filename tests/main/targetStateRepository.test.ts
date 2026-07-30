import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import {
  createTargetStateRepository,
  InvalidTargetStateError
} from "../../src/main/targetStateRepository";
import { defaultTargetState } from "../../src/main/targetState";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const makeRepository = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-target-state-"));
  const paths = createPaths({
    appDataRoot: join(root, "data"),
    homeDir: join(root, "home")
  });
  return {
    paths,
    repository: createTargetStateRepository(paths)
  };
};

describe("target state repository", () => {
  it("returns a fresh default without creating a missing state file", async () => {
    const { repository } = await makeRepository();

    await expect(repository.read("codex")).resolves.toEqual({
      path: repository.pathFor("codex"),
      content: "",
      state: defaultTargetState()
    });
    await expect(readFile(repository.pathFor("codex"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("writes and parses versioned state atomically", async () => {
    const { repository } = await makeRepository();
    const state = {
      ...defaultTargetState(),
      activeProfileId: "daily-coding",
      appliedProfileHash: "profile-hash"
    };

    await repository.write("codex", state);

    const stored = await repository.read("codex");
    expect(stored.state).toEqual(state);
    expect(JSON.parse(stored.content)).toMatchObject({
      formatVersion: 3,
      activeProfileId: "daily-coding"
    });
  });

  it("fails closed without rewriting malformed state", async () => {
    const { paths, repository } = await makeRepository();
    await mkdir(paths.targetStatesDir, { recursive: true });
    await writeFile(repository.pathFor("codex"), "{ invalid json");

    await expect(repository.read("codex")).rejects.toBeInstanceOf(
      InvalidTargetStateError
    );
    await expect(readFile(repository.pathFor("codex"), "utf8")).resolves.toBe(
      "{ invalid json"
    );
  });
});
