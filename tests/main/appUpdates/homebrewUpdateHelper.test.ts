import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  consumeHomebrewUpdateStartup,
  inspectHomebrewUpdateStartup,
  scheduleHomebrewUpdateAfterQuit,
  waitForHomebrewUpdateStartup
} from "../../../src/main/appUpdates/homebrewUpdateHelper";

const roots: string[] = [];

const createFakeBrew = async (options: { failUpgrade?: boolean } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "agentenv-homebrew-helper-"));
  roots.push(root);
  const brewPath = join(root, "brew");
  await writeFile(brewPath, `#!/bin/sh
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s\n' "$*" >> "$root/commands.log"
if [ "$1" = "upgrade" ]; then
  ${options.failUpgrade ? "exit 9" : "printf '%s\\n' '0.2.0' > \"$root/version\"; exit 0"}
fi
if [ "$1" = "list" ]; then
  printf 'agentenv-manager %s\n' "$(cat "$root/version")"
  exit 0
fi
exit 1
`, "utf8");
  await chmod(brewPath, 0o700);
  return { root, brewPath };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("automatic Homebrew update helper", () => {
  it("waits for a terminal state receipt after the detached helper exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentenv-homebrew-helper-settle-"));
    roots.push(root);
    const cacheDirectory = join(root, "cache");
    const updateDirectory = join(cacheDirectory, "automatic-homebrew-update");
    await mkdir(updateDirectory, { recursive: true });
    await writeFile(join(updateDirectory, "receipt.json"), `${JSON.stringify({
      schemaVersion: 1,
      expectedVersion: "0.2.0",
      helperPid: 2_147_483_647,
      scheduledAt: new Date().toISOString()
    })}\n`, "utf8");
    await writeFile(join(updateDirectory, "state"), "installing\n", "utf8");

    const terminalWrite = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        void writeFile(join(updateDirectory, "state"), "completed\n", "utf8")
          .then(() => resolve(), reject);
      }, 20);
    });

    await expect(inspectHomebrewUpdateStartup(cacheDirectory)).resolves.toEqual({
      state: "completed",
      expectedVersion: "0.2.0"
    });
    await terminalWrite;
  });

  it("finishes a scheduled update outside the parent process and records completion", async () => {
    const { root, brewPath } = await createFakeBrew();
    const cacheDirectory = join(root, "cache");

    const scheduled = await scheduleHomebrewUpdateAfterQuit({
      cacheDirectory,
      brewPath,
      expectedVersion: "0.2.0",
      applicationDirectory: "/Users/example/Applications",
      parentPid: 2_147_483_647
    });

    expect(scheduled.expectedVersion).toBe("0.2.0");
    await expect(waitForHomebrewUpdateStartup(cacheDirectory, {
      timeoutMs: 5_000,
      pollIntervalMs: 20
    })).resolves.toEqual({ state: "completed", expectedVersion: "0.2.0" });
    expect(await readFile(join(root, "commands.log"), "utf8")).toContain(
      "upgrade --cask --appdir=/Users/example/Applications chroming/tap/agentenv-manager"
    );

    await consumeHomebrewUpdateStartup(cacheDirectory);
    await expect(inspectHomebrewUpdateStartup(cacheDirectory)).resolves.toEqual({ state: "none" });
  });

  it("keeps an actionable failure receipt when Homebrew exits unsuccessfully", async () => {
    const { root, brewPath } = await createFakeBrew({ failUpgrade: true });
    const cacheDirectory = join(root, "cache");

    await scheduleHomebrewUpdateAfterQuit({
      cacheDirectory,
      brewPath,
      expectedVersion: "0.2.0",
      parentPid: 2_147_483_647
    });

    await expect(waitForHomebrewUpdateStartup(cacheDirectory, {
      timeoutMs: 5_000,
      pollIntervalMs: 20
    })).resolves.toMatchObject({
      state: "failed",
      expectedVersion: "0.2.0",
      message: expect.stringContaining("Homebrew upgrade exited with status 9")
    });
  });
});
