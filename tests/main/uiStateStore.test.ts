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
  it("merges concurrent per-view catalog preferences without losing other sorts or filters", async () => {
    const { paths, store } = await createStore();
    await store.update({ catalogViews: { skills: { sort: "references", statusFilter: "enabled" },
      sources: { scopeFilter: "manual" } }, profileOrder: ["daily"] });
    await Promise.all([
      store.update({ catalogViews: { skills: { tagFilter: "Review" } } }),
      store.update({ catalogViews: { instructions: { sort: "modified", usageFilter: "referenced" } } })
    ]);
    await expect(createUiStateStore(paths).read()).resolves.toMatchObject({ profileOrder: ["daily"], catalogViews: {
      skills: { sort: "references", statusFilter: "enabled", tagFilter: "Review" },
      sources: { scopeFilter: "manual" }, instructions: { sort: "modified", usageFilter: "referenced" }
    } });
    expect(() => store.update({ catalogViews: { skills: { sort: "invalid" } } } as never)).toThrow();
    await store.update({ catalogViews: { instructions: { usageFilter: "all" } } });
    await expect(store.read()).resolves.toMatchObject({ catalogViews: { instructions: { sort: "modified", usageFilter: "all" } } });
  });
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

  it("persists sorting across reloads without losing other device preferences", async () => {
    const { paths, store } = await createStore();
    await store.update({ selectedProfileId: "daily", workspaceOrder: ["workspace-a"],
      profileOrder: ["daily"], agentOrder: ["codex"], workspaceAgentSelections: { "workspace-a": "codex" }
    });
    await store.update({ worktreeSort: "modified-asc" });
    await expect(createUiStateStore(paths).read()).resolves.toMatchObject({
      selectedProfileId: "daily", workspaceOrder: ["workspace-a"], worktreeSort: "modified-asc",
      profileOrder: ["daily"], agentOrder: ["codex"], workspaceAgentSelections: { "workspace-a": "codex" }
    });
    expect(() => store.update({ worktreeSort: "invalid" } as never)).toThrow();
    await expect(store.read()).resolves.toMatchObject({ worktreeSort: "modified-asc" });
  });

  it("treats an empty patch as unchanged while allowing explicit order resets", async () => {
    const { store } = await createStore();
    await store.update({ profileOrder: ["daily"], agentOrder: ["codex"], workspaceOrder: ["workspace-a"] });
    const before = await store.read();
    await expect(store.update({})).resolves.toEqual(before);
    await expect(store.update({ workspaceOrder: [] })).resolves.toMatchObject({
      profileOrder: ["daily"], agentOrder: ["codex"], workspaceOrder: []
    });
  });
});
