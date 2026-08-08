import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("UI contract audit", () => {
  it("keeps shared row ownership and strict region evidence registered", async () => {
    const result = await execFileAsync(process.execPath, ["scripts/audit-ui-contracts.mjs"], {
      cwd: process.cwd()
    });

    expect(result.stdout).toContain("UI contract audit passed.");
  });
});
