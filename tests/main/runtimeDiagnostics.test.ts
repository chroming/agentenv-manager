import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeDiagnostics,
  diagnosticReferenceFromMessage
} from "../../src/main/runtimeDiagnostics";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const createDiagnostics = async (options: { maxLogBytes?: number } = {}) => {
  root = await mkdtemp(join(tmpdir(), "agentenv-runtime-diagnostics-"));
  return createRuntimeDiagnostics({
    directory: root,
    homeDir: "/Users/example",
    appVersion: "0.1.0",
    buildCommit: "abc123",
    packaged: true,
    platform: "darwin",
    arch: "arm64",
    osVersion: "26.0",
    locale: "en-US",
    ...options
  });
};

describe("runtime diagnostics", () => {
  it("records a complete timeline for a successful fast operation", async () => {
    const diagnostics = await createDiagnostics();

    await expect(diagnostics.runIpcOperation(
      "profiles:list",
      [],
      async () => {
        await diagnostics.record("profiles:capture", "inventory-reviewed", {
          outcome: "decision-required",
          context: { targetId: "opencode", conflictCount: 1 }
        });
        return [];
      }
    )).resolves.toEqual([]);

    const events = await diagnostics.readRecentEvents();
    const operationEvents = events.filter((event) => event.action === "profiles:list");
    const captureEvent = events.find(
      (event) => event.action === "profiles:capture" && event.phase === "inventory-reviewed"
    );

    expect(operationEvents.map((event) => event.phase)).toEqual(["started", "completed"]);
    expect(operationEvents[1]).toMatchObject({
      outcome: "completed",
      context: { result: { count: 0 } }
    });
    expect(captureEvent).toMatchObject({
      outcome: "decision-required",
      context: { targetId: "opencode", conflictCount: 1 }
    });
    expect(captureEvent?.operationId).toBe(operationEvents[0]?.operationId);
  });

  it("exports a decision-required operation even when no exception was thrown", async () => {
    const diagnostics = await createDiagnostics();
    const reference = await diagnostics.record("profiles:capture", "decision-required", {
      outcome: "decision-required",
      context: {
        targetId: "claude-code",
        skillName: "review-helper",
        candidates: [
          { path: "/Users/example/.claude/skills/review-helper", contentHash: "a".repeat(64) },
          { path: "/Users/example/.agents/skills/review-helper", contentHash: "b".repeat(64) }
        ]
      }
    });
    const destination = join(root, "capture-report.json");

    await diagnostics.exportReport(destination, { reference });

    const report = await readFile(destination, "utf8");
    expect(report).toContain('"selectedOperation"');
    expect(report).toContain('"skillName": "review-helper"');
    expect(report).toContain("~/.claude/skills/review-helper");
    expect(report).not.toContain("/Users/example");
  });

  it("records a failed operation with a copyable reference and redacted cause chain", async () => {
    const diagnostics = await createDiagnostics();
    const cause = Object.assign(
      new Error("/Users/example/.claude/skills/demo token=ghp_abcdefghijklmnopqrstuvwxyz123456"),
      { code: "EEXIST" }
    );

    let thrown: Error | undefined;
    try {
      await diagnostics.runIpcOperation(
        "activation:apply",
        ["daily-coding", "preview-1"],
        async () => {
          throw new Error("Apply failed", { cause });
        }
      );
    } catch (error) {
      thrown = error as Error;
    }

    const reference = diagnosticReferenceFromMessage(thrown?.message ?? "");
    expect(reference).toMatch(/^AEM-\d{8}-[A-F0-9]{6}$/);
    const issue = await diagnostics.readIssue(reference!);
    expect(issue).toMatchObject({
      reference,
      action: "activation:apply",
      error: {
        message: "Apply failed",
        causes: [{ code: "EEXIST" }]
      }
    });
    expect(JSON.stringify(issue)).toContain("~/.claude/skills/demo");
    expect(JSON.stringify(issue)).not.toContain("/Users/example");
    expect(JSON.stringify(issue)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
  });

  it("uses an allowlisted argument summary instead of logging Profile or credential contents", async () => {
    const diagnostics = await createDiagnostics();
    await expect(diagnostics.runIpcOperation(
      "profiles:save",
      [{
        manifest: { id: "daily-coding", name: "Daily Coding" },
        instructions: "private instructions",
        resources: { secret: "should-not-be-recorded" }
      }],
      async () => {
        throw new Error("Save failed");
      }
    )).rejects.toThrow("Diagnostic reference");

    const content = await readFile(diagnostics.logPath, "utf8");
    expect(content).toContain("daily-coding");
    expect(content).not.toContain("private instructions");
    expect(content).not.toContain("should-not-be-recorded");
  });

  it("uses an allowlisted result summary instead of logging returned Profile contents", async () => {
    const diagnostics = await createDiagnostics();

    await diagnostics.runIpcOperation("profiles:read", ["daily-coding"], async () => ({
      id: "daily-coding",
      profile: {
        id: "daily-coding",
        instructions: "private returned instructions",
        resources: { token: "returned-secret" }
      }
    }));
    await diagnostics.runIpcOperation(
      "skills:read-file",
      ["daily-coding", "SKILL.md"],
      async () => "private direct file result"
    );

    await diagnostics.readRecentEvents();
    const content = await readFile(diagnostics.logPath, "utf8");
    expect(content).toContain("daily-coding");
    expect(content).not.toContain("private returned instructions");
    expect(content).not.toContain("returned-secret");
    expect(content).not.toContain("private direct file result");
  });

  it("keeps lifecycle and Preview work evidence in copyable diagnostics", async () => {
    const diagnostics = await createDiagnostics();

    await diagnostics.runIpcOperation("activation:preview", ["daily-coding", "opencode"], async () => ({
      id: "preview-1",
      profileId: "daily-coding",
      targetId: "opencode",
      operation: "apply",
      changes: [],
      resourceChanges: [],
      issues: [],
      targetStateChanged: false,
      sharedSkillPreparationChanged: false
    }));
    await diagnostics.runIpcOperation("targets:list-states", [], async () => ([{
      targetId: "opencode",
      activeProfileId: "daily-coding",
      lifecycleStatus: "pending",
      lifecycleReason: "Referenced Library resources changed after the last Apply",
      managedResourceCount: 3,
      warningCount: 0,
      errorCount: 0
    }]));

    await diagnostics.readRecentEvents();
    const content = await readFile(diagnostics.logPath, "utf8");
    expect(content).toContain('"targetStateChanged":false');
    expect(content).toContain('"resourceChanges":{"count":0}');
    expect(content).toContain('"activeProfileId":"daily-coding"');
    expect(content).toContain('"lifecycleStatus":"pending"');
    expect(content).toContain("Referenced Library resources changed after the last Apply");
  });

  it("never records clipboard content", async () => {
    const diagnostics = await createDiagnostics();
    await expect(diagnostics.runIpcOperation(
      "clipboard:write-text",
      ["private copied conversation content"],
      async () => {
        throw new Error("Clipboard failed");
      }
    )).rejects.toThrow();

    const content = await readFile(diagnostics.logPath, "utf8");
    expect(content).not.toContain("private copied conversation content");
  });

  it("keeps valid neighboring events readable when a log line is malformed", async () => {
    const diagnostics = await createDiagnostics();
    await expect(diagnostics.runIpcOperation(
      "skills:scan-inventory",
      [],
      async () => {
        throw new Error("Inventory failed");
      }
    )).rejects.toThrow();
    await writeFile(
      diagnostics.logPath,
      `${await readFile(diagnostics.logPath, "utf8")}{broken\n${JSON.stringify({
        schemaVersion: 1,
        at: "2026-07-28T00:00:00.000Z",
        reference: "AEM-20260728-BROKEN",
        action: "skills:scan-inventory",
        category: "skills",
        phase: "failed",
        error: { message: "Missing required error fields" }
      })}\n`
    );

    await expect(diagnostics.readLatestIssue()).resolves.toMatchObject({
      action: "skills:scan-inventory",
      error: { message: "Inventory failed" }
    });
  });

  it("exports a single redacted report with app and recent-operation context", async () => {
    const diagnostics = await createDiagnostics();
    await expect(diagnostics.runIpcOperation(
      "skills:import-repository",
      [{ source: "https://user:password@code.example/repo.git", sourcePath: "/Users/example/src" }],
      async () => {
        throw new Error("Repository failed");
      }
    )).rejects.toThrow();
    const destination = join(root, "report.json");

    await diagnostics.exportReport(destination, {
      context: {
        settings: { locale: "en", token: "never-log-this" },
        targets: [{ id: "codex", configPath: "/Users/example/.codex" }]
      }
    });

    const report = await readFile(destination, "utf8");
    expect(report).toContain('"buildCommit": "abc123"');
    expect(report).toContain("code.example/repo.git");
    expect(report).toContain("~/.codex");
    expect(report).not.toContain("user:password");
    expect(report).not.toContain("never-log-this");
  });

  it("rotates bounded logs and does not fail a user operation when logging is unavailable", async () => {
    const diagnostics = await createDiagnostics({ maxLogBytes: 1 });
    for (let index = 0; index < 3; index += 1) {
      await diagnostics.runIpcOperation(
        "profiles:save",
        [{ manifest: { id: `profile-${index}` } }],
        async () => ({ saved: true })
      );
    }
    await expect(readFile(`${diagnostics.logPath}.1`, "utf8")).resolves.toContain(
      "profiles:save"
    );

    const blockedPath = join(root, "not-a-directory");
    await writeFile(blockedPath, "file");
    const unavailable = createRuntimeDiagnostics({
      directory: blockedPath,
      homeDir: "/Users/example",
      appVersion: "0.1.0",
      packaged: false,
      platform: "darwin",
      arch: "arm64",
      osVersion: "26.0",
      locale: "en-US"
    });
    await expect(unavailable.runIpcOperation(
      "profiles:save",
      [{ manifest: { id: "safe" } }],
      async () => "saved"
    )).resolves.toBe("saved");
  });
});
