import { describe, expect, it } from "vitest";
import type { WorktreeEntry } from "../../src/shared/worktrees";
import { worktreeDisplayPath, worktreeStatus } from "../../src/renderer/worktreePresentation";

const entry: WorktreeEntry = {
  path: "/projects/app/.worktrees/task", repositoryPath: "/projects/app", commonDir: "/projects/app/.git",
  head: "a".repeat(40), branch: "task", main: false, detached: false, exists: true,
  state: "candidate", reasons: [], changes: [], ignored: [], submodules: false,
  cleanupReviewAvailable: true, manualReviewAvailable: true, headNeedsProtection: false
};

describe("worktreeStatus", () => {
  it.each<[Partial<WorktreeEntry>, string, "neutral" | "warning"]>([
    [{}, "No local changes", "neutral"],
    [{ keptReason: "Keep", changes: [" M file"] }, "Ignored", "neutral"],
    [{ repositoryKeptReason: "Keep" }, "Ignored", "neutral"],
    [{ locked: "Testing", exists: false }, "Git locked", "neutral"],
    [{ exists: false, prunable: "Gone" }, "Folder unavailable", "neutral"],
    [{ prunable: "Gone" }, "Registration needs repair", "neutral"],
    [{ pausedOperations: ["MERGE_HEAD"] }, "Unfinished Git operation", "neutral"],
    [{ localContentUncertain: true }, "Extra backup required", "neutral"],
    [{ reasons: ["Git operation in progress: active writer lock"] }, "Git write lock", "neutral"],
    [{ reasons: ["Git operation in progress"], changes: [" M file"] }, "Git operation in progress", "neutral"],
    [{ reasons: ["Unresolved Git conflicts"] }, "Unresolved Git conflicts", "warning"],
    [{ submodules: true }, "Contains submodules", "neutral"],
    [{ reasons: ["Contains a nested repository"] }, "Contains a nested repository", "neutral"],
    [{ state: "unavailable", changes: [" M file"] }, "Could not inspect Worktree", "neutral"],
    [{ ignored: ["cache/"], detached: true }, "Ignored files present", "warning"],
    [{ detached: true }, "Detached HEAD", "neutral"],
    [{ headNeedsProtection: true }, "Detached HEAD", "neutral"],
    [{ state: "review" }, "Review required", "neutral"],
    [{ state: "review", reasons: ["Choose an integration target"] }, "Integration not confirmed", "neutral"],
    [{ state: "review", reasons: ["Choose a target branch"] }, "Integration not confirmed", "neutral"],
    [{ state: "review", integration: { ref: "refs/heads/main", merged: false, explicit: true, choices: [] } }, "Integration not confirmed", "neutral"],
    [{ state: "review", integration: { ref: "refs/heads/task", merged: true, explicit: true, choices: [] } }, "Integration not confirmed", "neutral"],
    [{ state: "review", integration: { ref: "refs/heads/main", merged: true, explicit: true, choices: [] } }, "Review required", "neutral"]
  ])("presents %j as %s", (changes, message, tone) => {
    expect(worktreeStatus({ ...entry, ...changes })).toEqual({ message, tone });
  });

  it.each([1, 3])("retains the actual local-change count (%i) ahead of ignored and detached states", (count) => {
    expect(worktreeStatus({ ...entry, changes: Array.from({ length: count }, (_, index) => ` M file-${index}`), ignored: ["cache/"], detached: true }))
      .toEqual({ message: "{{count}} local changes", values: { count }, tone: "warning" });
  });
});

describe("worktreeDisplayPath", () => {
  it.each([
    ["/projects/app/.worktrees/task", "/projects/app", ".worktrees/task"],
    ["/projects/app/.worktrees/task", "/projects/app/", ".worktrees/task"],
    ["/projects/app-other/task", "/projects/app", "/projects/app-other/task"],
    ["/projects/app", "/projects/app", "/projects/app"],
    ["C:\\projects\\app\\.worktrees\\task", "C:\\projects\\app\\", ".worktrees/task"],
    ["D:\\trees\\task", "C:\\projects\\app", "D:\\trees\\task"]
  ])("displays %s relative to %s only for a true child", (path, repositoryPath, expected) => {
    expect(worktreeDisplayPath({ ...entry, path, repositoryPath })).toBe(expected);
  });
});
