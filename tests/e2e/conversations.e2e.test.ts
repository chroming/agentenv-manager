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
import { DatabaseSync } from "node:sqlite";
import electronPath from "electron";
import {
  _electron as electron,
  type ElectronApplication
} from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectInViewport,
  expectNoHorizontalOverflow,
  expectTopmost,
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
          content: [{
            type: "output_text",
            text: "## Result\n\nThe release workflow is ready.\n\n```ts\nconst ready = true;\n```"
          }]
        }
      })
    ].join("\n") + "\n";
    await writeFile(sourcePath, source, "utf8");
    const openCodeDataDir = join(home, ".local", "share", "opencode");
    const openCodeDatabasePath = join(openCodeDataDir, "opencode.db");
    await mkdir(openCodeDataDir, { recursive: true });
    const openCodeDatabase = new DatabaseSync(openCodeDatabasePath);
    openCodeDatabase.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        title TEXT NOT NULL,
        directory TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        time_archived INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      INSERT INTO session VALUES (
        'opencode-session',
        NULL,
        'New session - 2026-07-25T05:09:39.092Z',
        '/work/release',
        1784956179000,
        1784956187000,
        NULL
      );
      INSERT INTO message VALUES (
        'opencode-user',
        'opencode-session',
        1784956179111,
        '{"role":"user","time":{"created":1784956179111}}'
      );
      INSERT INTO part VALUES (
        'opencode-part',
        'opencode-user',
        'opencode-session',
        1784956179116,
        '{"type":"text","text":"测试111"}'
      );
    `);
    openCodeDatabase.close();
    const antigravityId = "8897ec06-6029-441b-a55c-f9283d9198a8";
    const antigravityDataDir = join(home, ".gemini", "antigravity-cli");
    const antigravityTranscriptDir = join(
      antigravityDataDir,
      "brain",
      antigravityId,
      ".system_generated",
      "logs"
    );
    await mkdir(antigravityTranscriptDir, { recursive: true });
    await mkdir(join(antigravityDataDir, "cache"), { recursive: true });
    await writeFile(
      join(antigravityDataDir, "cache", "last_conversations.json"),
      JSON.stringify({ "/work/release": antigravityId })
    );
    const antigravityTranscriptPath = join(
      antigravityTranscriptDir,
      "transcript.jsonl"
    );
    await writeFile(antigravityTranscriptPath, [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        created_at: "2026-07-25T05:10:03Z",
        content: "<USER_REQUEST>\n测试222\n</USER_REQUEST>"
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        created_at: "2026-07-25T05:10:04Z",
        content: "收到，测试正常。"
      })
    ].join("\n"));
    const openCodeSource = await readFile(openCodeDatabasePath);
    const antigravitySource = await readFile(antigravityTranscriptPath);
    await executable(join(binDir, "codex"), "exit 0");
    await executable(
      join(binDir, "opencode"),
      'if [[ "$1" == "session" ]]; then print "[]"; fi'
    );
    await executable(join(binDir, "agy"), "exit 0");
    await executable(join(binDir, "traecli"), "exit 0");

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
    await page.getByRole("option", { name: /测试111/ }).waitFor({
      state: "visible",
      timeout: 15_000
    });
    await page.getByRole("option", { name: /测试222/ }).waitFor({
      state: "visible",
      timeout: 15_000
    });
    expect(await page.locator(".conversation-list-item__agent img").count())
      .toBeGreaterThanOrEqual(3);
    await page.getByRole("option", {
      name: /Repair the desktop release workflow/
    }).click();
    const selectedRowGeometry = await page.getByRole("option", {
      name: /Repair the desktop release workflow/
    }).evaluate((row) => {
      const rowBounds = row.getBoundingClientRect();
      const titleBounds = row
        .querySelector(".conversation-list-item__title")!
        .getBoundingClientRect();
      const agent = row.querySelector(".conversation-list-item__agent")!;
      const iconBounds = agent
        .querySelector(".conversation-agent-icon")!
        .getBoundingClientRect();
      const agentBounds = agent.getBoundingClientRect();
      return {
        titleInset: Math.round(titleBounds.left - rowBounds.left),
        titleRightInset: Math.round(rowBounds.right - titleBounds.right),
        agentIconCenterDelta: Math.round(
          Math.abs(
            iconBounds.top + iconBounds.height / 2 -
            (agentBounds.top + agentBounds.height / 2)
          )
        )
      };
    });
    expect(selectedRowGeometry.titleInset).toBeLessThanOrEqual(10);
    expect(selectedRowGeometry.titleRightInset).toBeLessThanOrEqual(10);
    expect(selectedRowGeometry.agentIconCenterDelta).toBeLessThanOrEqual(1);
    await page.getByText("The release workflow is ready.").waitFor({
      state: "visible",
      timeout: 15_000
    });
    await page.getByRole("heading", { name: "Result" }).waitFor();

    await expectNoHorizontalOverflow(page);
    await expectInViewport(page, page.getByRole("searchbox", {
      name: "Search conversations"
    }));
    await expectInViewport(page, page.getByRole("button", { name: "Continue" }));
    const actionHeights = await page.locator(".conversation-detail-actions button").evaluateAll(
      (buttons) => buttons
        .map((button) => button.getBoundingClientRect())
        .filter((bounds) => bounds.width > 0 && bounds.height > 0)
        .map((bounds) => Math.round(bounds.height))
    );
    expect(new Set(actionHeights).size).toBe(1);
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
    if (process.env.AGENTENV_CAPTURE_CONVERSATIONS) {
      await page.screenshot({
        path: process.env.AGENTENV_CAPTURE_CONVERSATIONS,
        fullPage: true
      });
    }

    await page.getByRole("button", { name: "Continue" }).click();
    const targetMenu = page.getByRole("menu", { name: "Continue in" });
    await targetMenu.waitFor({ state: "visible" });
    await expectInViewport(page, targetMenu);
    await expectTopmost(targetMenu);
    expect(await targetMenu.getByText("Continue automatically", { exact: true }).count())
      .toBeGreaterThan(0);
    expect(await targetMenu.getByText("Copy and paste", { exact: true }).count())
      .toBeGreaterThan(0);
    const targetMenuGeometry = await targetMenu.evaluate((menu) => ({
      width: Math.round(menu.getBoundingClientRect().width),
      itemBorders: [...menu.querySelectorAll("button")].map(
        (button) => getComputedStyle(button).borderTopWidth
      ),
      modeRightEdges: [...menu.querySelectorAll(".conversation-target-menu__mode")]
        .map((mode) => Math.round(mode.getBoundingClientRect().right))
    }));
    expect(targetMenuGeometry.width).toBeGreaterThanOrEqual(280);
    expect(new Set(targetMenuGeometry.itemBorders)).toEqual(new Set(["0px"]));
    expect(new Set(targetMenuGeometry.modeRightEdges).size).toBe(1);
    if (process.env.AGENTENV_CAPTURE_CONVERSATIONS) {
      await page.screenshot({
        path: process.env.AGENTENV_CAPTURE_CONVERSATIONS.replace(
          /(\.[^.]+)$/,
          "-continue-menu$1"
        ),
        fullPage: true
      });
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Continue" }).evaluate(
      (element) => element === document.activeElement
    )).resolves.toBe(true);

    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("menuitem", { name: "Trae CLI, Copy and paste" }).click();
    const continuationReview = page.getByRole("dialog", {
      name: "Review continuation"
    });
    await continuationReview.waitFor({ state: "visible" });
    await expectTopmost(continuationReview);
    await continuationReview.getByText("Copy and paste", { exact: true }).waitFor();
    await continuationReview.getByText("Needs attention", { exact: true }).waitFor();
    await expectInViewport(
      page,
      continuationReview.getByRole("button", { name: "Copy and open Trae CLI" })
    );
    if (process.env.AGENTENV_CAPTURE_CONVERSATIONS) {
      await page.screenshot({
        path: process.env.AGENTENV_CAPTURE_CONVERSATIONS.replace(
          /(\.[^.]+)$/,
          "-continue-review$1"
        ),
        fullPage: true
      });
    }
    await page.keyboard.press("Escape");
    await continuationReview.waitFor({ state: "hidden" });

    await page.keyboard.press("Meta+F");
    await expect(page.getByRole("searchbox", {
      name: "Search conversations"
    }).evaluate((element) => element === document.activeElement)).resolves.toBe(true);
    await page.getByRole("searchbox", { name: "Search conversations" }).fill("desktop release");
    await expect(page.getByRole("option", {
      name: /Repair the desktop release workflow/
    }).count()).resolves.toBe(1);
    await expect(page.locator(".conversation-list-item__snippet").count()).resolves.toBe(0);

    const longSessionPath = join(
      sessionDir,
      "rollout-2026-07-25T07-00-00-000Z-22222222-2222-4222-8222-222222222222.jsonl"
    );
    const longSession = [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "22222222-2222-4222-8222-222222222222",
          cwd: "/work/performance",
          timestamp: "2026-07-25T07:00:00.000Z"
        }
      }),
      ...Array.from({ length: 65 }, (_, index) => JSON.stringify({
        type: "response_item",
        payload: {
          id: `long-message-${index}`,
          type: "message",
          role: index % 2 === 0 ? "user" : "assistant",
          content: [{
            type: index % 2 === 0 ? "input_text" : "output_text",
            text: index === 0 ? "Long conversation performance test" : `Message ${index}`
          }]
        }
      }))
    ].join("\n") + "\n";
    await writeFile(longSessionPath, longSession, "utf8");

    await page
      .getByRole("complementary", { name: "Global navigation" })
      .getByRole("button", { name: "Skills" })
      .click();
    await page
      .getByRole("complementary", { name: "Global navigation" })
      .getByRole("button", { name: "Conversations" })
      .click();
    await page.getByRole("option", {
      name: /Repair the desktop release workflow/
    }).waitFor();
    await page.waitForTimeout(450);
    await expect(page.getByRole("option", {
      name: /Long conversation performance test/
    }).count()).resolves.toBe(0);

    await page.getByRole("button", { name: "Refresh" }).click();
    await page.locator(".conversation-refresh-overlay").waitFor({ state: "visible" });
    await page.getByRole("option", {
      name: /Long conversation performance test/
    }).waitFor({ state: "visible", timeout: 15_000 });
    const pagedLongDetail = await page.evaluate(async () => {
      const value = await window.agentEnv.readConversation(
        "codex:22222222-2222-4222-8222-222222222222",
        { limit: 60, tail: true }
      );
      return {
        loadedMessageOffset: value.loadedMessageOffset,
        loaded: value.messages.length,
        total: value.messageCount
      };
    });
    expect(pagedLongDetail).toEqual({
      loadedMessageOffset: 5,
      loaded: 60,
      total: 65
    });
    await page.getByRole("option", {
      name: /Long conversation performance test/
    }).click();
    await page.getByText("Message 64", { exact: true }).waitFor();
    await expect(page.getByText("Message 1", { exact: true }).count()).resolves.toBe(0);
    await page.getByRole("button", { name: "Load earlier messages" }).click();
    await page.getByText("Message 1", { exact: true }).waitFor();

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
    const compactHeaderGeometry = await page.locator(".conversation-detail-header").evaluate(
      (header) => {
        const title = header.querySelector(".conversation-detail-title__copy")!
          .getBoundingClientRect();
        const workspace = header.querySelector(
          ".conversation-detail-metadata__workspace"
        );
        const more = header.querySelector(".conversation-detail-more-button")!
          .getBoundingClientRect();
        const secondary = header.querySelector(".conversation-detail-secondary-actions")!
          .getBoundingClientRect();
        return {
          height: Math.round(header.getBoundingClientRect().height),
          titleWidth: Math.round(title.width),
          workspaceDisplay: workspace ? getComputedStyle(workspace).display : "missing",
          moreWidth: Math.round(more.width),
          secondaryWidth: Math.round(secondary.width)
        };
      }
    );
    expect(compactHeaderGeometry.height).toBeLessThanOrEqual(96);
    expect(compactHeaderGeometry.titleWidth).toBeGreaterThanOrEqual(180);
    expect(compactHeaderGeometry.workspaceDisplay).toBe("none");
    expect(compactHeaderGeometry.moreWidth).toBeGreaterThan(0);
    expect(compactHeaderGeometry.secondaryWidth).toBe(0);
    await page.getByRole("button", { name: "Conversation actions" }).click();
    const compactActions = page.getByRole("menu", { name: "Conversation actions" });
    await compactActions.waitFor({ state: "visible" });
    await compactActions.getByRole("menuitem", { name: "Copy conversation" }).waitFor();
    await expectInViewport(page, compactActions);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Conversation actions" }).evaluate(
      (element) => element === document.activeElement
    )).resolves.toBe(true);
    await page.getByRole("button", { name: "Continue" }).click();
    const compactTargetMenu = page.getByRole("menu", { name: "Continue in" });
    await compactTargetMenu.waitFor({ state: "visible" });
    await expectInViewport(page, compactTargetMenu);
    if (process.env.AGENTENV_CAPTURE_CONVERSATIONS) {
      await page.screenshot({
        path: process.env.AGENTENV_CAPTURE_CONVERSATIONS.replace(
          /(\.[^.]+)$/,
          "-compact-continue-menu$1"
        ),
        fullPage: true
      });
    }
    await page.keyboard.press("Escape");
    expect(await page.locator(".conversation-page").evaluate(
      (element) => element.scrollHeight - element.clientHeight
    )).toBeLessThanOrEqual(1);
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
    if (process.env.AGENTENV_CAPTURE_CONVERSATIONS) {
      await page.screenshot({
        path: process.env.AGENTENV_CAPTURE_CONVERSATIONS.replace(
          /(\.[^.]+)$/,
          "-compact$1"
        ),
        fullPage: true
      });
    }
    expect(await readFile(sourcePath, "utf8")).toBe(source);
    expect(await readFile(longSessionPath, "utf8")).toBe(longSession);
    expect(await readFile(openCodeDatabasePath)).toEqual(openCodeSource);
    expect(await readFile(antigravityTranscriptPath)).toEqual(antigravitySource);
  }, 30_000);
});
