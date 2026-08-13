import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createUiStateStore } from "../../src/main/uiStateStore";
import {
  reorderPreferenceByDrop,
  reorderPreferenceByOffset
} from "../../src/shared/uiState";

const roots: string[] = [];

const createStore = async () => {
  const root = await mkdtemp(join(tmpdir(), "agentenv-ui-state-"));
  roots.push(root);
  const paths = createPaths({ appDataRoot: root });
  return { paths, store: createUiStateStore(paths) };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("uiStateStore", () => {
  it("uses one stable reorder contract for drag and keyboard moves", () => {
    expect(reorderPreferenceByDrop(["codex", "claude", "opencode"], "codex", "opencode"))
      .toEqual(["claude", "opencode", "codex"]);
    expect(reorderPreferenceByDrop(["codex", "claude", "opencode"], "opencode", "codex"))
      .toEqual(["opencode", "codex", "claude"]);
    expect(reorderPreferenceByOffset(["codex", "claude", "opencode"], "claude", -1))
      .toEqual(["claude", "codex", "opencode"]);
    expect(reorderPreferenceByOffset(["codex", "claude", "opencode"], "opencode", 1))
      .toEqual(["codex", "claude", "opencode"]);
  });

  it("starts with a stable versioned device-local state", async () => {
    const { store } = await createStore();
    await expect(store.read()).resolves.toEqual({
      version: 1,
      profileOrder: [],
      agentOrder: [],
      workspaceOrder: [],
      workspaceAgentSelections: {}
    });
  });

  it("atomically merges selection and normalized order updates", async () => {
    const { paths, store } = await createStore();
    await Promise.all([
      store.update({ selectedProfileId: "daily" }),
      store.update({ profileOrder: ["review", "daily", "review"] })
    ]);

    await expect(store.read()).resolves.toMatchObject({
      selectedProfileId: "daily",
      profileOrder: ["review", "daily"]
    });
    expect(JSON.parse(await readFile(paths.uiStatePath, "utf8"))).toMatchObject({
      version: 1,
      selectedProfileId: "daily"
    });
  });

  it("does not block startup when an older or damaged UI state is present", async () => {
    const { paths, store } = await createStore();
    await writeFile(paths.uiStatePath, "{not-json", "utf8");
    await expect(store.read()).resolves.toMatchObject({ version: 1, profileOrder: [] });
  });
});
