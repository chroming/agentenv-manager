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
import { _electron as electron, type ElectronApplication } from "playwright-core";
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

describe.skipIf(process.platform !== "darwin" || !gitExecutable)(
  "one-shot Profile evaluation desktop workflow",
  () => {
    it("loads the saved Profile in fake OpenCode while preserving the real Agent and project", async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-e2e-"));
      const home = join(root, "home");
      const dataRoot = join(root, "data");
      const cacheRoot = join(root, "cache");
      const binDir = join(root, "bin");
      const project = join(root, "project");
      const profileDir = join(dataRoot, "profiles", "evaluation-profile");
      const librarySkill = join(dataRoot, "skills-library", "evaluation-skill");
      const realOpenCodeDir = join(home, ".config", "opencode");
      const realInstructions = join(realOpenCodeDir, "AGENTS.md");
      const fakeOpenCode = join(binDir, "opencode");
      await Promise.all([
        mkdir(profileDir, { recursive: true }),
        mkdir(librarySkill, { recursive: true }),
        mkdir(realOpenCodeDir, { recursive: true }),
        mkdir(binDir, { recursive: true }),
        mkdir(project, { recursive: true }),
        mkdir(join(project, ".opencode", "skills", "project-only"), { recursive: true })
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
        description: "Isolated one-shot test",
        preferredTargetId: "opencode",
        version: 2
      });
      await writeFile(
        join(profileDir, "INSTRUCTIONS.md"),
        "# Evaluation-only instructions\n",
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
        "---\nname: evaluation-skill\ndescription: Eval proof.\n---\n\n# Evaluation Skill\n",
        "utf8"
      );
      await writeJson(join(librarySkill, ".agentenv-skill.json"), {
        sourceType: "local",
        updateCheckEnabled: false,
        globallyEnabled: true,
        contentHash: "seed-evaluation-skill",
        updatedAt: "2026-08-01T00:00:00.000Z"
      });
      await writeFile(realInstructions, "# Real OpenCode instructions\n", "utf8");
      await writeJson(join(realOpenCodeDir, "opencode.jsonc"), { theme: "real-agent-theme" });
      await writeFile(join(project, "README.md"), "# Original project\n", "utf8");
      await writeFile(join(project, "AGENTS.md"), "# Project instructions must be masked\n", "utf8");
      await writeJson(join(project, "opencode.json"), {
        mcp: { projectOnly: { type: "local", command: ["echo"] } }
      });
      await writeFile(
        join(project, ".opencode", "skills", "project-only", "SKILL.md"),
        "---\nname: project-only\ndescription: Must not enter Profile Eval.\n---\n",
        "utf8"
      );
      git = createGitCommandRunner({ executablePath: gitExecutable! });
      await git.run(["-C", project, "init"]);
      await git.run(["-C", project, "config", "user.name", "AgentEnv E2E"]);
      await git.run(["-C", project, "config", "user.email", "e2e@agentenv.local"]);
      await git.run(["-C", project, "add", "."]);
      await git.run(["-C", project, "commit", "-m", "initial"]);

      await writeFile(fakeOpenCode, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '1.18.0\\n'
  exit 0
fi
project_dir=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--dir" ]; then
    project_dir="$2"
    shift 2
  else
    shift
  fi
done
profile_loaded=false
skill_loaded=false
home_isolated=false
project_resources_excluded=false
config_restricted=false
grep -q 'Evaluation-only instructions' "$OPENCODE_CONFIG_DIR/AGENTS.md" && profile_loaded=true
grep -q 'Evaluation Skill' "$OPENCODE_CONFIG_DIR/skills/evaluation-skill/SKILL.md" && skill_loaded=true
[ "$HOME" != "$AGENTENV_E2E_REAL_HOME" ] && home_isolated=true
[ ! -e "$project_dir/AGENTS.md" ] && [ ! -e "$project_dir/opencode.json" ] && [ ! -e "$project_dir/.opencode" ] && project_resources_excluded=true
grep -q '"\\*": "deny"' "$OPENCODE_CONFIG_DIR/opencode.jsonc" && grep -q '"edit": "allow"' "$OPENCODE_CONFIG_DIR/opencode.jsonc" && ! grep -q '"mcp"' "$OPENCODE_CONFIG_DIR/opencode.jsonc" && config_restricted=true
if printf 'forbidden' > "$AGENTENV_E2E_ORIGINAL_PROJECT/forbidden.txt"; then
  printf '{"type":"error","error":{"data":{"message":"original project was writable"}}}\\n'
  exit 4
fi
if printf 'forbidden' > "$AGENTENV_E2E_REAL_AGENT_FILE"; then
  printf '{"type":"error","error":{"data":{"message":"real Agent was writable"}}}\\n'
  exit 5
fi
sleep 1
printf 'generated by fake OpenCode\\n' > "$project_dir/evaluation-output.txt"
printf '{"type":"text","part":{"text":"profile=%s skill=%s isolated=%s project-resources-excluded=%s config-restricted=%s"}}\\n' "$profile_loaded" "$skill_loaded" "$home_isolated" "$project_resources_excluded" "$config_restricted"
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
          AGENTENV_E2E_ORIGINAL_PROJECT: project,
          AGENTENV_E2E_REAL_AGENT_FILE: realInstructions,
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
        project
      );

      await page.getByRole("button", { name: "Profiles" }).click();
      await page.getByRole("group", { name: "Profile Evaluation Profile" }).click();
      await page.getByRole("button", { name: "Evaluate" }).click();
      const evaluationDialog = page.getByRole("dialog", { name: "Evaluate Evaluation Profile" });
      await evaluationDialog.waitFor({ state: "visible" });
      await evaluationDialog.getByRole("button", { name: "Choose Git project" }).click();
      await evaluationDialog.getByText(/Revision [0-9a-f]{7}/).waitFor();
      await evaluationDialog.getByRole("textbox", { name: "Task" }).fill("Create an evaluation file");
      const runButton = evaluationDialog.getByRole("button", { name: "Run evaluation" });
      await expect.poll(() => runButton.isEnabled()).toBe(true);
      expect(await runButton.getAttribute("aria-busy")).toBe("false");
      await expect.poll(() => runButton.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          color: style.color
        };
      })).toEqual({
        backgroundColor: "rgb(0, 122, 255)",
        color: "rgb(255, 255, 255)"
      });
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await mkdir(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, { recursive: true });
        await page.screenshot({
          path: join(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, "setup-920x620.png")
        });
      }
      await runButton.click();
      await evaluationDialog.getByRole("status").waitFor({ timeout: 15_000 });
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await page.screenshot({
          path: join(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, "active-920x620.png")
        });
      }
      await evaluationDialog.getByText("Evaluation completed").waitFor({ timeout: 15_000 });
      await evaluationDialog.getByText(
        "profile=true skill=true isolated=true project-resources-excluded=true config-restricted=true"
      ).waitFor();
      const responseTab = evaluationDialog.getByRole("tab", { name: "Response" });
      const changesTab = evaluationDialog.getByRole("tab", { name: "Changes" });
      await changesTab.click();
      expect(await responseTab.getAttribute("aria-selected")).toBe("false");
      expect(await responseTab.getAttribute("class")).not.toContain("is-active");
      expect(await changesTab.getAttribute("aria-selected")).toBe("true");
      expect(await changesTab.getAttribute("class")).toContain("is-active");
      await expect(evaluationDialog.getByLabel("Changed file").inputValue())
        .resolves.toBe("evaluation-output.txt");
      await evaluationDialog.getByRole("table", {
        name: "Formatted diff for evaluation-output.txt"
      }).waitFor();
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await page.screenshot({
          path: join(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, "result-920x620.png")
        });
      }

      expect(await readFile(realInstructions, "utf8")).toBe("# Real OpenCode instructions\n");
      expect(existsSync(join(project, "forbidden.txt"))).toBe(false);
      expect(existsSync(join(project, "evaluation-output.txt"))).toBe(false);
      expect(await git.run(["-C", project, "status", "--porcelain=v1"]))
        .toMatchObject({ stdout: "" });
      expect(await readdir(join(cacheRoot, "evaluations"))).toEqual([]);
      const stored = JSON.parse(await readFile(
        join(dataRoot, "evaluations", "latest.json"),
        "utf8"
      ));
      expect(stored).toMatchObject({
        targetId: "opencode",
        finalResponse: "profile=true skill=true isolated=true project-resources-excluded=true config-restricted=true",
        changedFiles: ["evaluation-output.txt"],
        model: "fake/e2e"
      });
      await expectInViewport(page, evaluationDialog);
      await expectNoHorizontalOverflow(page, [".profile-evaluation-dialog"]);
      expect(await findVisibleTextLayoutDefects(page)).toEqual([]);

      await evaluationDialog.getByRole("button", { name: "Close" }).last().click();
      await page.getByRole("button", { name: "Evaluate" }).click();
      const restoredDialog = page.getByRole("dialog", { name: "Evaluate Evaluation Profile" });
      await restoredDialog.getByText("Latest evaluation").waitFor();
      await page.setViewportSize({ width: 1180, height: 728 });
      await expectInViewport(page, restoredDialog);
      await expectNoHorizontalOverflow(page, [".profile-evaluation-dialog"]);
      expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
      if (process.env.AGENTENV_EVALUATION_CAPTURE_DIR) {
        await page.screenshot({
          path: join(process.env.AGENTENV_EVALUATION_CAPTURE_DIR, "restored-1180x728.png")
        });
      }
    }, 35_000);
  }
);
