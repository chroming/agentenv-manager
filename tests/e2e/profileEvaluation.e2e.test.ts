import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { createGitCommandRunner, type GitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import {
  expectInViewport,
  expectNoHorizontalOverflow,
  expectNoOverlap,
  findVisibleTextLayoutDefects
} from "./layoutAssertions";
import { requireCurrentElectronBuild } from "./currentBuild";

let root = "";
let app: ElectronApplication | undefined;
let git: GitCommandRunner | undefined;

requireCurrentElectronBuild();

afterEach(async () => {
  await app?.close().catch(() => undefined);
  git?.dispose();
  app = undefined;
  git = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const writeJson = (path: string, value: unknown) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const gitExecutable = (process.env.PATH ?? "")
  .split(delimiter)
  .map((entry) => join(entry, process.platform === "win32" ? "git.exe" : "git"))
  .find(existsSync);

const verifyDialogLayout = async (
  page: Page,
  selector: string,
  width: number,
  height: number
) => {
  await page.setViewportSize({ width, height });
  const dialog = page.locator(selector);
  await expectInViewport(page, dialog);
  await expectNoHorizontalOverflow(page, [selector]);
  expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
  const geometry = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const footer = element.querySelector(".ui-dialog-footer")?.getBoundingClientRect();
    return {
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      footerInside: footer
        ? footer.left >= bounds.left && footer.right <= bounds.right && footer.bottom <= bounds.bottom
        : false
    };
  });
  expect(geometry.width).toBeLessThanOrEqual(width - 24);
  expect(geometry.height).toBeLessThanOrEqual(height - 24);
  expect(geometry.footerInside).toBe(true);
};

const verifyWorkspaceChoiceLayout = async (dialog: ReturnType<Page["getByRole"]>) => {
  const options = dialog.getByRole("radio");
  expect(await options.count()).toBe(2);
  const [first, second] = await Promise.all([
    options.nth(0).boundingBox(),
    options.nth(1).boundingBox()
  ]);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(Math.abs(first!.width - second!.width)).toBeLessThanOrEqual(1);
};

const verifyMaximizedDialogLayout = async (
  page: Page,
  dialog: ReturnType<Page["getByRole"]>,
  width: number,
  height: number
) => {
  await page.setViewportSize({ width, height });
  await dialog.getByRole("button", { name: "Maximize preview" }).click();
  await expect.poll(() => dialog.getAttribute("class")).toContain("is-maximized");
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(Math.abs(bounds!.width - (width - 16))).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds!.height - (height - 16))).toBeLessThanOrEqual(1);
  expect(bounds!.x).toBeGreaterThanOrEqual(7);
  expect(bounds!.y).toBeGreaterThanOrEqual(7);
  expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
  if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
    await mkdir(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, { recursive: true });
    await page.screenshot({
      path: join(
        process.env.AGENTENV_EVALUATION_CAPTURE_DIR,
        `comparison-maximized-${width}x${height}.png`
      )
    });
  }
  await dialog.getByRole("button", { name: "Restore preview size" }).click();
  await expect.poll(() => dialog.getAttribute("class")).not.toContain("is-maximized");
};

const verifyProfileComparisonActionLayout = async (page: Page, width: number, height: number) => {
  await page.setViewportSize({ width, height });
  const actions = page.getByRole("group", { name: "Selected Profile actions" });
  const compare = actions.getByRole("button", { name: "Compare" });
  const apply = actions.getByRole("button", { name: "Apply" });
  await expectInViewport(page, actions);
  await expectNoOverlap(compare, apply);
  const [compareBox, applyBox] = await Promise.all([compare.boundingBox(), apply.boundingBox()]);
  expect(compareBox).not.toBeNull();
  expect(applyBox).not.toBeNull();
  expect(compareBox!.x).toBeLessThan(applyBox!.x);
  expect(applyBox!.x - (compareBox!.x + compareBox!.width)).toBeLessThanOrEqual(10);
  expect(Math.abs(compareBox!.height - applyBox!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(compareBox!.width - applyBox!.width)).toBeLessThanOrEqual(1);
};

const verifyComparisonResultNavigation = async (dialog: ReturnType<Page["getByRole"]>) => {
  const tabs = dialog.getByRole("tablist", { name: "Comparison result views" });
  const selected = tabs.getByRole("tab", { selected: true });
  const appearance = await selected.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderBottomWidth: style.borderBottomWidth,
      height: Math.round(element.getBoundingClientRect().height)
    };
  });
  expect(appearance.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(appearance.borderBottomWidth).toBe("0px");
  expect(appearance.height).toBeGreaterThanOrEqual(24);
  expect(await tabs.getByRole("tab").count()).toBe(4);
};

