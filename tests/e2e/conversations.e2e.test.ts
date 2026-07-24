import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import electronPath from "electron";
import {
  _electron as electron,
  type ElectronApplication
} from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectInViewport,
  expectNoHorizontalOverflow,
  findVisibleTextLayoutDefects
} from "./layoutAssertions";

let root = "";
let app: ElectronApplication | undefined;

afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const executable = async (path: string, content: string) => {
  await writeFile(path, `#!/bin/zsh\n${content}\n`, "utf8");
  await chmod(path, 0o755);
};

describe("Conversations desktop workflow", () => {
  it("indexes source-owned history and keeps the desktop workspace contained", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversations-e2e-"));
    const home = join(root, "home");
    const dataRoot = join(root, "data");
    const cacheRoot = join(root, "cache");
    const binDir = join(root, "bin");
    const sessionDir = join(home, ".codex", "sessions", "2026", "07", "24");
    const sourcePath = join(
      sessionDir,
      "rollout-2026-07-24T06-00-00-000Z-11111111-1111-4111-8111-111111111111.jsonl"
    );
    await mkdir(sessionDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const source = [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "11111111-1111-4111-8111-111111111111",
          cwd: "/work/release",
          timestamp: "2026-07-24T05:00:00.000Z"
        }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "user-1",
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Repair the desktop release workflow" }]
        }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "assistant-1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "The release workflow is ready." }]
        }
      })
    ].join("\n") + "\n";
    await writeFile(sourcePath, source, "utf8");
    await executable(join(binDir, "codex"), "exit 0");
    await executable(
      join(binDir, "opencode"),
      'if [[ "$1" == "session" ]]; then print "[]"; fi'
    );

    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [
        `--user-data-dir=${join(root, "electron-user-data")}`,
        join(process.cwd(), "out", "main", "main.js")
      ],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_DATA_ROOT: dataRoot,
        AGENTENV_CACHE_ROOT: cacheRoot,
        AGENTENV_HOME: home,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
      }
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1180, height: 760 });
    await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus()), {
      timeout: 15_000
    }).toEqual({ state: "ready" });

    await page
      .getByRole("complementary", { name: "Global navigation" })
      .getByRole("button", { name: "Conversations" })
      .click();
    await page.getByText("The release workflow is ready.").waitFor({
      state: "visible",
      timeout: 15_000
    });

    await expectNoHorizontalOverflow(page);
    await expectInViewport(page, page.getByRole("searchbox", {
      name: "Search conversations"
    }));
    await expectInViewport(page, page.getByRole("button", { name: "Continue" }));
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);

    await page.keyboard.press("Meta+F");
    await expect(page.getByRole("searchbox", {
      name: "Search conversations"
    }).evaluate((element) => element === document.activeElement)).resolves.toBe(true);
    await page.getByRole("searchbox", { name: "Search conversations" }).fill("desktop release");
    await expect(page.getByRole("option", {
      name: /Repair the desktop release workflow/
    }).count()).resolves.toBe(1);

    const preview = await page.evaluate(async () =>
      window.agentEnv.previewConversationContinuation({
        conversationId: "codex:11111111-1111-4111-8111-111111111111",
        targetId: "opencode"
      })
    );
    expect(preview).toMatchObject({
      mode: "context-file",
      requiresReview: false,
      portableMessageCount: 2
    });

    await page.setViewportSize({ width: 920, height: 620 });
    await expectNoHorizontalOverflow(page, [".conversation-page", ".conversation-layout"]);
    await expectInViewport(page, page.getByRole("button", { name: "Continue" }));
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
    expect(await readFile(sourcePath, "utf8")).toBe(source);
  }, 30_000);
});
