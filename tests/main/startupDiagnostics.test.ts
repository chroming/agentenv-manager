import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDataFormatError } from "../../src/main/appDataFormat";
import { classifyStartupFailure, createStartupDiagnostics } from "../../src/main/startupDiagnostics";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("startup diagnostics", () => {
  it("classifies newer data separately from malformed data", () => {
    expect(classifyStartupFailure(new AppDataFormatError("newer", "future"))).toMatchObject({
      state: "failed",
      kind: "newer-data-format"
    });
    expect(classifyStartupFailure(new AppDataFormatError("invalid", "broken"))).toMatchObject({
      state: "failed",
      kind: "invalid-data"
    });
  });

  it("redacts home paths and credential-shaped values", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-diagnostics-"));
    const diagnostics = createStartupDiagnostics({ directory: root, homeDir: "/Users/example" });
    await diagnostics.record("failed", new Error("/Users/example/data token=ghp_abcdefghijklmnopqrstuvwxyz123456"));
    const content = await readFile(diagnostics.logPath, "utf8");

    expect(content).toContain("~/data");
    expect(content).not.toContain("/Users/example");
    expect(content).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
  });
});
