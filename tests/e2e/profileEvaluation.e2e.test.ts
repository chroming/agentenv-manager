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

describe.skipIf(process.platform !== "darwin" || !gitExecutable)(
  "isolated Profile comparison desktop workflow",
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
        enabledTargetIds: ["opencode"]
      });
      await writeJson(join(profileDir, "profile.json"), {
        id: "evaluation-profile",
        name: "Evaluation Profile",
        description: "Isolated comparison proof",
        preferredTargetId: "opencode",
        version: 2
      });
      await writeFile(
        join(profileDir, "INSTRUCTIONS.md"),
        "# Proposed Profile instructions\n",
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
        "---\nname: project-only\ndescription: Must not enter Profile Comparison.\n---\n",
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
grep -q 'Proposed Profile instructions' "$OPENCODE_CONFIG_DIR/AGENTS.md" && environment=proposed && profile_loaded=true
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
      await page.getByRole("group", { name: "Profile Evaluation Profile" }).click();
      await page.getByRole("button", { name: "Compare" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Compare Evaluation Profile on OpenCode"
      });
      await dialog.waitFor({ state: "visible" });
      await dialog.getByText("Temporary empty Workspace").waitFor();
      await verifyDialogLayout(page, ".profile-comparison-dialog", 920, 620);
      await verifyDialogLayout(page, ".profile-comparison-dialog", 1180, 728);

      await dialog.getByRole("radio", { name: "Local folder" }).click();
      await dialog.getByText(workspace).waitFor();
      await dialog.getByText(/files ·/).waitFor();
      await verifyDialogLayout(page, ".profile-comparison-dialog", 920, 620);
      await verifyDialogLayout(page, ".profile-comparison-dialog", 1180, 728);
      await verifyDialogLayout(page, ".profile-comparison-dialog", 1440, 900);
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
      await dialog.getByRole("tab", { name: "Current changes" }).click();
      await expect(changedFile.inputValue()).resolves.toBe("current-output.txt");
      await dialog.getByRole("tab", { name: "Proposed changes" }).click();
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
  }
);