describe.skipIf(process.platform !== "darwin" || !gitExecutable)(
  "isolated Environment comparison desktop workflow",
  () => {
    it("runs Current and Proposed on one snapshot without changing the real Agent or folder", async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-comparison-e2e-"));
      const home = join(root, "home");
      const dataRoot = join(root, "data");
      const cacheRoot = join(root, "cache");
      const binDir = join(root, "bin");
      const workspace = join(root, "workspace");
      const profileDir = join(dataRoot, "profiles", "evaluation-profile");
      const librarySkill = join(dataRoot, "skills-library", "evaluation-skill");
      const realOpenCodeDir = join(home, ".config", "opencode");
      const realInstructions = join(realOpenCodeDir, "AGENTS.md");
      const realSecret = join(home, "private-secret.txt");
      const fakeOpenCode = join(binDir, "opencode");
      await Promise.all([
        mkdir(profileDir, { recursive: true }),
        mkdir(librarySkill, { recursive: true }),
        mkdir(realOpenCodeDir, { recursive: true }),
        mkdir(binDir, { recursive: true }),
        mkdir(workspace, { recursive: true }),
        mkdir(join(workspace, ".opencode", "skills", "project-only"), { recursive: true })
      ]);
      await writeJson(join(dataRoot, "agentenv-data.json"), { formatVersion: 2 });
      await writeJson(join(dataRoot, "settings.json"), {
        locale: "en",
        conversationTerminal: "default",
        skillSyncMethod: "symlink",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: false,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds: ["opencode"],
        agentDiscoveryVersion: 1,
        agentDiscoveryReviewedIds: ["opencode"]
      });
      await writeJson(join(profileDir, "profile.json"), {
        id: "evaluation-profile",
        name: "Evaluation Environment",
        description: "Isolated comparison proof",
        preferredTargetId: "opencode",
        version: 2
      });
      await writeFile(
        join(profileDir, "INSTRUCTIONS.md"),
        "# Proposed Environment instructions\n",
        "utf8"
      );
      await writeJson(join(profileDir, "resources.json"), {
        skills: [{
          libraryId: "evaluation-skill",
          targetName: "evaluation-skill",
          enabled: true
        }],
        managementByTarget: {
          opencode: { instructions: "manage", skills: "manage" }
        },
        mcpByTarget: {
          opencode: { mode: "disable", selections: [] }
        }
      });
      await writeFile(
        join(librarySkill, "SKILL.md"),
        "---\nname: evaluation-skill\ndescription: Comparison proof.\n---\n\n# Evaluation Skill\n",
        "utf8"
      );
      await writeJson(join(librarySkill, ".agentenv-skill.json"), {
        sourceType: "local",
        updateCheckEnabled: false,
        globallyEnabled: true,
        contentHash: "seed-evaluation-skill",
        updatedAt: "2026-08-01T00:00:00.000Z"
      });
      await writeFile(realInstructions, "# Current Agent instructions\n", "utf8");
      await writeFile(realSecret, "must-not-be-readable\n", "utf8");
      await writeJson(join(realOpenCodeDir, "opencode.jsonc"), { theme: "real-agent-theme" });
      await writeFile(join(workspace, "README.md"), "# Original Workspace\n", "utf8");
      await writeFile(join(workspace, "AGENTS.md"), "# Project instructions must be masked\n", "utf8");
      await writeFile(join(workspace, ".env"), "PRIVATE_TOKEN=do-not-copy\n", "utf8");
      await writeJson(join(workspace, "opencode.json"), {
        mcp: { projectOnly: { type: "local", command: ["echo"] } }
      });
      await writeFile(
        join(workspace, ".opencode", "skills", "project-only", "SKILL.md"),
        "---\nname: project-only\ndescription: Must not enter Environment Comparison.\n---\n",
        "utf8"
      );
      git = createGitCommandRunner({ executablePath: gitExecutable! });
      await git.run(["-C", workspace, "init"]);
      await git.run(["-C", workspace, "config", "user.name", "AgentEnv E2E"]);
      await git.run(["-C", workspace, "config", "user.email", "e2e@agentenv.local"]);
      await git.run(["-C", workspace, "add", "README.md"]);
      await git.run(["-C", workspace, "commit", "-m", "initial"]);
      await writeFile(join(workspace, "LOCAL-NOTES.md"), "Uncommitted content is included\n", "utf8");
      const workspaceStatusBefore = (await git.run([
        "-C", workspace, "status", "--porcelain=v1", "--untracked-files=all"
      ])).stdout;

      await writeFile(fakeOpenCode, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '1.18.0\\n'
  exit 0
fi
if [ "$1" = "session" ]; then
  printf '[]\\n'
  exit 0
fi
workspace_dir=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--dir" ]; then
    workspace_dir="$2"
    shift 2
  else
    shift
  fi
done
environment=current
profile_loaded=false
skill_loaded=false
grep -q 'Proposed Environment instructions' "$OPENCODE_CONFIG_DIR/AGENTS.md" && environment=proposed && profile_loaded=true
[ -f "$OPENCODE_CONFIG_DIR/skills/evaluation-skill/SKILL.md" ] && grep -q 'Evaluation Skill' "$OPENCODE_CONFIG_DIR/skills/evaluation-skill/SKILL.md" && skill_loaded=true
home_isolated=false
project_resources_excluded=false
config_restricted=false
local_content_included=false
sensitive_content_excluded=false
real_home_read_blocked=false
[ "$HOME" != "$AGENTENV_E2E_REAL_HOME" ] && home_isolated=true
[ ! -e "$workspace_dir/AGENTS.md" ] && [ ! -e "$workspace_dir/opencode.json" ] && [ ! -e "$workspace_dir/.opencode" ] && project_resources_excluded=true
[ -e "$workspace_dir/LOCAL-NOTES.md" ] && local_content_included=true
[ ! -e "$workspace_dir/.env" ] && sensitive_content_excluded=true
if real_secret=$(cat "$AGENTENV_E2E_REAL_SECRET"); then
  real_home_read_blocked=false
else
  real_home_read_blocked=true
fi
grep -q '"\\*": "deny"' "$OPENCODE_CONFIG_DIR/opencode.jsonc" && grep -q '"edit": "allow"' "$OPENCODE_CONFIG_DIR/opencode.jsonc" && ! grep -q '"mcp"' "$OPENCODE_CONFIG_DIR/opencode.jsonc" && config_restricted=true
if printf 'forbidden' > "$AGENTENV_E2E_ORIGINAL_WORKSPACE/forbidden.txt"; then
  printf '{"type":"error","error":{"data":{"message":"original Workspace was writable"}}}\\n'
  exit 4
fi
if printf 'forbidden' > "$AGENTENV_E2E_REAL_AGENT_FILE"; then
  printf '{"type":"error","error":{"data":{"message":"real Agent was writable"}}}\\n'
  exit 5
fi
sleep 2
printf '%s output\\n' "$environment" > "$workspace_dir/$environment-output.txt"
printf '{"type":"text","part":{"text":"environment=%s profile=%s skill=%s isolated=%s project-resources-excluded=%s local-content=%s sensitive-content-excluded=%s real-home-read-blocked=%s config-restricted=%s"}}\\n' "$environment" "$profile_loaded" "$skill_loaded" "$home_isolated" "$project_resources_excluded" "$local_content_included" "$sensitive_content_excluded" "$real_home_read_blocked" "$config_restricted"
printf '{"type":"step_finish","part":{"modelID":"fake/e2e","cost":0.01,"tokens":{"input":12,"output":5,"cache":{"read":3}}}}\\n'
`, "utf8");
      await chmod(fakeOpenCode, 0o755);

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
          AGENTENV_AUTOMATION_BACKGROUND_DELAY_MS: "0",
          AGENTENV_AUTOMATION_TARGET_PATH: binDir,
          AGENTENV_DATA_ROOT: dataRoot,
          AGENTENV_CACHE_ROOT: cacheRoot,
          AGENTENV_HOME: home,
          AGENTENV_E2E_REAL_HOME: home,
          AGENTENV_E2E_ORIGINAL_WORKSPACE: workspace,
          AGENTENV_E2E_REAL_AGENT_FILE: realInstructions,
          AGENTENV_E2E_REAL_SECRET: realSecret,
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
        }
      });
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 920, height: 620 });
      await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus()), {
        timeout: 15_000
      }).toEqual({ state: "ready" });
      await app.evaluate(
        ({ dialog }, selectedPath) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [selectedPath],
            bookmarks: []
          });
        },
        workspace
      );

      await page.getByRole("button", { name: "Profiles" }).click();
      await page.getByRole("button", { name: "Profile Evaluation Environment" }).click();
      await verifyProfileComparisonActionLayout(page, 920, 620);
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await mkdir(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, { recursive: true });
        await page.screenshot({
          path: join(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, "comparison-profile-actions-920x620.png")
        });
      }
      await verifyProfileComparisonActionLayout(page, 1180, 728);
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await page.screenshot({
          path: join(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, "comparison-profile-actions-1180x728.png")
        });
      }
      await verifyProfileComparisonActionLayout(page, 1440, 900);
      await page.getByRole("button", { name: "Compare" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Compare Evaluation Environment on OpenCode"
      });
      await dialog.waitFor({ state: "visible" });
      await dialog.getByText("Temporary empty Workspace").waitFor();
      expect(await dialog.getByText("Agent", { exact: true }).count()).toBe(0);
      await verifyDialogLayout(page, ".profile-comparison-dialog", 920, 620);
      await verifyWorkspaceChoiceLayout(dialog);
      await verifyMaximizedDialogLayout(page, dialog, 920, 620);
      await verifyDialogLayout(page, ".profile-comparison-dialog", 1180, 728);
      await verifyWorkspaceChoiceLayout(dialog);

      await dialog.getByRole("radio", { name: "Local folder" }).click();
      await dialog.getByText(workspace).waitFor();
      await dialog.getByText(/files ·/).waitFor();
      await verifyDialogLayout(page, ".profile-comparison-dialog", 920, 620);
      await verifyWorkspaceChoiceLayout(dialog);
      await verifyDialogLayout(page, ".profile-comparison-dialog", 1180, 728);
      await verifyWorkspaceChoiceLayout(dialog);
      await verifyDialogLayout(page, ".profile-comparison-dialog", 1440, 900);
      await verifyWorkspaceChoiceLayout(dialog);
      await dialog.getByRole("textbox", { name: "Task" }).fill("Create isolated comparison files");
      const runButton = dialog.getByRole("button", { name: "Run comparison" });
      await expect.poll(() => runButton.isEnabled()).toBe(true);
      expect(await runButton.getAttribute("aria-busy")).toBe("false");
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await mkdir(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, { recursive: true });
        await page.screenshot({
          path: join(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, "comparison-setup-1180x728.png")
        });
      }

      await runButton.click();
      await dialog.getByRole("status").waitFor({ timeout: 15_000 });
      await verifyDialogLayout(page, ".profile-comparison-dialog", 920, 620);
      await verifyDialogLayout(page, ".profile-comparison-dialog", 1180, 728);
      await page.setViewportSize({ width: 920, height: 620 });
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await page.screenshot({
          path: join(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, "comparison-active-920x620.png")
        });
      }
      await dialog.getByText("Comparison completed").waitFor({ timeout: 20_000 });
      await verifyDialogLayout(page, ".profile-comparison-dialog", 920, 620);
      await verifyDialogLayout(page, ".profile-comparison-dialog", 1180, 728);
      await verifyDialogLayout(page, ".profile-comparison-dialog", 1440, 900);
      await verifyComparisonResultNavigation(dialog);
      await dialog.getByRole("columnheader", { name: "Agent now" }).waitFor();
      await dialog.getByRole("columnheader", { name: "With Profile" }).waitFor();
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await page.setViewportSize({ width: 920, height: 620 });
        await page.screenshot({
          path: join(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, "comparison-overview-920x620.png")
        });
      }

      await dialog.getByRole("tab", { name: "Responses" }).click();
      await dialog.getByText(
        "environment=current profile=false skill=false isolated=true project-resources-excluded=true local-content=true sensitive-content-excluded=true real-home-read-blocked=true config-restricted=true"
      ).waitFor();
      await dialog.getByText(
        "environment=proposed profile=true skill=true isolated=true project-resources-excluded=true local-content=true sensitive-content-excluded=true real-home-read-blocked=true config-restricted=true"
      ).waitFor();
      await verifyDialogLayout(page, ".profile-comparison-dialog", 920, 620);

      await dialog.getByRole("tab", { name: "Changes" }).click();
      const changedFile = dialog.getByLabel("Changed file");
      expect(await changedFile.locator("option").allTextContents())
        .toEqual(["current-output.txt", "proposed-output.txt"]);
      await dialog.getByRole("tab", { name: "Agent changes" }).click();
      await expect(changedFile.inputValue()).resolves.toBe("current-output.txt");
      await dialog.getByRole("tab", { name: "Profile changes" }).click();
      await expect(changedFile.inputValue()).resolves.toBe("proposed-output.txt");
      await dialog.getByRole("table", {
        name: "Formatted diff for proposed-output.txt"
      }).waitFor();
      await verifyDialogLayout(page, ".profile-comparison-dialog", 920, 620);
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await page.screenshot({
          path: join(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, "comparison-result-920x620.png")
        });
      }

      expect(await readFile(realInstructions, "utf8")).toBe("# Current Agent instructions\n");
      expect(existsSync(join(workspace, "forbidden.txt"))).toBe(false);
      expect(existsSync(join(workspace, "current-output.txt"))).toBe(false);
      expect(existsSync(join(workspace, "proposed-output.txt"))).toBe(false);
      expect((await git.run([
        "-C", workspace, "status", "--porcelain=v1", "--untracked-files=all"
      ])).stdout).toBe(workspaceStatusBefore);
      expect(await readdir(join(cacheRoot, "evaluations"))).toEqual([]);
      const reportPath = join(dataRoot, "evaluations", "latest.json");
      const reportText = await readFile(reportPath, "utf8");
      const stored = JSON.parse(reportText);
      expect(stored).toMatchObject({
        targetId: "opencode",
        workspace: { kind: "folder", name: "workspace" },
        current: {
          finalResponse: expect.stringContaining("environment=current"),
          changedFiles: ["current-output.txt"],
          model: "fake/e2e"
        },
        proposed: {
          finalResponse: expect.stringContaining("environment=proposed"),
          changedFiles: ["proposed-output.txt"],
          model: "fake/e2e"
        },
        delta: { changedFiles: ["current-output.txt", "proposed-output.txt"] }
      });
      expect(stored.workspace.path).toBeUndefined();
      expect(reportText).not.toContain(root);
    }, 50_000);

    it("enables an apply-pending Codex Environment and compares it with the current Codex setup", async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-codex-comparison-e2e-"));
      const home = join(root, "home");
      const dataRoot = join(root, "data");
      const cacheRoot = join(root, "cache");
      const binDir = join(root, "bin");
      const profileDir = join(dataRoot, "profiles", "codex-evaluation-profile");
      const librarySkill = join(dataRoot, "skills-library", "codex-evaluation-skill");
      const realCodexDir = join(home, ".codex");
      const realInstructions = join(realCodexDir, "AGENTS.md");
      const fakeCodex = join(binDir, "codex");
      await Promise.all([
        mkdir(profileDir, { recursive: true }),
        mkdir(librarySkill, { recursive: true }),
        mkdir(realCodexDir, { recursive: true }),
        mkdir(join(dataRoot, "target-states"), { recursive: true }),
        mkdir(binDir, { recursive: true })
      ]);
      await writeJson(join(dataRoot, "agentenv-data.json"), { formatVersion: 2 });
      await writeJson(join(dataRoot, "settings.json"), {
        locale: "en",
        conversationTerminal: "default",
        skillSyncMethod: "symlink",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: false,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds: ["codex"],
        agentDiscoveryVersion: 1,
        agentDiscoveryReviewedIds: ["codex"]
      });
      await writeJson(join(profileDir, "profile.json"), {
        id: "codex-evaluation-profile",
        name: "Codex Evaluation Environment",
        description: "Codex isolated comparison proof",
        preferredTargetId: "codex",
        version: 2
      });
      await writeFile(join(profileDir, "INSTRUCTIONS.md"), "# Proposed Codex instructions\n", "utf8");
      await writeJson(join(profileDir, "resources.json"), {
        skills: [{
          libraryId: "codex-evaluation-skill",
          targetName: "codex-evaluation-skill",
          enabled: true
        }],
        managementByTarget: {
          codex: { instructions: "manage", skills: "manage" }
        },
        mcpByTarget: {
          codex: { mode: "disable", selections: [] }
        }
      });
      await writeFile(
        join(librarySkill, "SKILL.md"),
        "---\nname: codex-evaluation-skill\ndescription: Codex comparison proof.\n---\n\n# Codex Skill\n",
        "utf8"
      );
      await writeJson(join(librarySkill, ".agentenv-skill.json"), {
        sourceType: "local",
        updateCheckEnabled: false,
        globallyEnabled: true,
        contentHash: "seed-codex-evaluation-skill",
        updatedAt: "2026-08-01T00:00:00.000Z"
      });
      await writeJson(join(dataRoot, "target-states", "codex.json"), {
        formatVersion: 3,
        managedMcpNames: [],
        activeProfileId: "codex-evaluation-profile",
        appliedProfileHash: "previous-profile-hash",
        appliedLibraryVersions: { skills: {} },
        managedResources: [],
        sharedSkillPreparations: []
      });
      await writeFile(realInstructions, "# Current Codex instructions\n", "utf8");
      await writeFile(fakeCodex, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'codex-cli 0.145.0\\n'
  exit 0
fi
project=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--cd" ]; then
    project="$2"
    shift 2
  else
    shift
  fi
done
environment=current
profile_loaded=false
skill_loaded=false
grep -q 'Proposed Codex instructions' "$CODEX_HOME/AGENTS.md" && environment=proposed && profile_loaded=true
[ -f "$CODEX_HOME/skills/codex-evaluation-skill/SKILL.md" ] && skill_loaded=true
printf '%s output\\n' "$environment" > "$project/$environment-output.txt"
printf '{"type":"item.completed","item":{"type":"agent_message","text":"environment=%s profile=%s skill=%s"}}\\n' "$environment" "$profile_loaded" "$skill_loaded"
printf '{"type":"turn.completed","usage":{"input_tokens":20,"cached_input_tokens":4,"output_tokens":6,"reasoning_output_tokens":2}}\\n'
`, "utf8");
      await chmod(fakeCodex, 0o755);

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
          AGENTENV_AUTOMATION_BACKGROUND_DELAY_MS: "0",
          AGENTENV_AUTOMATION_TARGET_PATH: binDir,
          AGENTENV_DATA_ROOT: dataRoot,
          AGENTENV_CACHE_ROOT: cacheRoot,
          AGENTENV_HOME: home,
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
        }
      });
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 920, height: 620 });
      await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus()), {
        timeout: 15_000
      }).toEqual({ state: "ready" });

      await page.getByRole("button", { name: "Profiles" }).click();
      await page.getByRole("button", { name: "Profile Codex Evaluation Environment" }).click();
      const compareButton = page.getByRole("button", { name: "Compare" });
      await expect.poll(() => compareButton.isEnabled()).toBe(true);
      await compareButton.click();
      const dialog = page.getByRole("dialog", {
        name: "Compare Codex Evaluation Environment on Codex"
      });
      await dialog.getByRole("textbox", { name: "Task" }).fill("Compare Codex environments");
      await dialog.getByRole("button", { name: "Run comparison" }).click();
      const readDiagnostics = () => page.evaluate(async () => {
        const value = await window.agentEnv.readProfileComparison({});
        return {
          status: value?.status,
          error: value?.error,
          currentError: value?.result?.current.error,
          proposedError: value?.result?.proposed.error
        };
      });
      await expect.poll(async () => (await readDiagnostics()).status, {
        timeout: 20_000
      }).toMatch(/completed|incomplete|failed-to-run/);
      const diagnostics = await readDiagnostics();
      if (diagnostics.status !== "completed") {
        throw new Error(`Codex comparison did not complete: ${JSON.stringify(diagnostics)}`);
      }
      await dialog.getByText("Comparison completed").waitFor();
      await dialog.getByRole("tab", { name: "Responses" }).click();
      await dialog.getByText("environment=current profile=false skill=false").waitFor();
      await dialog.getByText("environment=proposed profile=true skill=true").waitFor();

      expect(await readFile(realInstructions, "utf8")).toBe("# Current Codex instructions\n");
      expect(await readdir(join(cacheRoot, "evaluations"))).toEqual([]);
      const reportText = await readFile(join(dataRoot, "evaluations", "latest.json"), "utf8");
      const stored = JSON.parse(reportText);
      expect(stored).toMatchObject({
        targetId: "codex",
        current: {
          finalResponse: "environment=current profile=false skill=false",
          usage: {
            inputTokens: 20,
            cachedInputTokens: 4,
            outputTokens: 6,
            reasoningTokens: 2
          }
        },
        proposed: {
          finalResponse: "environment=proposed profile=true skill=true"
        }
      });
      expect(reportText).not.toContain(root);
    }, 40_000);

    it("runs every verified Agent adapter and explains why Trae CLI comparison is unavailable", async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-multi-agent-comparison-e2e-"));
      const home = join(root, "home");
      const dataRoot = join(root, "data");
      const cacheRoot = join(root, "cache");
      const binDir = join(root, "bin");
      await Promise.all([
        mkdir(join(dataRoot, "profiles"), { recursive: true }),
        mkdir(binDir, { recursive: true }),
        mkdir(join(home, ".claude"), { recursive: true }),
        mkdir(join(home, ".gemini", "config"), { recursive: true }),
        mkdir(join(home, ".pi", "agent"), { recursive: true }),
        mkdir(join(home, ".trae", "rules"), { recursive: true })
      ]);
      await writeJson(join(dataRoot, "agentenv-data.json"), { formatVersion: 2 });
      await writeJson(join(dataRoot, "settings.json"), {
        locale: "en",
        conversationTerminal: "default",
        skillSyncMethod: "symlink",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: false,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds: ["claude-code", "antigravity", "pi", "trae-cli"],
        agentDiscoveryVersion: 1,
        agentDiscoveryReviewedIds: ["claude-code", "antigravity", "pi", "trae-cli"]
      });

      const agents = [
        {
          id: "claude-code",
          name: "Claude Verified",
          instructionsPath: join(home, ".claude", "CLAUDE.md"),
          proposed: "# Proposed Claude\n"
        },
        {
          id: "antigravity",
          name: "Antigravity Verified",
          instructionsPath: join(home, ".gemini", "GEMINI.md"),
          proposed: "# Proposed Antigravity\n"
        },
        {
          id: "pi",
          name: "Pi Verified",
          instructionsPath: join(home, ".pi", "agent", "AGENTS.md"),
          proposed: "# Proposed Pi\n"
        },
        {
          id: "trae-cli",
          name: "Trae Unsupported",
          instructionsPath: join(home, ".trae", "rules", "agentenv-manager.md"),
          proposed: "# Proposed Trae\n"
        }
      ] as const;
      for (const agent of agents) {
        const profileDir = join(dataRoot, "profiles", `${agent.id}-comparison`);
        await mkdir(profileDir, { recursive: true });
        await writeJson(join(profileDir, "profile.json"), {
          id: `${agent.id}-comparison`,
          name: agent.name,
          description: "Adapter comparison proof",
          preferredTargetId: agent.id,
          version: 2
        });
        await writeFile(join(profileDir, "INSTRUCTIONS.md"), agent.proposed, "utf8");
        await writeJson(join(profileDir, "resources.json"), {
          skills: [],
          managementByTarget: {
            [agent.id]: { instructions: "manage", skills: "disable" }
          },
          mcpByTarget: {
            [agent.id]: { mode: "disable", selections: [] }
          }
        });
        await mkdir(join(agent.instructionsPath, ".."), { recursive: true });
        await writeFile(agent.instructionsPath, `# Current ${agent.id}\n`, "utf8");
      }
      await writeFile(join(home, ".trae", "traecli.toml"), "", "utf8");

      await writeFile(join(binDir, "claude"), `#!/bin/sh
if [ "$1" = "--version" ]; then printf '2.1.214\n'; exit 0; fi
environment=current
grep -q 'Proposed Claude' "$CLAUDE_CONFIG_DIR/CLAUDE.md" && environment=proposed
printf '{"type":"assistant","message":{"model":"fake-claude","content":[{"type":"text","text":"claude-%s"}],"usage":{"input_tokens":10,"output_tokens":2}}}\n' "$environment"
`, "utf8");
      await writeFile(join(binDir, "agy"), `#!/bin/sh
if [ "$1" = "--version" ]; then printf '1.1.4\n'; exit 0; fi
environment=current
grep -q 'Proposed Antigravity' "$HOME/.gemini/GEMINI.md" && environment=proposed
printf 'antigravity-%s\n' "$environment"
`, "utf8");
      await writeFile(join(binDir, "pi"), `#!/bin/sh
if [ "$1" = "--version" ]; then printf '0.83.0\n'; exit 0; fi
environment=current
grep -q 'Proposed Pi' "$PI_CODING_AGENT_DIR/AGENTS.md" && environment=proposed
printf '{"type":"message_end","message":{"role":"assistant","model":"fake-pi","content":[{"type":"text","text":"pi-%s"}],"usage":{"input":10,"output":2,"totalTokens":12,"cost":{"total":0.001}}}}\n' "$environment"
`, "utf8");
      await writeFile(join(binDir, "traecli"), "#!/bin/sh\nprintf 'fake-trae\\n'\n", "utf8");
      await Promise.all(["claude", "agy", "pi", "traecli"].map((name) =>
        chmod(join(binDir, name), 0o755)));

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
          AGENTENV_AUTOMATION_BACKGROUND_DELAY_MS: "0",
          AGENTENV_AUTOMATION_TARGET_PATH: binDir,
          AGENTENV_DATA_ROOT: dataRoot,
          AGENTENV_CACHE_ROOT: cacheRoot,
          AGENTENV_HOME: home,
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
        }
      });
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 920, height: 620 });
      await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus()), {
        timeout: 15_000
      }).toEqual({ state: "ready" });
      await page.getByRole("button", { name: "Profiles" }).click();

      for (const agent of agents.slice(0, 3)) {
        await page.getByRole("button", { name: `Profile ${agent.name}` }).click();
        const compare = page.getByRole("button", { name: "Compare" });
        await expect.poll(() => compare.isEnabled()).toBe(true);
        await compare.click();
        const dialog = page.getByRole("dialog", { name: new RegExp(`Compare ${agent.name}`) });
        await dialog.getByRole("textbox", { name: "Task" }).fill("Verify adapter");
        await dialog.getByRole("button", { name: "Run comparison" }).click();
        const readRun = () => page.evaluate(async () => {
          const value = await window.agentEnv.readProfileComparison({});
          return {
            targetId: value?.targetId,
            status: value?.status,
            error: value?.error,
            currentError: value?.result?.current.error,
            proposedError: value?.result?.proposed.error
          };
        });
        await expect.poll(async () => {
          const run = await readRun();
          return run.targetId === agent.id ? run.status : undefined;
        }, { timeout: 20_000 })
          .toMatch(/completed|incomplete|failed-to-run/);
        const run = await readRun();
        if (run.status !== "completed") {
          throw new Error(`${agent.name} comparison did not complete: ${JSON.stringify(run)}`);
        }
        await dialog.getByText("Comparison completed").waitFor();
        await dialog.getByRole("tab", { name: "Responses" }).click();
        const responsePrefix = agent.id === "claude-code"
          ? "claude"
          : agent.id === "antigravity"
            ? "antigravity"
            : "pi";
        await dialog.getByText(`${responsePrefix}-current`).waitFor();
        await dialog.getByText(`${responsePrefix}-proposed`).waitFor();
        await dialog.getByRole("contentinfo").getByRole("button", { name: "Close" }).click();
        expect(await readFile(agent.instructionsPath, "utf8")).toBe(`# Current ${agent.id}\n`);
      }

      const trae = agents[3];
      await page.getByRole("button", { name: `Profile ${trae.name}` }).click();
      const compare = page.getByRole("button", { name: "Compare" });
      await expect.poll(() => compare.isDisabled()).toBe(true);
      await expect(compare.getAttribute("title")).resolves.toBe(
        "Trae CLI does not expose a verified one-shot command, so isolated comparison is unavailable."
      );
      await expect(compare.getAttribute("aria-describedby")).resolves
        .toBe("profile-comparison-unavailable");
      expect(await readdir(join(cacheRoot, "evaluations"))).toEqual([]);
      const latestReport = await readFile(join(dataRoot, "evaluations", "latest.json"), "utf8");
      expect(latestReport).not.toContain(root);
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await mkdir(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, { recursive: true });
        await page.screenshot({
          path: join(
            process.env.AGENTENV_EVALUATION_CAPTURE_DIR,
            "comparison-unavailable-trae-920x620.png"
          )
        });
      }
    }, 60_000);
  }
);
