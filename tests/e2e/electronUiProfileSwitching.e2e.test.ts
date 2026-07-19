import { constants } from "node:fs";
import { access } from "node:fs/promises";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import electronPath from "electron";
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectInViewport,
  expectNoHorizontalOverflow,
  expectTextFits,
  expectTopmost
} from "./layoutAssertions";

let root = "";
let app: ElectronApplication | undefined;

const fileExists = async (path: string) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const writeJson = async (path: string, value: unknown) => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const readJson = async <T,>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

const findProfileByName = async (appDataRoot: string, name: string) => {
  const profileIds = await readdir(join(appDataRoot, "profiles"));
  for (const profileId of profileIds) {
    const content = await readFile(
      join(appDataRoot, "profiles", profileId, "profile.json"),
      "utf8"
    );
    const manifest = JSON.parse(content) as { id: string; name: string; description: string };
    if (manifest.name === name) {
      return manifest;
    }
  }
  return undefined;
};

const writeOpenCodeProfile = async (
  appDataRoot: string,
  variant: "alpha" | "beta",
  profileName?: string
) => {
  const profileId = `ui-opencode-${variant}`;
  const profileDir = join(appDataRoot, "profiles", profileId);
  await mkdir(join(profileDir, "agents", `${variant}-agent`), { recursive: true });
  await mkdir(join(profileDir, "skills", `${variant}-skill`), { recursive: true });
  await writeJson(join(profileDir, "profile.json"), {
    id: profileId,
    targetId: "opencode",
    name: profileName ?? `UI OpenCode ${variant}`,
    description: `UI e2e ${variant}`,
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  });
  await writeFile(
    join(profileDir, "AGENTS.md"),
    `# UI ${variant.toUpperCase()}\n\n- Active UI profile: ${variant}.\n`,
    "utf8"
  );
  await writeJson(join(profileDir, "opencode.jsonc"), {
    $schema: "https://opencode.ai/config.json",
    username: `ui-${variant}`,
    mcp: {
      [`ui-${variant}-mcp`]: {
        type: "local",
        command: ["node", "--version"]
      }
    }
  });
  await writeJson(join(profileDir, "assets.json"), {
    ownedDirs: [
      {
        kind: "agent",
        source: `agents/${variant}-agent`,
        targetName: `ui-${variant}-agent`
      },
      {
        kind: "skill",
        source: `skills/${variant}-skill`,
        targetName: `ui-${variant}-skill`
      }
    ],
    ownedFiles: [],
    mcpRefs: [
      {
        libraryId: "shared-docs",
        targetName: "shared-docs"
      }
    ],
    disabledSkillPaths: []
  });
  await writeFile(
    join(profileDir, "agents", `${variant}-agent`, "agent.md"),
    `---\nname: ui-${variant}-agent\n---\n\n${variant} agent prompt.\n`,
    "utf8"
  );
  await writeFile(
    join(profileDir, "skills", `${variant}-skill`, "SKILL.md"),
    `---\nname: ui-${variant}-skill\n---\n\n${variant} skill prompt.\n`,
    "utf8"
  );

  return profileId;
};

const writeCodexProfile = async (
  appDataRoot: string,
  variant: "alpha" | "beta"
) => {
  const profileId = `ui-codex-${variant}`;
  const profileDir = join(appDataRoot, "profiles", profileId);
  await mkdir(join(profileDir, "agents"), { recursive: true });
  await mkdir(join(profileDir, "skills", `${variant}-skill`), { recursive: true });
  await writeJson(join(profileDir, "profile.json"), {
    id: profileId,
    targetId: "codex",
    name: `UI Codex ${variant}`,
    description: `UI Codex e2e ${variant}`,
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  });
  await writeFile(
    join(profileDir, "AGENTS.md"),
    `# UI Codex ${variant.toUpperCase()}\n\n- Active Codex UI profile: ${variant}.\n`,
    "utf8"
  );
  await writeFile(
    join(profileDir, "config.toml"),
    `[mcp_servers.ui_codex_${variant}]\nurl = "https://example.com/codex/${variant}/mcp"\n`,
    "utf8"
  );
  await writeJson(join(profileDir, "assets.json"), {
    ownedDirs: [
      {
        kind: "skill",
        source: `skills/${variant}-skill`,
        targetName: `ui-codex-${variant}-skill`
      }
    ],
    ownedFiles: [
      {
        kind: "agent",
        source: `agents/ui-codex-${variant}-agent.toml`,
        targetName: `ui-codex-${variant}-agent.toml`
      }
    ],
    mcpRefs: [
      {
        libraryId: "shared-docs",
        targetName: "shared-docs"
      }
    ],
    disabledSkillPaths: []
  });
  await writeFile(
    join(profileDir, "agents", `ui-codex-${variant}-agent.toml`),
    `name = "ui-codex-${variant}-agent"\ndescription = "UI Codex ${variant} agent."\ndeveloper_instructions = "${variant} Codex agent prompt."\n`,
    "utf8"
  );
  await writeFile(
    join(profileDir, "skills", `${variant}-skill`, "SKILL.md"),
    `---\nname: ui-codex-${variant}-skill\ndescription: UI Codex ${variant} skill.\n---\n\n${variant} Codex skill prompt.\n`,
    "utf8"
  );

  return profileId;
};

const writeClaudeProfile = async (appDataRoot: string) => {
  const profileId = "ui-claude-clean";
  const profileDir = join(appDataRoot, "profiles", profileId);
  await mkdir(profileDir, { recursive: true });
  await writeJson(join(profileDir, "profile.json"), {
    id: profileId,
    targetId: "claude-code",
    name: "UI Claude clean",
    description: "UI Claude profile without native Advanced values",
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  });
  await writeFile(
    join(profileDir, "CLAUDE.md"),
    "# UI Claude clean\n\n- Keep native Claude Code settings Target-owned.\n",
    "utf8"
  );
  await writeJson(join(profileDir, "claude-code.json"), {
    settings: {
      $schema: "https://json.schemastore.org/claude-code-settings.json"
    },
    mcpServers: {}
  });
  await writeJson(join(profileDir, "assets.json"), {
    ownedDirs: [],
    ownedFiles: [],
    skillRefs: [{ libraryId: "shared-reviewer", targetName: "bytedcli" }],
    mcpRefs: [],
    disabledSkillPaths: []
  });
};

const writeLibrarySkill = async (appDataRoot: string) => {
  const sourceDir = join(appDataRoot, "source-skills", "shared-reviewer");
  const libraryDir = join(appDataRoot, "skills-library", "shared-reviewer");
  const skillMarkdown =
    "---\nname: Shared Reviewer\ndescription: Shared review guidance for multiple profiles.\n---\n\n# Shared Reviewer\n\nReview code changes before applying them.\n";
  await mkdir(sourceDir, { recursive: true });
  await mkdir(libraryDir, { recursive: true });
  await writeFile(join(sourceDir, "SKILL.md"), skillMarkdown, "utf8");
  await writeFile(join(libraryDir, "SKILL.md"), skillMarkdown, "utf8");
  await writeJson(join(libraryDir, ".agentenv-skill.json"), {
    sourceType: "local",
    source: sourceDir,
    updateCheckEnabled: true,
    contentHash: "seed",
    updatedAt: "2026-07-02T00:00:00.000Z"
  });

  return { libraryDir, sourceDir };
};

const addOpenCodeAlphaLibrarySkills = async (appDataRoot: string, count: number) => {
  const refs = [];
  for (let index = 0; index < count; index += 1) {
    const id = `layout-skill-${index + 1}`;
    const skillDir = join(appDataRoot, "skills-library", id);
    const sourceDir = join(appDataRoot, "source-skills", id);
    await mkdir(skillDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${id}\ndescription: Layout fixture ${index + 1}.\n---\n\n# ${id}\n`,
      "utf8"
    );
    await writeFile(
      join(sourceDir, "SKILL.md"),
      `---\nname: ${id}\ndescription: Updated layout fixture ${index + 1}.\n---\n\n# ${id}\n`,
      "utf8"
    );
    await writeJson(join(skillDir, ".agentenv-skill.json"), {
      sourceType: "local",
      source: sourceDir,
      updateCheckEnabled: true,
      contentHash: "seed",
      updatedAt: "2026-07-02T00:00:00.000Z"
    });
    refs.push({ libraryId: id, targetName: id });
  }
  const staticSkillDir = join(appDataRoot, "skills-library", "static-reference");
  await mkdir(staticSkillDir, { recursive: true });
  await writeFile(
    join(staticSkillDir, "SKILL.md"),
    "---\nname: Static Reference\ndescription: Untracked scale-control skill.\n---\n\n# Static Reference\n",
    "utf8"
  );

  const assetsPath = join(appDataRoot, "profiles", "ui-opencode-alpha", "assets.json");
  const assets = await readJson<Record<string, unknown> & { skillRefs?: unknown[] }>(assetsPath);
  await writeJson(assetsPath, { ...assets, skillRefs: refs });
};

const writeTrackedLibrarySkill = async (
  appDataRoot: string,
  id: string,
  currentDescription: string,
  nextDescription: string
) => {
  const sourceDir = join(appDataRoot, "source-skills", id);
  const libraryDir = join(appDataRoot, "skills-library", id);
  await mkdir(sourceDir, { recursive: true });
  await mkdir(libraryDir, { recursive: true });
  await writeFile(
    join(libraryDir, "SKILL.md"),
    `---\nname: ${id}\ndescription: ${currentDescription}\n---\n\n# ${id}\n\nCurrent content.\n`,
    "utf8"
  );
  await writeFile(
    join(sourceDir, "SKILL.md"),
    `---\nname: ${id}\ndescription: ${nextDescription}\n---\n\n# ${id}\n\nUpdated content.\n`,
    "utf8"
  );
  await writeJson(join(libraryDir, ".agentenv-skill.json"), {
    sourceType: "local",
    source: sourceDir,
    updateCheckEnabled: true,
    contentHash: "seed",
    updatedAt: "2026-07-02T00:00:00.000Z"
  });

  return { libraryDir, sourceDir };
};

const writeGitHubFixtureSkill = async (fixtureRoot: string, version: "v1" | "v2") => {
  const skillDir = join(fixtureRoot, "acme", "agent-skills", "main", "skills", "reviewer");
  await mkdir(join(skillDir, "references"), { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: GitHub Reviewer\ndescription: GitHub skill ${version}.\n---\n\n# GitHub Reviewer\n\n${version} guidance from GitHub.\n`,
    "utf8"
  );
  await writeFile(join(skillDir, "references", "guide.md"), `# Guide ${version}\n`, "utf8");

  return skillDir;
};

const writeGitHubFixtureDirectory = async (fixtureRoot: string) => {
  const skills = [
    {
      path: "skills/engineering/api-design",
      name: "API Design",
      description: "Design stable APIs."
    },
    {
      path: "skills/engineering/release-check",
      name: "Release Check",
      description: "Verify releases before shipping."
    }
  ];
  for (const skill of skills) {
    const skillDir = join(fixtureRoot, "acme", "agent-skills", "main", skill.path);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n`,
      "utf8"
    );
  }
};

const writeUnmanagedTargetSkill = async (
  opencodeDir: string,
  id = "target-only-reviewer",
  description = "Existing target skill ready to migrate.",
  rootName = "skills"
) => {
  const title = id
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
  const skillDir = join(opencodeDir, rootName, id);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: ${title}\ndescription: ${description}\n---\n\n# ${title}\n\nMigrate me into the shared library.\n`,
    "utf8"
  );

  return skillDir;
};

const writeMcpLibrary = async (appDataRoot: string, count = 1) => {
  await writeJson(join(appDataRoot, "mcp-library.json"), [
    {
      id: "shared-docs",
      name: "Shared Docs",
      transport: "http",
      url: "https://example.com/shared-docs/mcp"
    },
    ...Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
      id: `fixture-mcp-${index + 1}`,
      name: `Fixture MCP ${index + 1}`,
      transport: "http",
      url: `https://example.com/fixture-${index + 1}/mcp`
    }))
  ]);
};

const writeMigratedBackupFixtures = async (appDataRoot: string) => {
  const backupId = "2026-07-09T04-35-47-638Z";
  const sourcePath = "/Users/previous-user/.config/opencode/AGENTS.md";
  const encodedSourcePath = Buffer.from(sourcePath).toString("base64url");
  const backupDir = join(appDataRoot, "backups", backupId);
  const currentBackupPath = join(backupDir, "files", encodedSourcePath);
  await mkdir(join(backupDir, "files"), { recursive: true });
  await writeFile(currentBackupPath, "# Previous machine backup\n", "utf8");
  await writeJson(join(backupDir, "manifest.json"), {
    id: backupId,
    createdAt: "2026-07-09T04:35:47.638Z",
    operation: "apply",
    targetId: "opencode",
    entries: [
      {
        sourcePath,
        backupPath: join(
          "/Users/previous-user/.config/agentenv-manager/backups",
          backupId,
          "files",
          encodedSourcePath
        ),
        missing: false,
        kind: "file"
      }
    ]
  });

  const malformedId = "2026-07-09T04-36-00-000Z";
  await mkdir(join(appDataRoot, "backups", malformedId), { recursive: true });
  await writeFile(join(appDataRoot, "backups", malformedId, "manifest.json"), "not json\n");
};

const launchApp = async (
  options: {
    openCodeAlphaLibrarySkillCount?: number;
    mcpLibraryCount?: number;
    backgroundStartupDelayMs?: number;
    testCloseGuard?: boolean;
    migratedBackupFixtures?: boolean;
    includeClaudeTarget?: boolean;
    openCodeBetaProfileName?: string;
  } = {}
) => {
  root = await mkdtemp(join(tmpdir(), "agentenv-electron-ui-"));
  const appDataRoot = join(root, "app-data");
  const fakeHomeRoot = join(root, "fake-home");
  const homeDir = join(root, "home");
  const binDir = join(root, "bin");
  const githubFixtureRoot = join(root, "github-fixtures");
  const opencodeDir = join(homeDir, ".config", "opencode");
  const codexDir = join(homeDir, ".codex");
  const claudeDir = join(homeDir, ".claude");
  await mkdir(binDir, { recursive: true });
  await mkdir(opencodeDir, { recursive: true });
  await mkdir(codexDir, { recursive: true });
  const opencodeExecutable = join(binDir, "opencode");
  const codexExecutable = join(binDir, "codex");
  await writeFile(opencodeExecutable, "#!/bin/sh\necho fake-opencode\n", "utf8");
  await chmod(opencodeExecutable, 0o755);
  await writeFile(codexExecutable, "#!/bin/sh\necho fake-codex\n", "utf8");
  await chmod(codexExecutable, 0o755);
  if (options.includeClaudeTarget) {
    const claudeExecutable = join(binDir, "claude");
    await writeFile(claudeExecutable, "#!/bin/sh\necho fake-claude\n", "utf8");
    await chmod(claudeExecutable, 0o755);
    await mkdir(claudeDir, { recursive: true });
  }
  await writeFile(join(opencodeDir, "AGENTS.md"), "# Existing UI OpenCode\n", "utf8");
  await writeJson(join(opencodeDir, "opencode.jsonc"), {
    shell: "/bin/zsh",
    mcp: {
      "user-managed": {
        type: "remote",
        url: "https://example.com/user"
      }
    }
  });
  await writeFile(join(codexDir, "AGENTS.md"), "# Existing UI Codex\n", "utf8");
  await writeFile(join(codexDir, "auth.json"), '{"token":"ui-keep"}\n', "utf8");
  await writeFile(
    join(codexDir, "config.toml"),
    'model = "gpt-5"\n\n[mcp_servers.user_docs]\nurl = "https://example.com/user-docs"\n',
    "utf8"
  );
  await writeOpenCodeProfile(appDataRoot, "alpha");
  await writeOpenCodeProfile(appDataRoot, "beta", options.openCodeBetaProfileName);
  await writeCodexProfile(appDataRoot, "alpha");
  await writeCodexProfile(appDataRoot, "beta");
  if (options.includeClaudeTarget) {
    await writeClaudeProfile(appDataRoot);
  }
  const librarySkill = await writeLibrarySkill(appDataRoot);
  if (options.openCodeAlphaLibrarySkillCount) {
    await addOpenCodeAlphaLibrarySkills(appDataRoot, options.openCodeAlphaLibrarySkillCount);
  }
  await writeGitHubFixtureSkill(githubFixtureRoot, "v1");
  await writeUnmanagedTargetSkill(opencodeDir);
  await writeMcpLibrary(appDataRoot, options.mcpLibraryCount);
  if (options.migratedBackupFixtures) {
    await writeMigratedBackupFixtures(appDataRoot);
  }

  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(process.cwd(), "out", "main", "main.js")],
    env: {
      ...process.env,
      AGENTENV_AUTOMATION: "1",
      AGENTENV_TEST_CLOSE_GUARD: options.testCloseGuard ? "1" : "0",
      AGENTENV_DATA_ROOT: appDataRoot,
      AGENTENV_AUTOMATION_BACKGROUND_DELAY_MS: String(options.backgroundStartupDelayMs ?? 0),
      AGENTENV_GITHUB_FIXTURE_ROOT: githubFixtureRoot,
      AGENTENV_FAKE_HOME: fakeHomeRoot,
      AGENTENV_HOME: homeDir,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
    }
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForLoadState("domcontentloaded");

  return {
    app,
    appDataRoot,
    homeDir,
    opencodeDir,
    codexDir,
    claudeDir,
    librarySkill,
    githubFixtureRoot,
    page
  };
};

const resizeAppWindow = async (page: Page, width: number, height: number) => {
  if (!app) {
    throw new Error("Electron application is not running");
  }
  const windowHandle = await app.browserWindow(page);
  await windowHandle.evaluate((browserWindow, size) => {
    browserWindow.setContentSize(size.width, size.height);
  }, { width, height });
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(300);
};

const selectProfile = async (page: Page, name: string) => {
  await page
    .getByRole("complementary", { name: "Global navigation" })
    .getByRole("button", { name: "Profiles", exact: true })
    .click();
  await page.getByRole("region", { name: "Profiles", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("heading", { name }).waitFor({ state: "visible" });
};

const selectTarget = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "Select apply Agent" }).click();
  const targetMenu = page.getByRole("menu", { name: "Apply Agents" });
  await page.getByRole("menuitemradio", { name }).click();
  await targetMenu.waitFor({ state: "hidden" });
};

type ComposerSectionName = "Instructions" | "Skills" | "MCPs" | "Advanced";

const expandComposerSection = async (page: Page, name: ComposerSectionName) => {
  const composer = page.getByRole("region", { name: "Profile composer" });
  const trigger = composer.getByRole("button", { name, exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("true");
};

const openSkillLibrary = async (page: Page) => {
  await page
    .getByRole("complementary", { name: "Global navigation" })
    .getByRole("button", { name: "Skills", exact: true })
    .click();
};

const applyActionButton = (page: Page, _targetName: "OpenCode" | "Codex" | "Claude Code") =>
  page.getByRole("button", { name: "Apply", exact: true }).first();

const previewAndApply = async (
  page: Page,
  targetName: "OpenCode" | "Codex" | "Claude Code"
) => {
  await applyActionButton(page, targetName).click();
  const previewDialog = page.getByRole("dialog", { name: "Preview" });
  await previewDialog.waitFor({ state: "visible" });
  await previewDialog.getByRole("button", { name: "Apply profile" }).click();
  await previewDialog.waitFor({ state: "hidden" });
};

const saveProfile = async (page: Page) => {
  const saveButton = page.getByRole("button", { name: "Save", exact: true });
  await saveButton.click();
  await expect.poll(() => page.getByRole("button", { name: "Save", exact: true }).isDisabled())
    .toBe(true);
};

const addLibrarySkillToProfile = async (page: Page, skillName = "Shared Reviewer") => {
  await page.getByRole("button", { name: "Add library skill" }).click();
  const picker = page.getByRole("dialog", { name: "Add library skills" });
  await picker.waitFor({ state: "visible" });
  await picker.getByLabel(skillName).check();
  await picker.getByRole("button", { name: "Add selected skills" }).click();
  await picker.waitFor({ state: "hidden" });
};

const closeCompletedGitHubImport = async (
  page: Page,
  expectedSummary: string,
  importedNames: string[]
) => {
  const dialog = page.getByRole("dialog", { name: "Import skills" });
  await dialog.getByText(expectedSummary, { exact: true }).waitFor({ state: "visible" });
  for (const name of importedNames) {
    await dialog.getByRole("status", { name: `${name}: imported` }).waitFor({ state: "visible" });
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
};

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("Electron UI profile switching e2e", () => {
  it("starts when migrated backups contain former-machine paths or malformed siblings", async () => {
    const { page } = await launchApp({ migratedBackupFixtures: true });

    await page
      .getByRole("region", { name: "Skill library", exact: true })
      .waitFor({ state: "visible" });
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .waitFor({ state: "visible" });
    expect(await page.getByText("Action failed", { exact: true }).count()).toBe(0);
  }, 30_000);

  it("keeps every workspace usable while startup enrichment is still running", async () => {
    const { app: electronApp, page } = await launchApp({ backgroundStartupDelayMs: 10_000 });

    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .waitFor({ state: "visible" });
    await expect.poll(() =>
      electronApp.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          __agentEnvBackgroundOperations?: number;
        };
        return state.__agentEnvBackgroundOperations ?? 0;
      })
    ).toBeGreaterThan(0);

    await page.getByRole("button", { name: "MCPs", exact: true }).click();
    await page
      .getByRole("group", { name: "MCP library item shared-docs" })
      .waitFor({ state: "visible" });

    await selectProfile(page, "UI OpenCode alpha");
    await page.getByRole("region", { name: "Profile composer" }).waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.getByRole("article", { name: "Agent OpenCode" }).waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".settings-page").waitFor({ state: "visible" });
    await page.getByLabel("Language").waitFor({ state: "visible" });

    await openSkillLibrary(page);
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .waitFor({ state: "visible" });
    expect(
      await electronApp.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          __agentEnvBackgroundOperations?: number;
        };
        return state.__agentEnvBackgroundOperations ?? 0;
      })
    ).toBeGreaterThan(0);
  }, 30_000);

  it("opens the Library workspace as the global app area", async () => {
    const { page } = await launchApp();

    await page
      .getByRole("region", { name: "Skill library", exact: true })
      .waitFor({ state: "visible" });
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .waitFor({ state: "visible" });

    expect(await page.getByRole("complementary", { name: "Library summary" }).count()).toBe(0);
    expect(await page.getByRole("group", { name: "Library item shared-reviewer" }).count()).toBe(
      1
    );
    expect(
      await page
        .getByRole("group", { name: "Library item shared-reviewer" })
        .getByText("Shared review guidance for multiple profiles.")
        .count()
    ).toBe(1);
    expect(await page.getByRole("complementary", { name: "Activation" }).count()).toBe(0);
    expect(await page.getByRole("tablist", { name: "Profile sections" }).count()).toBe(0);

    await page.getByRole("button", { name: "Import skills" }).click();
    expect(await page.getByLabel("Local skill folder path").count()).toBe(1);
    expect(await page.getByLabel("Repository address").count()).toBe(0);
    await page.getByRole("tab", { name: "Repository" }).click();
    expect(await page.getByLabel("Local skill folder path").count()).toBe(0);
    await page
      .getByLabel("Repository address")
      .fill("https://github.com/acme/agent-skills/tree/main/skills/reviewer");
    expect(await page.getByRole("button", { name: "Scan", exact: true }).isEnabled()).toBe(true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await selectProfile(page, "UI OpenCode alpha");
    expect(await applyActionButton(page, "OpenCode").count()).toBe(1);
    expect(await page.getByRole("complementary", { name: "Activation" }).count()).toBe(0);
  }, 30_000);

  it("preserves independent Library context across workspaces", async () => {
    const { page } = await launchApp({
      openCodeAlphaLibrarySkillCount: 30,
      mcpLibraryCount: 30
    });
    await page.setViewportSize({ width: 920, height: 620 });
    const navigation = page.getByRole("complementary", { name: "Global navigation" });
    const skillScroller = page.locator(".skill-library-panel .library-table__body");

    await navigation.getByRole("button", { name: "Skills", exact: true }).click();
    await expect
      .poll(() =>
        skillScroller.evaluate((element) => element.scrollHeight - element.clientHeight)
      )
      .toBeGreaterThan(100);
    await skillScroller.evaluate((element) => {
      element.scrollTop = Math.min(220, element.scrollHeight - element.clientHeight);
    });
    expect(await skillScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    await page.getByRole("textbox", { name: "Search skills" }).fill("layout-skill");
    expect(await skillScroller.evaluate((element) => element.scrollTop)).toBe(0);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("combobox", { name: "Skill source filter" }).selectOption("local");
    await page.getByRole("combobox", { name: "Skill usage filter" }).selectOption("referenced");
    await page
      .getByRole("combobox", { name: "Skill Agent filter" })
      .selectOption("not-installed");
    await expect.poll(() => skillScroller.evaluate((element) => element.scrollTop)).toBe(0);
    await expect
      .poll(() =>
        skillScroller.evaluate((element) => element.scrollHeight - element.clientHeight)
      )
      .toBeGreaterThan(100);
    await skillScroller.evaluate((element) => {
      element.scrollTop = Math.min(280, element.scrollHeight - element.clientHeight);
    });
    const skillScroll = await skillScroller.evaluate((element) => element.scrollTop);
    expect(skillScroll).toBeGreaterThan(100);

    await navigation.getByRole("button", { name: "MCPs", exact: true }).click();
    await page.getByRole("textbox", { name: "Search MCPs" }).fill("Fixture MCP");
    const mcpScroller = page.locator(".skill-library-panel > .resource-section");
    await mcpScroller.evaluate((element) => {
      element.scrollTop = Math.min(240, element.scrollHeight - element.clientHeight);
    });
    const mcpScroll = await mcpScroller.evaluate((element) => element.scrollTop);
    expect(mcpScroll).toBeGreaterThan(100);

    await navigation.getByRole("button", { name: "Profiles", exact: true }).click();
    await navigation.getByRole("button", { name: "Skills", exact: true }).click();
    expect(await page.getByRole("textbox", { name: "Search skills" }).inputValue()).toBe(
      "layout-skill"
    );
    await page.getByRole("button", { name: /Filters/, exact: false }).click();
    expect(await page.getByRole("combobox", { name: "Skill source filter" }).inputValue()).toBe(
      "local"
    );
    expect(await page.getByRole("combobox", { name: "Skill Agent filter" }).inputValue()).toBe(
      "not-installed"
    );
    expect(await page.getByRole("combobox", { name: "Skill usage filter" }).inputValue()).toBe(
      "referenced"
    );
    await expect
      .poll(async () =>
        Math.abs((await skillScroller.evaluate((element) => element.scrollTop)) - skillScroll)
      )
      .toBeLessThanOrEqual(2);

    await navigation.getByRole("button", { name: "MCPs", exact: true }).click();
    expect(await page.getByRole("textbox", { name: "Search MCPs" }).inputValue()).toBe(
      "Fixture MCP"
    );
    await expect
      .poll(async () =>
        Math.abs((await mcpScroller.evaluate((element) => element.scrollTop)) - mcpScroll)
      )
      .toBeLessThanOrEqual(2);
  }, 30_000);

  it("supports platform-correct desktop shortcuts in real workspaces", async () => {
    const { appDataRoot, page } = await launchApp();
    const navigation = page.getByRole("complementary", { name: "Global navigation" });
    await selectProfile(page, "UI OpenCode alpha");

    const profileSearch = page.getByRole("textbox", { name: "Search profiles" });
    await profileSearch.fill("UI OpenCode");
    await profileSearch.evaluate((element) => (element as HTMLInputElement).blur());
    await page.keyboard.press("Control+f");
    expect(await profileSearch.evaluate((element) => document.activeElement === element)).toBe(
      false
    );
    await page.keyboard.press("Meta+f");
    expect(
      await profileSearch.evaluate(
        (element) =>
          document.activeElement === element &&
          (element as HTMLInputElement).selectionStart === 0 &&
          (element as HTMLInputElement).selectionEnd === (element as HTMLInputElement).value.length
      )
    ).toBe(true);

    await page.getByRole("button", { name: "New Profile" }).click();
    const modalName = page.getByRole("dialog", { name: "New profile" }).getByLabel("Profile name");
    await modalName.fill("Blocked shortcut");
    await page.keyboard.press("Meta+f");
    expect(await modalName.evaluate((element) => document.activeElement === element)).toBe(true);
    await page.keyboard.press("Escape");

    await expandComposerSection(page, "Instructions");
    const instructions = page.getByRole("textbox", { name: "AGENTS.md" });
    await instructions.fill("# Shortcut E2E\n");
    await page.getByRole("button", { name: "New Profile" }).click();
    await page.keyboard.press("Meta+s");
    await page.waitForTimeout(50);
    expect(
      await readFile(join(appDataRoot, "profiles", "ui-opencode-alpha", "AGENTS.md"), "utf8")
    ).not.toContain("Shortcut E2E");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(50);
    expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    expect(
      await readFile(join(appDataRoot, "profiles", "ui-opencode-alpha", "AGENTS.md"), "utf8")
    ).not.toContain("Shortcut E2E");

    await page.keyboard.press("Meta+s");
    await page.getByRole("status").filter({ hasText: "Profile saved" }).waitFor();
    await expect(
      readFile(join(appDataRoot, "profiles", "ui-opencode-alpha", "AGENTS.md"), "utf8")
    ).resolves.toContain("Shortcut E2E");

    await navigation.getByRole("button", { name: "Skills", exact: true }).click();
    await page.keyboard.press("Meta+f");
    expect(
      await page
        .getByRole("textbox", { name: "Search skills" })
        .evaluate((element) => document.activeElement === element)
    ).toBe(true);

    await navigation.getByRole("button", { name: "MCPs", exact: true }).click();
    await page.keyboard.press("Meta+f");
    expect(
      await page
        .getByRole("textbox", { name: "Search MCPs" })
        .evaluate((element) => document.activeElement === element)
    ).toBe(true);

    await navigation.getByRole("button", { name: "Agents", exact: true }).click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Meta+f");
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    await navigation.getByRole("button", { name: "Settings", exact: true }).click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Meta+f");
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  }, 30_000);

  it("prevents duplicate Meta saves while the Electron IPC is pending", async () => {
    const { app: electronApp, page } = await launchApp();
    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Instructions");
    await page.getByRole("textbox", { name: "AGENTS.md" }).fill("# Pending E2E save\n");

    await electronApp.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { __agentEnvShortcutSaveCalls?: number };
      state.__agentEnvShortcutSaveCalls = 0;
      ipcMain.removeHandler("profiles:save");
      ipcMain.handle("profiles:save", async (_event, input) => {
        state.__agentEnvShortcutSaveCalls = (state.__agentEnvShortcutSaveCalls ?? 0) + 1;
        await new Promise((resolve) => setTimeout(resolve, 200));
        const value = input as {
          manifest: { id: string };
          instructions: string;
          configText: string;
          assetPolicy: unknown;
        };
        return { id: value.manifest.id, ...value };
      });
    });

    await page.keyboard.press("Meta+s");
    await page.keyboard.press("Meta+s");
    await page.waitForTimeout(50);
    expect(
      await electronApp.evaluate(() =>
        (globalThis as typeof globalThis & { __agentEnvShortcutSaveCalls?: number })
          .__agentEnvShortcutSaveCalls
      )
    ).toBe(1);
    await page.getByRole("status").filter({ hasText: "Profile saved" }).waitFor();
  }, 30_000);

  it("keeps desktop shortcuts behind each real blocking modal category", async () => {
    const { page } = await launchApp();
    const expectFocusInside = async (dialog: Locator) =>
      expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
    const expectFocusTrapped = async (dialog: Locator) => {
      const controls = dialog.locator(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      const first = controls.first();
      const last = controls.last();
      await first.focus();
      await page.keyboard.press("Shift+Tab");
      expect(await last.evaluate((element) => document.activeElement === element)).toBe(true);
      await page.keyboard.press("Tab");
      expect(await first.evaluate((element) => document.activeElement === element)).toBe(true);
    };

    await page.getByRole("button", { name: "Profiles", exact: true }).click();
    const newProfileTrigger = page.getByRole("button", { name: "New Profile" });
    await newProfileTrigger.click();
    const newProfileDialog = page.getByRole("dialog", { name: "New profile" });
    await expectFocusInside(newProfileDialog);
    await expectFocusTrapped(newProfileDialog);
    await page.keyboard.press("Escape");
    await newProfileDialog.waitFor({ state: "hidden" });
    expect(await newProfileTrigger.evaluate((element) => document.activeElement === element)).toBe(true);

    await selectProfile(page, "UI OpenCode alpha");
    await applyActionButton(page, "OpenCode").click();
    const preview = page.getByRole("dialog", { name: "Preview" });
    await preview.waitFor({ state: "visible" });
    await preview.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Meta+f");
    await expectFocusInside(preview);
    await page.keyboard.press("Escape");

    await expandComposerSection(page, "Skills");
    await page.getByRole("button", { name: "Add library skill" }).click();
    const picker = page.getByRole("dialog", { name: "Add library skills" });
    await picker.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Meta+f");
    await expectFocusInside(picker);
    await page.keyboard.press("Escape");

    await openSkillLibrary(page);
    const skillSearch = page.getByRole("textbox", { name: "Search skills" });
    const sharedRow = page.getByRole("group", { name: "Library item shared-reviewer" });
    await sharedRow.getByRole("button", { name: "More actions for shared-reviewer" }).click();
    await page.getByRole("menuitem", { name: /Remove from library/ }).click();
    const skillDelete = page.getByRole("dialog", { name: "Delete library skill" });
    await expectFocusInside(skillDelete);
    await expectFocusTrapped(skillDelete);
    await page.keyboard.press("Meta+f");
    await expectFocusInside(skillDelete);
    expect(await skillSearch.evaluate((element) => document.activeElement === element)).toBe(false);
    await page.keyboard.press("Escape");
    await skillDelete.waitFor({ state: "hidden" });
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
      .toBe("More actions for shared-reviewer");

    await page.getByRole("button", { name: "MCPs", exact: true }).click();
    const mcpSearch = page.getByRole("textbox", { name: "Search MCPs" });
    await page.getByRole("button", { name: "Add MCP" }).click();
    const editor = page.getByRole("dialog", { name: "MCP editor" });
    await page.keyboard.press("Meta+f");
    await expectFocusInside(editor);
    expect(await mcpSearch.evaluate((element) => document.activeElement === element)).toBe(false);
    await page.keyboard.press("Escape");

    const sharedMcp = page.getByRole("group", { name: "MCP library item shared-docs" });
    await sharedMcp.getByRole("button", { name: "More actions for shared-docs" }).click();
    const mcpMenu = page.getByRole("menu", { name: "Actions for shared-docs" });
    await expectInViewport(page, mcpMenu);
    await expectTopmost(mcpMenu);
    await mcpMenu.getByRole("menuitem", { name: "Remove shared-docs" }).click();
    const mcpDelete = page.getByRole("dialog", { name: "Delete MCP" });
    await expectFocusInside(mcpDelete);
    await expectFocusTrapped(mcpDelete);
    await page.keyboard.press("Meta+f");
    await expectFocusInside(mcpDelete);
    expect(await mcpSearch.evaluate((element) => document.activeElement === element)).toBe(false);
    await page.keyboard.press("Escape");
    await mcpDelete.waitFor({ state: "hidden" });
    await expect
      .poll(() =>
        sharedMcp
          .getByRole("button", { name: "More actions for shared-docs" })
          .evaluate((element) => document.activeElement === element)
      )
      .toBe(true);
  }, 30_000);

  it("keeps Library scale correct and responsive at supported viewports", async () => {
    const cases = [
      { count: 100, width: 1180, height: 728, initialBudget: 750, actionBudget: 250 },
      { count: 100, width: 920, height: 620, initialBudget: 750, actionBudget: 250 },
      { count: 500, width: 1180, height: 728, initialBudget: 1500, actionBudget: 500 },
      { count: 500, width: 920, height: 620, initialBudget: 1500, actionBudget: 500 }
    ];
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[1];
    const measurements: Array<Record<string, unknown>> = [];

    for (const testCase of cases) {
      const { page } = await launchApp({
        openCodeAlphaLibrarySkillCount: testCase.count
      });
      await page.setViewportSize({ width: testCase.width, height: testCase.height });
      const navigation = page.getByRole("complementary", { name: "Global navigation" });
      const allRows = page.locator('[role="group"][aria-label^="Library item "]');
      const navigationRuns: number[] = [];
      const searchRuns: number[] = [];
      const filterRuns: number[] = [];

      await navigation.getByRole("button", { name: "Profiles", exact: true }).click();
      for (let run = 0; run < 4; run += 1) {
        const startedAt = await page.evaluate(() => performance.now());
        await navigation.getByRole("button", { name: "Skills", exact: true }).click();
        await expect.poll(() => allRows.count()).toBe(testCase.count + 2);
        const duration = (await page.evaluate(() => performance.now())) - startedAt;
        if (run > 0) navigationRuns.push(duration);
        await navigation.getByRole("button", { name: "Profiles", exact: true }).click();
      }
      await navigation.getByRole("button", { name: "Skills", exact: true }).click();
      const search = page.getByRole("textbox", { name: "Search skills" });
      for (let run = 0; run < 4; run += 1) {
        const startedAt = await page.evaluate(() => performance.now());
        await search.fill(`layout-skill-${testCase.count}`);
        await expect.poll(() => allRows.count()).toBe(1);
        const duration = (await page.evaluate(() => performance.now())) - startedAt;
        if (run > 0) searchRuns.push(duration);
        await search.fill("");
        await expect.poll(() => allRows.count()).toBe(testCase.count + 2);
      }
      const updatesTab = page.getByRole("tab", { name: /Updates/ });
      const allTab = page.getByRole("tab", { name: /All/ });
      for (let run = 0; run < 4; run += 1) {
        const startedAt = await page.evaluate(() => performance.now());
        await updatesTab.click();
        await expect.poll(() => allRows.count()).toBe(testCase.count + 1);
        const duration = (await page.evaluate(() => performance.now())) - startedAt;
        if (run > 0) filterRuns.push(duration);
        await allTab.click();
        await expect.poll(() => allRows.count()).toBe(testCase.count + 2);
      }

      await expect.poll(() => allRows.count()).toBe(testCase.count + 2);
      const filtersTrigger = page.getByRole("button", { name: "Filters", exact: true });
      await filtersTrigger.click();
      const filterPanel = page.getByRole("group", { name: "Skill filters" });
      const filterGeometry = await filterPanel.evaluate((panel) => {
        const panelRect = panel.getBoundingClientRect();
        const controls = Array.from(panel.querySelectorAll<HTMLElement>("select, button"));
        const rects = controls.map((control) => control.getBoundingClientRect());
        return {
          controlsInsidePanel: rects.every(
            (rect) =>
              rect.left >= panelRect.left - 1 &&
              rect.right <= panelRect.right + 1 &&
              rect.top >= panelRect.top - 1 &&
              rect.bottom <= panelRect.bottom + 1
          ),
          controlsDoNotOverlap: rects.every((rect, index) =>
            rects.slice(index + 1).every(
              (other) =>
                rect.right <= other.left ||
                other.right <= rect.left ||
                rect.bottom <= other.top ||
                other.bottom <= rect.top
            )
          ),
          noHorizontalOverflow: panel.scrollWidth <= panel.clientWidth
        };
      });
      expect(filterGeometry.controlsInsidePanel).toBe(true);
      expect(filterGeometry.controlsDoNotOverlap).toBe(true);
      expect(filterGeometry.noHorizontalOverflow).toBe(true);
      const sourceFilter = page.getByRole("combobox", { name: "Skill source filter" });
      await sourceFilter.selectOption("github");
      await expect.poll(() => allRows.count()).toBe(0);
      await sourceFilter.selectOption("local");
      await expect.poll(() => allRows.count()).toBe(testCase.count + 2);
      await sourceFilter.selectOption("all");
      const usageFilter = page.getByRole("combobox", { name: "Skill usage filter" });
      await usageFilter.selectOption("referenced");
      await expect.poll(() => allRows.count()).toBe(testCase.count);
      await usageFilter.selectOption("unreferenced");
      await expect.poll(() => allRows.count()).toBe(2);
      await usageFilter.selectOption("all");
      const targetFilter = page.getByRole("combobox", { name: "Skill Agent filter" });
      await targetFilter.selectOption("managed");
      await expect.poll(() => allRows.count()).toBe(0);
      await targetFilter.selectOption("all");
      await expect.poll(() => allRows.count()).toBe(testCase.count + 2);
      await page.keyboard.press("Escape");
      await filterPanel.waitFor({ state: "hidden" });
      expect(await filtersTrigger.evaluate((element) => document.activeElement === element)).toBe(true);

      await expectNoHorizontalOverflow(page, [".app-shell", ".editor-panel"]);

      const changingRow = page.getByRole("group", {
        name: "Library item layout-skill-1",
        exact: true
      });
      const updateActionGeometry = await changingRow.evaluate((row) => {
        const updateCell = row.querySelector<HTMLElement>(".library-status-cell")!;
        const updateButton = updateCell.querySelector<HTMLButtonElement>(".library-status-action")!;
        const updateDetail = updateCell.querySelector<HTMLElement>(".library-status-detail")!;
        const actionsCell = row.querySelector<HTMLElement>(".library-actions-cell")!;
        const updateRect = updateCell.getBoundingClientRect();
        const buttonRect = updateButton.getBoundingClientRect();
        const detailRect = updateDetail.getBoundingClientRect();
        const detailVisible = getComputedStyle(updateDetail).display !== "none";
        const actionsRect = actionsCell.getBoundingClientRect();
        return {
          background: getComputedStyle(updateButton).backgroundColor,
          buttonFitsText: updateButton.scrollWidth <= updateButton.clientWidth,
          buttonInsideUpdateColumn:
            buttonRect.left >= updateRect.left - 1 && buttonRect.right <= updateRect.right + 1,
          columnsDoNotOverlap: updateRect.right <= actionsRect.left,
          detailClearance: detailVisible ? detailRect.top - buttonRect.bottom : undefined,
          foreground: getComputedStyle(updateButton).color
        };
      });
      expect(updateActionGeometry.background).not.toBe("rgb(0, 122, 255)");
      expect(updateActionGeometry.foreground).toBe("rgb(0, 122, 255)");
      expect(updateActionGeometry.buttonFitsText).toBe(true);
      expect(updateActionGeometry.buttonInsideUpdateColumn).toBe(true);
      expect(updateActionGeometry.columnsDoNotOverlap).toBe(true);
      if (updateActionGeometry.detailClearance !== undefined) {
        expect(updateActionGeometry.detailClearance).toBeGreaterThanOrEqual(3);
      }
      await expectTextFits(changingRow.locator(".library-status-action"));
      const beforeUpdateHeight = (await changingRow.boundingBox())?.height;
      await changingRow.getByRole("button", { name: "Review update layout-skill-1" }).click();
      await page.getByRole("button", { name: "Apply update layout-skill-1" }).click();
      await changingRow.getByText("Up to date").waitFor({ state: "visible" });
      await expect
        .poll(() => changingRow.getByRole("button", { name: "Check update layout-skill-1" }).count())
        .toBe(0);
      const afterUpdateHeight = (await changingRow.boundingBox())?.height;
      expect(afterUpdateHeight).toBe(beforeUpdateHeight);

      const firstRow = allRows.first();
      const lastRow = allRows.last();
      const firstId = (await firstRow.getAttribute("aria-label"))!.replace("Library item ", "");
      const lastId = (await lastRow.getAttribute("aria-label"))!.replace("Library item ", "");
      await firstRow.getByRole("button", { name: `More actions for ${firstId}` }).click();
      const firstMenu = page.getByRole("menu", { name: `Actions for ${firstId}` });
      await expectInViewport(page, firstMenu);
      await expectTopmost(firstMenu);
      await page.mouse.click(220, 120);
      await firstMenu.waitFor({ state: "hidden" });

      await lastRow.scrollIntoViewIfNeeded();
      await lastRow
        .getByRole("button", { name: `More actions for ${lastId}` })
        .click();
      const lastMenu = page.getByRole("menu", {
        name: `Actions for ${lastId}`
      });
      await expectInViewport(page, lastMenu);
      await expectTopmost(lastMenu);
      await page.keyboard.press("Escape");
      await lastMenu.waitFor({ state: "hidden" });

      const result = {
        rows: testCase.count,
        viewport: `${testCase.width}x${testCase.height}`,
        navigationRuns,
        searchRuns,
        filterRuns,
        navigationMedian: median(navigationRuns),
        searchMedian: median(searchRuns),
        filterMedian: median(filterRuns)
      };
      measurements.push(result);
      expect(result.navigationMedian).toBeLessThanOrEqual(testCase.initialBudget);
      expect(result.searchMedian).toBeLessThanOrEqual(testCase.actionBudget);
      expect(result.filterMedian).toBeLessThanOrEqual(testCase.actionBudget);

      await app?.close();
      app = undefined;
      await rm(root, { recursive: true, force: true });
      root = "";
    }

    process.stdout.write(`\nAGENTENV_LIBRARY_SCALE=${JSON.stringify(measurements)}\n`);
  }, 120_000);

  it("shows target readiness from installed commands and writable local paths", async () => {
    const { homeDir, page } = await launchApp();

    await page.getByRole("button", { name: "Agents" }).click();
    const targetsPage = page.getByRole("region", { name: "Agents", exact: true });
    await targetsPage.waitFor({ state: "visible" });

    const openCodeCard = page.getByRole("article", { name: "Agent OpenCode" });
    await openCodeCard.waitFor({ state: "visible" });
    await expect.poll(() => openCodeCard.textContent()).toContain("Ready");
    await expect.poll(() => openCodeCard.textContent()).toContain("Not managed");
    await openCodeCard.getByRole("button", { name: "Show OpenCode diagnostics" }).click();
    await expect.poll(() => openCodeCard.textContent()).toContain(
      join(homeDir, ".config", "opencode")
    );
    await expect.poll(() => openCodeCard.textContent()).toContain("Config directory");
    await expect.poll(() => openCodeCard.textContent()).toContain("Writable");

    const codexCard = page.getByRole("article", { name: "Agent Codex" });
    await codexCard.waitFor({ state: "visible" });
    await expect.poll(() => codexCard.textContent()).toContain("Ready");
    await codexCard.getByRole("button", { name: "Show Codex diagnostics" }).click();
    await expect.poll(() => codexCard.textContent()).toContain(join(homeDir, ".codex"));

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => page.getByRole("status").textContent()).toContain("Agents refreshed");
    await page.getByText("Agents refreshed").waitFor({ state: "hidden", timeout: 7000 });
  }, 30_000);

  it("shows a missing Target after its command is no longer detected", async () => {
    const { app: electronApp, opencodeDir, page } = await launchApp();
    const originalInstructions = await readFile(join(opencodeDir, "AGENTS.md"), "utf8");
    const targets = await page.evaluate(() => window.agentEnv.listTargets());
    await electronApp.evaluate(({ ipcMain }, currentTargets) => {
      ipcMain.removeHandler("targets:list");
      ipcMain.handle("targets:list", () =>
        currentTargets.map((target) =>
          target.id === "opencode"
            ? {
                ...target,
                health: {
                  ...target.health,
                  status: "missing",
                  installationFound: false,
                  installationEvidence: [],
                  executableFound: false,
                  executablePath: undefined,
                  canWrite: false,
                  summary: "opencode command was not found"
                }
              }
            : target
        )
      );
    }, targets);

    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    const openCodeCard = page.getByRole("article", { name: "Agent OpenCode" });
    await expect.poll(() => openCodeCard.textContent()).toContain("Missing");
    const captureCurrent = openCodeCard.getByRole("button", { name: "Create profile from OpenCode" });
    await expect.poll(() => captureCurrent.isDisabled()).toBe(true);
    expect(await captureCurrent.getAttribute("title")).toBe("OpenCode is not detected");
    await expect(readFile(join(opencodeDir, "AGENTS.md"), "utf8")).resolves.toBe(
      originalInstructions
    );
  }, 30_000);

  it("updates target cards after taking over OpenCode", async () => {
    const { page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    await page.getByRole("button", { name: "Agents" }).click();

    const openCodeCard = page.getByRole("article", { name: "Agent OpenCode" });
    await openCodeCard.waitFor({ state: "visible" });
    await expect.poll(() => openCodeCard.textContent()).toContain("ManagementApplied");
    await expect.poll(() => openCodeCard.textContent()).toContain("Active profileUI OpenCode alpha");
    await expect
      .poll(() =>
        openCodeCard.getByRole("button", { name: "Open OpenCode in Profiles" }).textContent()
      )
      .toContain("Open Profile");
  }, 30_000);

  it("blocks profile apply when the target paths are no longer writable", async () => {
    const { opencodeDir, page } = await launchApp();
    const instructionsPath = join(opencodeDir, "AGENTS.md");
    const configPath = join(opencodeDir, "opencode.jsonc");
    const originalInstructions = await readFile(instructionsPath, "utf8");

    await selectProfile(page, "UI OpenCode alpha");
    await chmod(instructionsPath, 0o444);
    await chmod(configPath, 0o444);
    await chmod(opencodeDir, 0o555);
    try {
      await page.getByRole("button", { name: "Agents" }).click();
      await page.getByRole("button", { name: "Refresh" }).click();
      const openCodeCard = page.getByRole("article", { name: "Agent OpenCode" });
      await expect.poll(() => openCodeCard.textContent()).toContain("Needs setup");
      await openCodeCard.getByRole("button", { name: "Show OpenCode diagnostics" }).click();
      await expect.poll(() => openCodeCard.textContent()).toContain("Read-only");
      await expect(readFile(instructionsPath, "utf8")).resolves.toBe(originalInstructions);
    } finally {
      await chmod(opencodeDir, 0o755);
      await chmod(instructionsPath, 0o644);
      await chmod(configPath, 0o644);
    }
  }, 30_000);

  it("shows a missing Profile resource in preview without writing the Target", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    const instructionsPath = join(opencodeDir, "AGENTS.md");
    const originalInstructions = await readFile(instructionsPath, "utf8");

    await selectProfile(page, "UI OpenCode alpha");
    await rm(join(appDataRoot, "profiles", "ui-opencode-alpha", "skills", "alpha-skill"), {
      recursive: true,
      force: true
    });
    await applyActionButton(page, "OpenCode").click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });
    await expect.poll(() => previewDialog.textContent()).toContain("Owned skill source does not exist");
    await expect.poll(() => previewDialog.getByRole("button", { name: "Apply profile" }).isDisabled())
      .toBe(true);
    await expect(readFile(instructionsPath, "utf8")).resolves.toBe(originalInstructions);
  }, 30_000);

  it("creates, edits, duplicates, and deletes profiles through the rendered app", async () => {
    const { appDataRoot, page } = await launchApp();

    await page.getByRole("button", { name: "Profiles" }).click();
    await applyActionButton(page, "OpenCode").waitFor({
      state: "visible",
      timeout: 10_000
    });
    await page.getByRole("button", { name: "New Profile" }).click({ timeout: 5_000 });
    const createDialog = page.getByRole("dialog", { name: "New profile" });
    await createDialog.waitFor({ state: "visible", timeout: 5_000 });
    await createDialog.getByLabel("Profile name").fill("Docs Writing");
    await createDialog.getByLabel("Description").fill("Writing workspace");
    await createDialog.getByRole("button", { name: "Create" }).click();
    await page.getByRole("heading", { name: "Docs Writing" }).waitFor({
      state: "visible",
      timeout: 10_000
    });
    const newProfileRow = page.getByRole("group", { name: "Profile Docs Writing" });
    const newProfileGeometry = await newProfileRow.evaluate((row) => {
      const icon = row.querySelector<HTMLElement>(".profile-row__icon")!.getBoundingClientRect();
      const content = row.querySelector<HTMLElement>(".profile-row__content")!.getBoundingClientRect();
      return {
        iconSize: Math.round(icon.width),
        contentGap: Math.round(content.left - icon.right)
      };
    });
    expect(newProfileGeometry).toEqual({ iconSize: 24, contentGap: 4 });
    expect(await findProfileByName(appDataRoot, "Docs Writing")).toMatchObject({
      name: "Docs Writing",
      description: "Writing workspace"
    });

    await page.getByRole("button", { name: "Edit profile" }).click({ timeout: 5_000 });
    const editDialog = page.getByRole("dialog", { name: "Edit profile" });
    await editDialog.waitFor({ state: "visible", timeout: 5_000 });
    await editDialog.getByLabel("Profile name").fill("Docs Writing v2");
    await editDialog.getByLabel("Description").fill("Updated writing workspace");
    await editDialog.getByRole("button", { name: "Done", exact: true }).click();
    await editDialog.waitFor({ state: "hidden" });
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("heading", { name: "Docs Writing v2" }).waitFor({
      state: "visible",
      timeout: 10_000
    });
    expect(await page.getByRole("group", { name: "Profile Docs Writing v2" }).getByText("Current", {
      exact: true
    }).count()).toBe(0);
    expect(await findProfileByName(appDataRoot, "Docs Writing v2")).toMatchObject({
      name: "Docs Writing v2",
      description: "Updated writing workspace"
    });

    await page.getByRole("button", { name: "More profile actions" }).click({ timeout: 5_000 });
    await page.getByRole("menuitem", { name: "Duplicate profile" }).click({ timeout: 5_000 });
    await page.getByRole("heading", { name: "Docs Writing v2 Copy" }).waitFor({
      state: "visible",
      timeout: 10_000
    });
    const duplicate = await findProfileByName(appDataRoot, "Docs Writing v2 Copy");
    expect(duplicate).toMatchObject({ name: "Docs Writing v2 Copy" });
    const profileNames = () =>
      page.locator(".profile-row__name").evaluateAll((items) =>
        items.map((item) => item.textContent)
      );
    expect((await profileNames()).slice(0, 2)).toEqual([
      "Docs Writing v2 Copy",
      "Docs Writing v2"
    ]);
    await page
      .locator(".profile-row")
      .filter({ has: page.getByText("Docs Writing v2", { exact: true }) })
      .locator(".profile-row__content")
      .click();
    await page.getByRole("heading", { name: "Docs Writing v2" }).waitFor({ state: "visible" });
    expect((await profileNames()).slice(0, 2)).toEqual([
      "Docs Writing v2 Copy",
      "Docs Writing v2"
    ]);
    await page
      .locator(".profile-row")
      .filter({ has: page.getByText("Docs Writing v2 Copy", { exact: true }) })
      .locator(".profile-row__content")
      .click();

    await page.getByRole("button", { name: "More profile actions" }).click({ timeout: 5_000 });
    await page.getByRole("menuitem", { name: "Delete profile" }).click({ timeout: 5_000 });
    const deleteDialog = page.getByRole("dialog", { name: "Delete profile" });
    await deleteDialog.waitFor({ state: "visible", timeout: 5_000 });
    await deleteDialog.getByRole("button", { name: "Remove profile" }).click();
    await page.getByRole("heading", { name: "Docs Writing v2" }).waitFor({
      state: "visible",
      timeout: 10_000
    });
    expect(await findProfileByName(appDataRoot, "Docs Writing v2 Copy")).toBeUndefined();
  }, 30_000);

  it("protects the active target profile from removal in the UI and IPC", async () => {
    const { page } = await launchApp();
    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");

    await page.getByRole("button", { name: "More profile actions" }).click();
    await page.getByRole("menuitem", { name: "Delete profile" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete profile" });
    await expect.poll(() => deleteDialog.textContent()).toContain(
      "Apply another profile or stop managing each Agent"
    );
    expect(await deleteDialog.getByRole("button", { name: "Remove profile" }).count()).toBe(0);
    await deleteDialog.getByRole("button", { name: "Open Agents" }).click();
    await page.getByRole("heading", { name: "Agents" }).waitFor({ state: "visible" });

    const ipcResult = await page.evaluate(async () => {
      try {
        await window.agentEnv.deleteProfile("ui-opencode-alpha");
        return "removed";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(ipcResult).toContain("Apply another profile before removing this active profile");
  }, 30_000);

  it("dismisses modal tools with Escape and outside clicks in the rendered app", async () => {
    const { page } = await launchApp();

    await page.getByRole("button", { name: "Profiles" }).click();
    await applyActionButton(page, "OpenCode").waitFor({
      state: "visible",
      timeout: 10_000
    });
    await page.getByRole("button", { name: "New Profile" }).click({ timeout: 5_000 });
    const createDialog = page.getByRole("dialog", { name: "New profile" });
    await createDialog.waitFor({ state: "visible", timeout: 5_000 });
    await page
      .locator(".preview-modal-backdrop")
      .click({ position: { x: 8, y: 8 }, timeout: 5_000 });
    await createDialog.waitFor({ state: "hidden", timeout: 5_000 });

    await selectProfile(page, "UI OpenCode alpha");
    await applyActionButton(page, "OpenCode").click({ timeout: 5_000 });
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible", timeout: 5_000 });
    await page.keyboard.press("Escape");
    await previewDialog.waitFor({ state: "hidden", timeout: 5_000 });

    await page.getByRole("button", { name: "Select apply Agent" }).click({ timeout: 5_000 });
    const targetMenu = page.getByRole("menu", { name: "Apply Agents" });
    await targetMenu.waitFor({ state: "visible", timeout: 5_000 });
    await page.mouse.click(240, 120);
    await targetMenu.waitFor({ state: "hidden", timeout: 5_000 });

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Import skills" }).click({ timeout: 5_000 });
    const importDialog = page.getByRole("dialog", { name: "Import skills" });
    await importDialog.waitFor({ state: "visible", timeout: 5_000 });
    await page.mouse.click(240, 120);
    await importDialog.waitFor({ state: "hidden", timeout: 5_000 });
  }, 30_000);

  it("consolidates an existing target skill into the shared library", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    await writeUnmanagedTargetSkill(
      opencodeDir,
      "late-target-reviewer",
      "Created after app launch and discovered by manual scan.",
      "skill"
    );

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    await page
      .getByRole("group", { name: "Cleanup group target-only-reviewer" })
      .waitFor({ state: "visible", timeout: 5_000 });
    await page
      .getByRole("group", { name: "Cleanup group late-target-reviewer" })
      .waitFor({ state: "visible", timeout: 5_000 });

    const cleanupHistoryRegion = page.getByRole("region", { name: "Cleanup history" });
    expect(
      await cleanupHistoryRegion.evaluate(
        (element) =>
          !element.classList.contains("resource-section") &&
          element.parentElement?.classList.contains("target-discovery-section") === true
      )
    ).toBe(true);

    const cleanupGroup = page.getByRole("group", { name: "Cleanup group target-only-reviewer" });
    const locationsPreview = cleanupGroup.getByLabel("Full cleanup locations target-only-reviewer");
    await locationsPreview.focus();
    const locationsTooltip = page.getByRole("tooltip");
    await locationsTooltip.waitFor({ state: "visible", timeout: 5_000 });
    await expect.poll(() => locationsTooltip.textContent()).toContain("target-only-reviewer");
    await locationsPreview.evaluate((element) => element.blur());

    await expect.poll(() => cleanupGroup.textContent()).toContain("Unmanaged");
    await cleanupGroup
      .getByRole("button", { name: "More cleanup actions for target-only-reviewer" })
      .click();
    await page.getByRole("menuitem", { name: "Details" }).click();
    const detailsDialog = page.getByRole("dialog", {
      name: "Skill details target-only-reviewer"
    });
    await detailsDialog.waitFor({ state: "visible" });
    await expect.poll(() => detailsDialog.textContent()).toContain(
      join(opencodeDir, "skills", "target-only-reviewer")
    );
    await page.keyboard.press("Escape");
    await detailsDialog.waitFor({ state: "hidden" });
    await cleanupGroup.getByRole("button", { name: "Add to Library target-only-reviewer" }).click();
    let addDialog = page.getByRole("dialog", { name: "Review skill cleanup" });
    const targetOnlyPath = join(opencodeDir, "skills", "target-only-reviewer", "SKILL.md");
    const originalTargetOnlyContent = await readFile(targetOnlyPath, "utf8");
    await writeFile(targetOnlyPath, `${originalTargetOnlyContent}\n# Changed after preview\n`, "utf8");
    await addDialog.getByRole("button", { name: "Add to Library" }).click();
    await expect
      .poll(() => page.locator(".app-feedback").textContent(), { timeout: 5_000 })
      .toContain("changed after the cleanup preview");
    await expect(
      fileExists(join(appDataRoot, "skills-library", "target-only-reviewer"))
    ).resolves.toBe(false);
    await writeFile(targetOnlyPath, originalTargetOnlyContent, "utf8");
    await page.getByRole("button", { name: "Refresh local skills" }).click();
    await cleanupGroup.getByRole("button", { name: "Add to Library target-only-reviewer" }).click();
    addDialog = page.getByRole("dialog", { name: "Review skill cleanup" });
    await addDialog.getByRole("button", { name: "Add to Library" }).click();
    await expect
      .poll(() => page.locator(".app-feedback").textContent(), { timeout: 5_000 })
      .toContain("Added target-only-reviewer to Library");
    await page
      .getByRole("group", { name: "Library item target-only-reviewer" })
      .waitFor({ state: "visible", timeout: 5_000 });
    await expect.poll(() => cleanupGroup.textContent()).toContain("Managed");
    await expect.poll(() => cleanupGroup.textContent()).not.toContain("Duplicate");
    expect(
      await cleanupGroup.getByRole("button", { name: "Add to Library target-only-reviewer" }).count()
    ).toBe(0);
    expect(
      await cleanupGroup.getByRole("button", {
        name: "More cleanup actions for target-only-reviewer"
      }).count()
    ).toBe(1);
    await page.getByRole("button", { name: "Close library tool" }).click();

    expect(await page.getByText("Existing target skill ready to migrate.").count()).toBeGreaterThan(
      0
    );
    await expect(
      readFile(join(appDataRoot, "skills-library", "target-only-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("Migrate me into the shared library.");
    await expect(
      readFile(
        `${join(opencodeDir, "skills", "target-only-reviewer")}.agentenv-owner.json`,
        "utf8"
      )
    ).resolves.toContain('"source": "skills-library/target-only-reviewer"');

    const managedRow = page.getByRole("group", { name: "Library item target-only-reviewer" });
    await managedRow
      .getByRole("button", { name: "More actions for target-only-reviewer" })
      .click();
    await page.getByRole("menuitem", { name: /Remove from library/ }).click();
    const removeDialog = page.getByRole("dialog", { name: "Delete library skill" });
    await expect.poll(() => removeDialog.textContent()).toContain("1 managed Agent install");
    await removeDialog.getByRole("button", { name: "Remove skill and installs" }).click();
    await expect
      .poll(() => page.getByRole("status").textContent(), { timeout: 5_000 })
      .toContain("Removed target-only-reviewer");
    await expect(
      fileExists(join(opencodeDir, "skills", "target-only-reviewer"))
    ).resolves.toBe(false);
    await expect(
      fileExists(join(appDataRoot, "skills-library", "target-only-reviewer"))
    ).resolves.toBe(false);
    await page.getByRole("button", { name: "Undo removal" }).click();
    await expect
      .poll(() => page.getByRole("status").textContent(), { timeout: 5_000 })
      .toContain("Skill removal undone");
    await expect(
      fileExists(`${join(opencodeDir, "skills", "target-only-reviewer")}.agentenv-owner.json`)
    ).resolves.toBe(true);
    await expect(
      fileExists(join(appDataRoot, "skills-library", "target-only-reviewer", "SKILL.md"))
    ).resolves.toBe(true);

    await page.getByRole("button", { name: "Scan local" }).click();
    const cleanupHistory = page.getByRole("region", { name: "Cleanup history" });
    await cleanupHistory.waitFor({ state: "visible", timeout: 5_000 });
    expect(await cleanupHistory.locator(".cleanup-history-row.resource-row").count()).toBeGreaterThan(0);
    const historyDetails = cleanupHistory.getByLabel(
      "Full cleanup history details target-only-reviewer"
    );
    await historyDetails.focus();
    await page.getByRole("tooltip").waitFor({ state: "visible", timeout: 5_000 });
    await historyDetails.evaluate((element) => element.blur());
    await cleanupHistory
      .getByRole("button", { name: "Restore cleanup target-only-reviewer" })
      .click();
    await expect
      .poll(() => page.locator(".app-feedback").textContent(), { timeout: 5_000 })
      .toContain("Skill cleanup undone");
    await expect(
      readFile(join(opencodeDir, "skills", "target-only-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("Migrate me into the shared library.");
    await expect(
      fileExists(`${join(opencodeDir, "skills", "target-only-reviewer")}.agentenv-owner.json`)
    ).resolves.toBe(false);
    await expect(
      fileExists(join(appDataRoot, "skills-library", "target-only-reviewer"))
    ).resolves.toBe(false);
  }, 30_000);

  it("keeps ignored local skill groups visible and blocks conflicting profile apply", async () => {
    const { opencodeDir, page } = await launchApp();
    await writeUnmanagedTargetSkill(
      opencodeDir,
      "ui-alpha-skill",
      "Local copy intentionally left unmanaged."
    );

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    const cleanupGroup = page.getByRole("group", { name: "Cleanup group ui-alpha-skill" });
    await cleanupGroup.waitFor({ state: "visible" });
    await cleanupGroup
      .getByRole("button", { name: "More cleanup actions for ui-alpha-skill" })
      .click();
    await page.getByRole("menuitem", { name: "Ignore" }).click();
    await expect.poll(() => cleanupGroup.textContent()).toContain("Ignored");

    await selectProfile(page, "UI OpenCode alpha");
    await applyActionButton(page, "OpenCode").click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });
    await expect
      .poll(() => previewDialog.textContent())
      .toContain("Cannot install ui-alpha-skill because an ignored unmanaged skill already exists");
    await expect
      .poll(() => previewDialog.getByRole("button", { name: "Apply profile" }).isDisabled())
      .toBe(true);
  }, 30_000);

  it("backs up and replaces managed OpenCode drift after explicit confirmation", async () => {
    const { opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    await writeFile(join(opencodeDir, "AGENTS.md"), "# Changed outside AgentEnv\n", "utf8");

    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByText("Agents refreshed", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Profiles", exact: true }).click();
    await page.getByRole("heading", { name: "UI OpenCode alpha" }).waitFor({ state: "visible" });
    await expect
      .poll(() => page.locator(".profile-apply-button").getAttribute("title"), {
        timeout: 5_000
      })
      .toBe("Review OpenCode issues");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });
    await expect
      .poll(() => previewDialog.textContent())
      .toContain("OpenCode instructions changed outside AgentEnv");
    await expect
      .poll(() => previewDialog.getByRole("button", { name: "Apply profile" }).isDisabled())
      .toBe(true);
    await previewDialog
      .getByLabel("I understand; back up and replace these changes")
      .check();
    await previewDialog.getByRole("button", { name: "Back up and replace" }).click();
    await previewDialog.waitFor({ state: "hidden" });
    await expect(readFile(join(opencodeDir, "AGENTS.md"), "utf8")).resolves.toContain("UI ALPHA");
  }, 30_000);

  it("offers one recoverable drift action when another tool replaces a managed Skill", async () => {
    const { opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    const targetSkillDir = join(opencodeDir, "skills", "ui-alpha-skill");
    await rm(targetSkillDir, { recursive: true, force: true });
    await rm(`${targetSkillDir}.agentenv-owner.json`, { force: true });
    await mkdir(targetSkillDir, { recursive: true });
    await writeFile(
      join(targetSkillDir, "SKILL.md"),
      "---\nname: ui-alpha-skill\n---\n\nUpdated by another tool.\n",
      "utf8"
    );

    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByText("Agents refreshed", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Profiles", exact: true }).click();
    await page.getByRole("heading", { name: "UI OpenCode alpha" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Apply", exact: true }).click();

    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });
    await expect.poll(() => previewDialog.textContent()).toContain(
      "OpenCode skill changed outside AgentEnv"
    );
    expect(await previewDialog.textContent()).not.toContain(
      "Skill target already exists and is not AgentEnv-owned"
    );
    await previewDialog
      .getByLabel("I understand; back up and replace these changes")
      .check();
    await previewDialog.getByRole("button", { name: "Back up and replace" }).click();
    await previewDialog.waitFor({ state: "hidden" });
    await expect(readFile(join(targetSkillDir, "SKILL.md"), "utf8")).resolves.toContain(
      "alpha skill prompt"
    );
  }, 30_000);

  it("preserves Claude Code native settings when the Profile has no Advanced values", async () => {
    const { appDataRoot, claudeDir, page } = await launchApp({ includeClaudeTarget: true });
    const settingsPath = join(claudeDir, "settings.json");
    const nativeSettings = {
      permissions: { defaultMode: "bypassPermissions" },
      theme: "dark"
    };
    await writeJson(settingsPath, nativeSettings);
    await writeFile(
      join(claudeDir, "CLAUDE.md"),
      "# UI Claude clean\n\n- Keep native Claude Code settings Target-owned.\n",
      "utf8"
    );
    await mkdir(join(appDataRoot, "target-states"), { recursive: true });
    await writeJson(join(appDataRoot, "target-states", "claude-code.json"), {
      managedConfigKeys: ["permissions"],
      managedMcpNames: [],
      activeProfileId: "previous-claude-profile",
      managedResources: []
    });

    await selectProfile(page, "UI Claude clean");
    await selectTarget(page, "Claude Code");
    await applyActionButton(page, "Claude Code").click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });
    expect(await previewDialog.textContent()).not.toContain(settingsPath);
    expect(await previewDialog.textContent()).not.toContain("bypassPermissions");
    await previewDialog.getByRole("button", { name: "Apply profile" }).click();
    await previewDialog.waitFor({ state: "hidden" });

    await expect(readJson(settingsPath)).resolves.toEqual(nativeSettings);
    await expect(
      readJson<{ managedConfigKeys: string[] }>(
        join(appDataRoot, "target-states", "claude-code.json")
      )
    ).resolves.toMatchObject({ managedConfigKeys: [] });
  }, 30_000);

  it("backs up and replaces an unmanaged Claude Code Skill after explicit review", async () => {
    const { appDataRoot, claudeDir, page } = await launchApp({ includeClaudeTarget: true });
    const targetSkill = join(claudeDir, "skills", "bytedcli");
    await mkdir(targetSkill, { recursive: true });
    await writeFile(
      join(targetSkill, "SKILL.md"),
      "---\nname: bytedcli\ndescription: Existing Claude copy.\n---\n\n# Existing Claude copy\n",
      "utf8"
    );

    await selectProfile(page, "UI Claude clean");
    await selectTarget(page, "Claude Code");
    await applyActionButton(page, "Claude Code").click();

    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });
    await expect.poll(() => previewDialog.textContent()).toContain(
      "Existing unmanaged Skill will be replaced"
    );
    await expect.poll(() => previewDialog.textContent()).toContain(targetSkill);
    expect(await previewDialog.getByRole("button", { name: "Apply profile" }).isDisabled()).toBe(true);
    await previewDialog
      .getByLabel("I understand; back up and replace these changes")
      .check();
    await previewDialog.getByRole("button", { name: "Back up and replace" }).click();
    await previewDialog.waitFor({ state: "hidden" });

    await expect(readFile(join(targetSkill, "SKILL.md"), "utf8")).resolves.toContain(
      "Review code changes before applying them."
    );
    await expect(fileExists(`${targetSkill}.agentenv-owner.json`)).resolves.toBe(true);
    const backupIds = await readdir(join(appDataRoot, "backups"));
    const backupManifests = await Promise.all(
      backupIds.map(async (id) => {
        const manifestPath = join(appDataRoot, "backups", id, "manifest.json");
        return await fileExists(manifestPath)
          ? readJson<{ entries: Array<{ sourcePath: string; backupPath: string }> }>(manifestPath)
          : undefined;
      })
    );
    const entry = backupManifests
      .flatMap((manifest) => manifest?.entries ?? [])
      .find((candidate) => candidate.sourcePath === targetSkill);
    expect(entry).toBeTruthy();
    await expect(readFile(join(entry?.backupPath ?? "", "SKILL.md"), "utf8")).resolves.toContain(
      "# Existing Claude copy"
    );
  }, 30_000);

  it("shows polished skill row actions and update check feedback in the rendered app", async () => {
    const { page } = await launchApp();

    const sharedRow = page.getByRole("group", { name: "Library item shared-reviewer" });
    await sharedRow.waitFor({ state: "visible" });
    const [refreshIconClass, checkIconClass] = await Promise.all([
      page.getByRole("button", { name: "Refresh skills" }).locator("svg").getAttribute("class"),
      page.getByRole("button", { name: "Check updates" }).locator("svg").getAttribute("class")
    ]);
    expect(refreshIconClass).toContain("lucide-refresh-cw");
    expect(checkIconClass).toContain("lucide-search-check");
    expect(checkIconClass).not.toBe(refreshIconClass);
    const skillIconGeometry = await sharedRow.locator(".resource-avatar").evaluate((icon) => {
      const glyph = icon.querySelector<SVGElement>("svg")!;
      const iconBox = icon.getBoundingClientRect();
      const glyphBox = glyph.getBoundingClientRect();
      const resourceCellBox = icon.closest<HTMLElement>(".library-resource-cell")!.getBoundingClientRect();
      const rowBox = icon.closest<HTMLElement>(".library-table-row")!.getBoundingClientRect();
      return {
        iconSize: [iconBox.width, iconBox.height],
        glyphSize: [glyphBox.width, glyphBox.height],
        backgroundColor: getComputedStyle(icon).backgroundColor,
        centerDelta: [
          Math.abs(iconBox.left + iconBox.width / 2 - (glyphBox.left + glyphBox.width / 2)),
          Math.abs(iconBox.top + iconBox.height / 2 - (glyphBox.top + glyphBox.height / 2))
        ],
        identityCenterDelta: Math.abs(
          iconBox.top + iconBox.height / 2 - (resourceCellBox.top + resourceCellBox.height / 2)
        ),
        rowCenterDelta: Math.abs(
          iconBox.top + iconBox.height / 2 - (rowBox.top + rowBox.height / 2)
        )
      };
    });
    expect(skillIconGeometry.iconSize).toEqual([32, 32]);
    expect(skillIconGeometry.glyphSize).toEqual([18, 18]);
    expect(skillIconGeometry.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(skillIconGeometry.centerDelta.every((delta) => delta <= 0.5)).toBe(true);
    expect(skillIconGeometry.identityCenterDelta).toBeLessThanOrEqual(0.5);
    expect(skillIconGeometry.rowCenterDelta).toBeLessThanOrEqual(0.5);
    await sharedRow.getByRole("button", { name: "More actions for shared-reviewer" }).click();
    const popover = page.getByRole("menu", { name: "Actions for shared-reviewer" });
    await popover.waitFor({ state: "visible" });
    const checkUpdateItem = popover.getByRole("menuitem", {
      name: /Check update|Preview update/
    });
    await checkUpdateItem.waitFor({ state: "visible" });

    const popoverBox = await popover.boundingBox();
    const viewport = page.viewportSize();
    expect(popoverBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(popoverBox!.x).toBeGreaterThanOrEqual(0);
    expect(popoverBox!.y).toBeGreaterThanOrEqual(0);
    expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(viewport!.height);
    expect(popoverBox!.height).toBeGreaterThan(120);
    await expectTopmost(popover);

    await checkUpdateItem.click();
    await popover.waitFor({ state: "hidden" });
    await expect.poll(() => page.locator(".app-feedback").textContent()).toContain(
      "shared-reviewer source is current"
    );
    expect(
      await page.getByRole("dialog", { name: "Update preview for shared-reviewer" }).count()
    ).toBe(0);
    await page.getByRole("button", { name: "Check updates" }).click();
    await expect
      .poll(() => page.getByRole("status").textContent())
      .toMatch(/up to date|update.*available|failed/i);
  }, 30_000);

  it("removes a skill from the shared library through the rendered app", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    const cyclicSkill = join(opencodeDir, "skills", "web-testing");
    await mkdir(cyclicSkill, { recursive: true });
    await writeFile(join(cyclicSkill, "SKILL.md"), "# Unrelated cyclic skill\n", "utf8");
    await symlink(cyclicSkill, join(cyclicSkill, "web-testing"), "dir");

    const sharedRow = page.getByRole("group", { name: "Library item shared-reviewer" });
    await sharedRow.waitFor({ state: "visible" });
    await sharedRow.getByRole("button", { name: "More actions for shared-reviewer" }).click();
    await page.getByRole("menuitem", { name: /Remove from library/ }).click();

    const deleteDialog = page.getByRole("dialog", { name: "Delete library skill" });
    await deleteDialog.waitFor({ state: "visible" });
    await expect.poll(() => deleteDialog.textContent()).toContain("Remove Shared Reviewer from the shared library?");
    await deleteDialog.getByRole("button", { name: "Remove skill" }).click();

    await sharedRow.waitFor({ state: "hidden" });
    await expect
      .poll(() => page.getByRole("status").textContent())
      .toContain("Removed shared-reviewer");
    await expect
      .poll(() => page.getByRole("status").textContent())
      .toContain("No Agent installs were affected");
    await expect(fileExists(join(appDataRoot, "skills-library", "shared-reviewer"))).resolves.toBe(false);
    await expect(fileExists(join(cyclicSkill, "SKILL.md"))).resolves.toBe(true);
  }, 30_000);

  it("keeps menus, dialogs, and info tips inside the visible app window", async () => {
    const { page } = await launchApp();
    await page.setViewportSize({ width: 1180, height: 728 });

    await page.locator(".skill-description").first().hover();
    const descriptionTip = page
      .getByRole("tooltip")
      .filter({ hasText: "Shared review guidance" });
    await descriptionTip.waitFor({ state: "visible" });
    await expectInViewport(page, descriptionTip);
    await page.mouse.move(10, 10);
    await descriptionTip.waitFor({ state: "hidden" });

    await page.locator(".page-header .info-tip").first().hover();
    const headerTip = page.getByRole("tooltip");
    await headerTip.waitFor({ state: "visible" });
    await expectInViewport(page, headerTip);
    await page.mouse.move(10, 10);
    await headerTip.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Profiles" }).click();
    await page.getByRole("button", { name: "Select apply Agent" }).click();
    const targetMenu = page.getByRole("menu", { name: "Apply Agents" });
    await targetMenu.waitFor({ state: "visible" });
    await expectInViewport(page, targetMenu);
    await page.mouse.click(240, 120);
    await targetMenu.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "More profile actions" }).click();
    const actionsMenu = page.getByRole("menu", { name: "Profile actions" });
    await actionsMenu.waitFor({ state: "visible" });
    await expectInViewport(page, actionsMenu);
    await page.mouse.click(240, 120);
    await actionsMenu.waitFor({ state: "hidden" });

    await expandComposerSection(page, "Skills");
    await page.getByRole("button", { name: "Add library skill" }).click();
    const skillPicker = page.getByRole("dialog", { name: "Add library skills" });
    await skillPicker.waitFor({ state: "visible" });
    await expectInViewport(page, skillPicker);
    await page.keyboard.press("Escape");
    await skillPicker.waitFor({ state: "hidden" });

    await openSkillLibrary(page);
    const sharedRow = page.getByRole("group", { name: "Library item shared-reviewer" });
    await sharedRow.waitFor({ state: "visible" });
    await sharedRow.getByRole("button", { name: "More actions for shared-reviewer" }).click();
    const rowMenu = page.getByRole("menu", { name: "Actions for shared-reviewer" });
    await rowMenu.waitFor({ state: "visible" });
    await expectInViewport(page, rowMenu);
    await expectTopmost(rowMenu);
    await rowMenu.getByRole("menuitem", { name: "Update settings" }).click();
    const updateSettings = page.getByRole("dialog", {
      name: "Update settings for shared-reviewer"
    });
    await updateSettings.waitFor({ state: "visible" });
    await expectInViewport(page, updateSettings);
    await expectTopmost(updateSettings);
    await updateSettings.locator(".info-tip").hover();
    const rowTip = page.getByRole("tooltip");
    await rowTip.waitFor({ state: "visible" });
    await expectInViewport(page, rowTip);
  }, 30_000);

  it("keeps the Profiles workbench contained at the default viewport", async () => {
    const { appDataRoot, page } = await launchApp({ openCodeAlphaLibrarySkillCount: 8 });
    await page.setViewportSize({ width: 1180, height: 728 });
    await selectProfile(page, "UI OpenCode alpha");

    const header = page.locator(".profile-page-header");
    const workbench = page.locator(".profile-workbench");
    const profileIndex = page.locator(".profile-index");
    const profileList = page.locator(".profile-list");
    const editor = page.locator(".profile-editor-surface");
    const composer = page.getByRole("region", { name: "Profile composer" });
    const commitActions = page.getByRole("group", { name: "Selected profile actions" });

    await expectInViewport(page, header);
    await expectInViewport(page, workbench);

    const compactProfileGeometry = await page.evaluate(() => ({
      profileRows: [...document.querySelectorAll<HTMLElement>(".profile-row")].map(
        (row) => Math.round(row.getBoundingClientRect().height)
      ),
      composerRows: [...document.querySelectorAll<HTMLElement>(
        ".profile-composer-section__trigger"
      )].map((row) => Math.round(row.getBoundingClientRect().height)),
      composerTitleCount: document.querySelectorAll(".profile-composer__header").length
    }));
    expect(compactProfileGeometry.profileRows.every((height) => height <= 92)).toBe(true);
    expect(compactProfileGeometry.composerRows.every((height) => height <= 54)).toBe(true);
    expect(compactProfileGeometry.composerTitleCount).toBe(0);
    const profileObjectGeometry = await page.locator(".profile-row").first().evaluate((row) => {
      const icon = row.querySelector<HTMLElement>(".profile-row__icon")!;
      const content = row.querySelector<HTMLElement>(".profile-row__content")!;
      const iconBox = icon.getBoundingClientRect();
      const contentBox = content.getBoundingClientRect();
      return {
        iconTextGap: contentBox.left - iconBox.right,
        iconWidth: iconBox.width,
        headerTargetControls: document.querySelectorAll(
          ".profile-page-header .profile-target-workspace-control, .profile-page-header .profile-target-workspace-button"
        ).length
      };
    });
    expect(profileObjectGeometry.iconTextGap).toBeGreaterThanOrEqual(3);
    expect(profileObjectGeometry.iconTextGap).toBeLessThanOrEqual(5);
    expect(profileObjectGeometry.iconWidth).toBe(24);
    expect(profileObjectGeometry.headerTargetControls).toBe(0);

    const profileCommitGeometry = await commitActions.evaluate((group) => {
      const save = group.querySelector<HTMLElement>(".save-button")!;
      const apply = group.querySelector<HTMLElement>(".profile-apply-button")!;
      const target = group.querySelector<HTMLElement>(".profile-target-workspace-button")!;
      const boxes = [save, apply, target].map((item) => item.getBoundingClientRect());
      return {
        ordered: boxes[0].right < boxes[1].left && boxes[1].right < boxes[2].left,
        targetFits: target.scrollWidth <= target.clientWidth + 1
      };
    });
    expect(profileCommitGeometry).toEqual({ ordered: true, targetFits: true });

    const shellMetrics = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight
    }));
    expect(shellMetrics.documentWidth).toBe(shellMetrics.viewportWidth);
    expect(shellMetrics.documentHeight).toBe(shellMetrics.viewportHeight);

    const initialWorkbenchBox = await workbench.boundingBox();
    expect(initialWorkbenchBox).not.toBeNull();
    const defaultContainerMetrics = await page.locator(".app-shell--profiles .editor-panel").evaluate(
      (element) => ({
        containerName: getComputedStyle(element).containerName,
        workbenchColumns: getComputedStyle(
          element.querySelector<HTMLElement>(".profile-workbench")!
        ).gridTemplateColumns
      })
    );
    expect(defaultContainerMetrics.containerName).toBe("profile-workspace");
    expect(defaultContainerMetrics.workbenchColumns.startsWith("260px ")).toBe(true);

    const initialOverflow = await Promise.all(
      [profileIndex, profileList, editor].map((locator) =>
        locator.evaluate((element) => ({
          overflowY: getComputedStyle(element).overflowY,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight
        }))
      )
    );
    expect(initialOverflow[0].overflowY).toBe("hidden");
    expect(["auto", "scroll"]).toContain(initialOverflow[1].overflowY);
    expect(initialOverflow[2].overflowY).toBe("hidden");
    for (const metrics of initialOverflow) {
      expect(metrics.clientHeight).toBeGreaterThan(0);
    }

    await page.getByRole("button", { name: "Select apply Agent" }).click();
    const defaultViewportTargetMenu = page.getByRole("menu", { name: "Apply Agents" });
    await defaultViewportTargetMenu.waitFor({ state: "visible" });
    await expectInViewport(page, defaultViewportTargetMenu);
    await expectTopmost(defaultViewportTargetMenu);
    await page.keyboard.press("Escape");
    await defaultViewportTargetMenu.waitFor({ state: "hidden" });

    const skillsTrigger = composer.getByRole("button", { name: "Skills", exact: true });
    const advancedTrigger = composer.getByRole("button", { name: "Advanced", exact: true });
    expect(await skillsTrigger.getAttribute("aria-expanded")).toBe("false");

    await expandComposerSection(page, "Advanced");
    expect(await skillsTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(await advancedTrigger.getAttribute("aria-expanded")).toBe("true");
    await page.getByLabel("Disabled Skill Paths").fill(
      Array.from({ length: 24 }, (_, index) => `/tmp/legacy-skill-${index}`).join("\n")
    );
    const advancedPanel = page.locator(
      '[data-profile-composer-id="advanced"] .profile-composer-section__panel'
    );
    const advancedPanelMetrics = await advancedPanel.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(["auto", "scroll"]).toContain(advancedPanelMetrics.overflowY);
    expect(advancedPanelMetrics.clientHeight).toBeGreaterThanOrEqual(220);
    expect(advancedPanelMetrics.scrollHeight).toBeGreaterThan(
      advancedPanelMetrics.clientHeight
    );
    const advancedWorkbenchBox = await workbench.boundingBox();
    expect(advancedWorkbenchBox).toEqual(initialWorkbenchBox);
    const [advancedEditorBox, advancedComposerBox] = await Promise.all([
      editor.boundingBox(),
      composer.boundingBox()
    ]);
    expect(advancedEditorBox).not.toBeNull();
    expect(advancedComposerBox).not.toBeNull();
    expect(advancedComposerBox!.height).toBeGreaterThanOrEqual(300);
    const advancedEditorMetrics = await editor.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight
    }));
    expect(advancedEditorMetrics.overflowY).toBe("hidden");
    expect(advancedEditorMetrics.scrollHeight).toBe(advancedEditorMetrics.clientHeight);
    await expectInViewport(page, commitActions);
    const advancedDocumentMetrics = await page.evaluate(() => ({
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight
    }));
    expect(advancedDocumentMetrics.documentHeight).toBe(
      advancedDocumentMetrics.viewportHeight
    );

    await expandComposerSection(page, "Skills");
    expect(await skillsTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(await advancedTrigger.getAttribute("aria-expanded")).toBe("false");

    const expandedWorkbenchBox = await workbench.boundingBox();
    expect(expandedWorkbenchBox).toEqual(initialWorkbenchBox);
    const [editorBox, composerBox] = await Promise.all([
      editor.boundingBox(),
      composer.boundingBox()
    ]);
    expect(editorBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(composerBox!.height).toBeGreaterThanOrEqual(300);
    const expandedPanel = page.locator(
      '[data-profile-composer-id="skills"] .profile-composer-section__panel'
    );
    await expectInViewport(page, expandedPanel);
    await expectInViewport(page, skillsTrigger);
    await expectInViewport(
      page,
      page.getByRole("button", { name: "Check profile skill updates" })
    );
    await expectInViewport(page, commitActions);
    await expectInViewport(page, header);
    await expectInViewport(page, workbench);

    const expandedMetrics = await editor.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight
    }));
    const panelMetrics = await expandedPanel.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    const skillList = page.locator(".profile-skill-list");
    const skillListMetrics = await skillList.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(expandedMetrics.overflowY).toBe("hidden");
    expect(expandedMetrics.scrollHeight).toBe(expandedMetrics.clientHeight);
    expect(["auto", "scroll"]).toContain(panelMetrics.overflowY);
    expect(panelMetrics.clientHeight).toBeGreaterThanOrEqual(220);
    expect(panelMetrics.scrollHeight).toBe(panelMetrics.clientHeight);
    expect(["auto", "scroll"]).toContain(skillListMetrics.overflowY);
    expect(skillListMetrics.scrollHeight).toBeGreaterThan(skillListMetrics.clientHeight);
    expect(expandedMetrics.documentHeight).toBe(expandedMetrics.viewportHeight);

    await resizeAppWindow(page, 920, 620);
    await expectInViewport(page, page.locator(".profile-hero"));
    const minimumCommitGeometry = await commitActions.evaluate((group) => {
      const groupBox = group.getBoundingClientRect();
      const target = group.querySelector<HTMLElement>(".profile-target-workspace-button")!;
      const targetLabel = target.querySelector<HTMLElement>("span")!;
      const controls = [...group.children]
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .map((child) => child.getBoundingClientRect());
      return {
        contained: controls.every(
          (box) => box.left >= groupBox.left - 1 && box.right <= groupBox.right + 1
        ),
        separated: controls.every(
          (box, index) => index === 0 || box.left >= controls[index - 1].right
        ),
        targetLabelDisplay: getComputedStyle(targetLabel).display,
        targetLabel: targetLabel.textContent?.trim()
      };
    });
    expect(minimumCommitGeometry).toEqual({
      contained: true,
      separated: true,
      targetLabelDisplay: "block",
      targetLabel: "OpenCode"
    });
    await expectInViewport(page, skillsTrigger);
    await expectInViewport(
      page,
      page.getByRole("button", { name: "Check profile skill updates" })
    );
    const minimumPanelMetrics = await expandedPanel.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(minimumPanelMetrics.clientHeight).toBeGreaterThanOrEqual(180);
    expect(minimumPanelMetrics.scrollHeight).toBe(minimumPanelMetrics.clientHeight);
    expect(
      await skillList.evaluate((element) => element.scrollHeight > element.clientHeight)
    ).toBe(true);
    const skillActionGeometry = await page
      .locator(".profile-skill-row:not(.profile-skill-row--owned)")
      .first()
      .evaluate((row) => {
        const toggle = row.querySelector<HTMLElement>(".profile-skill-switch");
        const more = row.querySelector<HTMLElement>(".icon-action");
        const rowBox = row.getBoundingClientRect();
        const toggleBox = toggle?.getBoundingClientRect();
        const moreBox = more?.getBoundingClientRect();
        return {
          gap: toggleBox && moreBox ? moreBox.left - toggleBox.right : -1,
          rowRight: rowBox.right,
          toggleRight: toggleBox?.right ?? Number.POSITIVE_INFINITY,
          moreRight: moreBox?.right ?? Number.POSITIVE_INFINITY
        };
      });
    expect(skillActionGeometry.gap).toBeGreaterThanOrEqual(8);
    expect(skillActionGeometry.toggleRight).toBeLessThanOrEqual(skillActionGeometry.rowRight);
    expect(skillActionGeometry.moreRight).toBeLessThanOrEqual(skillActionGeometry.rowRight);
    const firstProfileSkill = page
      .locator(".profile-skill-row:not(.profile-skill-row--owned)")
      .first();
    const skillDetail = firstProfileSkill.getByLabel("Full skill detail layout-skill-1");
    await expect.poll(() => skillDetail.textContent()).toContain(
      join(appDataRoot, "skills-library", "layout-skill-1")
    );
    await firstProfileSkill
      .getByRole("button", { name: "More actions for profile skill layout-skill-1" })
      .click();
    const profileSkillMenu = page.getByRole("menu", { name: "Profile skill actions" });
    await expectInViewport(page, profileSkillMenu);
    const removeItemGeometry = await profileSkillMenu
      .getByRole("menuitem", { name: "Remove from profile" })
      .evaluate((item) => ({
        clientWidth: item.clientWidth,
        scrollWidth: item.scrollWidth,
        textClientWidth: item.querySelector("span")?.clientWidth ?? 0,
        textScrollWidth: item.querySelector("span")?.scrollWidth ?? 0
      }));
    expect(removeItemGeometry.scrollWidth).toBeLessThanOrEqual(removeItemGeometry.clientWidth);
    expect(removeItemGeometry.textScrollWidth).toBeLessThanOrEqual(
      removeItemGeometry.textClientWidth
    );
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Add library skill" }).click();
    const skillPicker = page.getByRole("dialog", { name: "Add library skills" });
    await skillPicker.waitFor({ state: "visible" });
    await expectInViewport(page, skillPicker);
    await skillPicker.getByLabel("Search library skills").fill("shared");
    await expect.poll(() => skillPicker.textContent()).toContain("Revision");
    const pickerGeometry = await skillPicker.evaluate((dialog) => {
      const search = dialog.querySelector<HTMLElement>(".resource-picker-search")?.getBoundingClientRect();
      const list = dialog.querySelector<HTMLElement>(".resource-picker-list")?.getBoundingClientRect();
      const footer = dialog.querySelector<HTMLElement>(".preview-actions")?.getBoundingClientRect();
      const box = dialog.getBoundingClientRect();
      return {
        searchBottom: search?.bottom ?? 0,
        listTop: list?.top ?? 0,
        listBottom: list?.bottom ?? 0,
        footerTop: footer?.top ?? 0,
        right: box.right,
        bottom: box.bottom
      };
    });
    expect(pickerGeometry.searchBottom).toBeLessThanOrEqual(pickerGeometry.listTop);
    expect(pickerGeometry.listBottom).toBeLessThanOrEqual(pickerGeometry.footerTop);
    expect(pickerGeometry.right).toBeLessThanOrEqual(920);
    expect(pickerGeometry.bottom).toBeLessThanOrEqual(620);
    await page.keyboard.press("Escape");
    await skillPicker.waitFor({ state: "hidden" });

    await expandComposerSection(page, "Instructions");
    const instructionEditorGeometry = await page
      .getByRole("textbox", { name: "AGENTS.md" })
      .evaluate((editor) => {
        const editorBox = editor.getBoundingClientRect();
        const panelBox = editor.closest<HTMLElement>(".profile-composer-section__panel")!
          .getBoundingClientRect();
        return {
          bottomGap: Math.round(panelBox.bottom - editorBox.bottom),
          height: Math.round(editorBox.height)
        };
      });
    expect(instructionEditorGeometry.height).toBeGreaterThanOrEqual(104);
    expect(instructionEditorGeometry.bottomGap).toBeLessThanOrEqual(24);

    await expandComposerSection(page, "MCPs");
    expect(await page.locator(".asset-editor-header--compact .section-title").count()).toBe(0);
    const profileMcpServers = page.getByRole("region", { name: "Profile MCP servers" });
    await profileMcpServers.waitFor({ state: "visible" });
    expect(await profileMcpServers.getByText("Inventory", { exact: true }).count()).toBe(0);
    expect(await profileMcpServers.getByText("Configured", { exact: true }).count()).toBe(0);
    expect(await profileMcpServers.locator(".resource-chip").count()).toBe(0);
    const mcpRowGeometry = await profileMcpServers.locator(".profile-mcp-row").evaluateAll(
      (rows) =>
        rows.map((row) => {
          const rowBox = row.getBoundingClientRect();
          const iconBox = row.querySelector<HTMLElement>(".profile-mcp-row__icon")!
            .getBoundingClientRect();
          return {
            contained: [...row.children].every((child) => {
              const childBox = child.getBoundingClientRect();
              return childBox.left >= rowBox.left - 1 && childBox.right <= rowBox.right + 1;
            }),
            height: Math.round(rowBox.height),
            iconHeight: Math.round(iconBox.height),
            iconWidth: Math.round(iconBox.width)
          };
        })
    );
    expect(mcpRowGeometry.length).toBeGreaterThan(0);
    expect(mcpRowGeometry.every((row) => row.contained)).toBe(true);
    expect(mcpRowGeometry.every((row) => row.height <= 54)).toBe(true);
    expect(mcpRowGeometry.every((row) => row.iconHeight === 30 && row.iconWidth === 30)).toBe(true);
    await expectInViewport(
      page,
      profileMcpServers.getByRole("button", { name: "Remove shared-docs from profile" })
    );
    const mcpHeaderHeight = await page
      .locator('[data-profile-composer-id="mcp"] .asset-editor-header--compact')
      .evaluate((header) => Math.round(header.getBoundingClientRect().height));
    expect(mcpHeaderHeight).toBeLessThanOrEqual(34);
    expect(await workbench.evaluate((element) => getComputedStyle(element).gridTemplateColumns))
      .toMatch(/^220px /);
  }, 30_000);

  it("keeps Profile columns aligned when a long name becomes selected", async () => {
    const longProfileName =
      "UI OpenCode beta for a deliberately long production review environment";
    const { page } = await launchApp({ openCodeBetaProfileName: longProfileName });
    await resizeAppWindow(page, 920, 620);
    await selectProfile(page, "UI OpenCode alpha");

    const longRow = page.getByRole("group", { name: `Profile ${longProfileName}` });
    const measureRows = () =>
      page.locator(".profile-row").evaluateAll((rows) =>
        rows.map((row) => {
          const icon = row.querySelector<HTMLElement>(".profile-row__icon")!;
          const content = row.querySelector<HTMLElement>(".profile-row__content")!;
          const name = row.querySelector<HTMLElement>(".profile-row__name")!;
          return {
            profileName: name.textContent,
            iconLeft: icon.getBoundingClientRect().left,
            contentLeft: content.getBoundingClientRect().left,
            nameLeft: name.getBoundingClientRect().left
          };
        })
      );
    const measureLongRow = () =>
      longRow.evaluate((row) => {
        const icon = row.querySelector<HTMLElement>(".profile-row__icon")!;
        const content = row.querySelector<HTMLElement>(".profile-row__content")!;
        const name = row.querySelector<HTMLElement>(".profile-row__name")!;
        return {
          iconLeft: icon.getBoundingClientRect().left,
          contentLeft: content.getBoundingClientRect().left,
          nameLeft: name.getBoundingClientRect().left,
          nameIsTruncated: name.scrollWidth > name.clientWidth
        };
      });
    const expectColumnsAligned = (rows: Awaited<ReturnType<typeof measureRows>>) => {
      const reference = rows[0];
      for (const row of rows) {
        expect(row.iconLeft - reference.iconLeft, row.profileName ?? undefined).toBeCloseTo(0, 1);
        expect(row.contentLeft - reference.contentLeft, row.profileName ?? undefined).toBeCloseTo(0, 1);
        expect(row.nameLeft - reference.nameLeft, row.profileName ?? undefined).toBeCloseTo(0, 1);
      }
    };

    const before = await measureLongRow();
    expect(before.nameIsTruncated).toBe(true);
    expectColumnsAligned(await measureRows());

    await longRow.locator(".profile-row__content").click();
    await page.getByRole("heading", { name: longProfileName }).waitFor({ state: "visible" });

    const after = await measureLongRow();
    expect(after.nameIsTruncated).toBe(true);
    expect(after.iconLeft).toBeCloseTo(before.iconLeft, 1);
    expect(after.contentLeft).toBeCloseTo(before.contentLeft, 1);
    expect(after.nameLeft).toBeCloseTo(before.nameLeft, 1);
    expectColumnsAligned(await measureRows());
  }, 30_000);

  it("keeps Library chrome fixed while only the long Skill list scrolls", async () => {
    const { page } = await launchApp({ openCodeAlphaLibrarySkillCount: 18 });
    await resizeAppWindow(page, 920, 620);
    await openSkillLibrary(page);

    const header = page.locator(".library-page-header");
    const tableBody = page.locator(".skill-library-panel .library-table__body");
    const initialHeaderBox = await header.boundingBox();
    const metrics = await tableBody.evaluate((body) => ({
      clientHeight: body.clientHeight,
      overflowX: getComputedStyle(body).overflowX,
      overflowY: getComputedStyle(body).overflowY,
      scrollHeight: body.scrollHeight
    }));
    expect(metrics.overflowX).toBe("hidden");
    expect(["auto", "scroll"]).toContain(metrics.overflowY);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    await tableBody.evaluate((body) => {
      body.scrollTop = 160;
    });
    await expect.poll(() => tableBody.evaluate((body) => body.scrollTop)).toBeGreaterThan(0);
    expect(await header.boundingBox()).toEqual(initialHeaderBox);
    const shellScroll = await page.evaluate(() => ({
      document: document.documentElement.scrollTop,
      editor: document.querySelector<HTMLElement>(".editor-panel")?.scrollTop ?? -1,
      shell: document.querySelector<HTMLElement>(".app-shell")?.scrollTop ?? -1
    }));
    expect(shellScroll).toEqual({ document: 0, editor: 0, shell: 0 });
  }, 30_000);

  it("keeps core management actions usable at the minimum supported viewport", async () => {
    const { page } = await launchApp();
    await resizeAppWindow(page, 1180, 728);
    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Advanced");
    await page.getByLabel("OpenCode settings (opencode.jsonc)").fill("{");
    await saveProfile(page);
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    await expect
      .poll(() => page.getByRole("button", { name: "Open Advanced" }).isVisible())
      .toBe(true);

    const profileTitle = page.locator(".profile-hero__title");
    const commitActions = page.getByRole("group", { name: "Selected profile actions" });
    const saveButton = commitActions.getByRole("button", { name: "Save" });
    const moreButton = commitActions.getByRole("button", { name: "More profile actions" });
    const applyControl = page.locator(".profile-apply-control");
    const actionStatus = page.getByRole("status", { name: "Profile readiness" });
    const expectCommitActionsToFit = async () => {
      for (const locator of [profileTitle, commitActions, saveButton, applyControl, moreButton, actionStatus]) {
        await expectInViewport(page, locator);
      }
      expect(await page.locator(".profile-readiness-strip").count()).toBe(0);

      const [titleBox, applyBox, saveBox, applyButtonBox] = await Promise.all([
        profileTitle.boundingBox(),
        applyControl.boundingBox(),
        saveButton.boundingBox(),
        commitActions.locator(".profile-apply-button").boundingBox()
      ]);
      expect(titleBox).not.toBeNull();
      expect(applyBox).not.toBeNull();
      expect(saveBox).not.toBeNull();
      expect(applyButtonBox).not.toBeNull();
      const titleOverlapsApply = !(
        titleBox!.x + titleBox!.width <= applyBox!.x ||
        applyBox!.x + applyBox!.width <= titleBox!.x ||
        titleBox!.y + titleBox!.height <= applyBox!.y ||
        applyBox!.y + applyBox!.height <= titleBox!.y
      );
      expect(titleOverlapsApply).toBe(false);
      expect(applyButtonBox!.x - (saveBox!.x + saveBox!.width)).toBeLessThanOrEqual(10);
      expect(Math.abs(saveBox!.y - applyButtonBox!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(saveBox!.height - applyButtonBox!.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(saveBox!.width - applyButtonBox!.width)).toBeLessThanOrEqual(1);
      expect(Math.round(saveBox!.height)).toBe(34);
      expect(Math.round(saveBox!.width)).toBe((page.viewportSize()?.width ?? 0) <= 1050 ? 96 : 104);

      const controlsFitText = await commitActions.locator("button").evaluateAll((buttons) =>
        buttons.every((button) => {
          const style = getComputedStyle(button);
          const lineHeight = Number.parseFloat(style.lineHeight);
          const verticalPadding =
            Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
          return lineHeight + verticalPadding <= button.clientHeight + 1;
        })
      );
      expect(controlsFitText).toBe(true);

      const statusGeometry = await page.locator(".profile-action-status").evaluate((status) => {
        const copy = status.querySelector<HTMLElement>(".profile-action-status__copy");
        const remediation = status.querySelector<HTMLElement>(".profile-action-status__action");
        const statusBox = status.getBoundingClientRect();
        const actionBox = remediation?.getBoundingClientRect();
        const copyBox = copy?.getBoundingClientRect();
        return {
          actionFits:
            !actionBox ||
            (actionBox.left >= statusBox.left &&
              actionBox.right <= statusBox.right &&
              actionBox.top >= statusBox.top &&
              actionBox.bottom <= statusBox.bottom),
          actionTextFits: !remediation || remediation.scrollWidth <= remediation.clientWidth,
          copyDoesNotOverlapAction:
            !actionBox || !copyBox || copyBox.right <= actionBox.left + 1
        };
      });
      expect(statusGeometry).toEqual({
        actionFits: true,
        actionTextFits: true,
        copyDoesNotOverlapAction: true
      });
      expect(await page.getByRole("button", { name: "Open Advanced" }).textContent()).toContain(
        "Open Advanced"
      );

      const profileGeometry = await page.locator(".profile-row.is-active").evaluate((row) => {
        const icon = row.querySelector<HTMLElement>(".profile-row__icon");
        const content = row.querySelector<HTMLElement>(".profile-row__content");
        const description = row.querySelector<HTMLElement>("small");
        const stats = row.querySelector<HTMLElement>(".profile-row__stats");
        const rowBox = row.getBoundingClientRect();
        const iconBox = icon?.getBoundingClientRect();
        const contentBox = content?.getBoundingClientRect();
        return {
          childrenFit:
            Boolean(iconBox && contentBox) &&
            iconBox!.top >= rowBox.top &&
            iconBox!.bottom <= rowBox.bottom &&
            contentBox!.top >= rowBox.top &&
            contentBox!.bottom <= rowBox.bottom,
          descriptionDisplay: description ? getComputedStyle(description).display : "missing",
          gap: iconBox && contentBox ? contentBox.left - iconBox.right : Number.NaN,
          iconHeight: iconBox?.height ?? 0,
          rowHeight: rowBox.height,
          statsOverflow: stats ? stats.scrollWidth - stats.clientWidth : Number.POSITIVE_INFINITY
        };
      });
      expect(profileGeometry.childrenFit).toBe(true);
      expect(profileGeometry.descriptionDisplay).not.toBe("none");
      expect(profileGeometry.iconHeight).toBeLessThanOrEqual(30);
      expect(profileGeometry.rowHeight).toBeLessThanOrEqual(92);
      expect(profileGeometry.gap).toBeGreaterThanOrEqual(3);
      expect(profileGeometry.gap).toBeLessThanOrEqual(5);
      expect(profileGeometry.statsOverflow).toBeLessThanOrEqual(1);

      const heroContent = await page.locator(".profile-hero").evaluate((hero) => ({
        description: getComputedStyle(
          hero.querySelector<HTMLElement>(".profile-description")!
        ).display,
        meta: getComputedStyle(hero.querySelector<HTMLElement>(".profile-hero__meta")!).display
      }));
      expect(heroContent.description).not.toBe("none");
      expect(heroContent.meta).not.toBe("none");
    };

    await expectCommitActionsToFit();
    await resizeAppWindow(page, 920, 620);
    for (const locator of [
      page.locator(".profile-page-header"),
      page.locator(".profile-workbench")
    ]) {
      await expectInViewport(page, locator);
    }
    await expectCommitActionsToFit();
    const profileContainment = await page.evaluate(() => {
      const overflowingComposerChildren = [...document.querySelectorAll<HTMLElement>(
        ".profile-composer-section__trigger"
      )].flatMap((trigger, triggerIndex) => {
        const box = trigger.getBoundingClientRect();
        return [...trigger.children].flatMap((child) => {
          if (getComputedStyle(child).display === "none") {
            return [];
          }
          const childBox = child.getBoundingClientRect();
          return childBox.top < box.top - 1 || childBox.bottom > box.bottom + 1
            ? [`${triggerIndex}:${(child as HTMLElement).className}`]
            : [];
        });
      });
      return {
        overflowingComposerChildren,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth
      };
    });
    expect(profileContainment.documentWidth).toBe(profileContainment.viewportWidth);
    expect(profileContainment.overflowingComposerChildren).toEqual([]);
    expect(
      await page.locator(".profile-composer-section__trigger").evaluateAll((triggers) =>
        triggers.every((trigger) => trigger.getBoundingClientRect().height <= 54)
      )
    ).toBe(true);
    await moreButton.click();
    const profileActionsMenu = page.getByRole("menu", { name: "Profile actions" });
    await expectInViewport(page, profileActionsMenu);
    expect(
      await profileActionsMenu.evaluate((menu) => {
        const box = menu.getBoundingClientRect();
        const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + 8);
        return Boolean(topmost && menu.contains(topmost));
      })
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByRole("menu", { name: "Profile actions" }).count()).toBe(0);
    expect(await moreButton.evaluate((element) => document.activeElement === element)).toBe(true);

    await selectTarget(page, "Codex");
    const profileList = page.getByRole("complementary", { name: "Profile list" });
    await profileList.getByRole("button", { name: /UI Codex alpha/ }).waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Agents" }).click();
    for (const targetName of ["OpenCode", "Claude Code", "Codex"]) {
      await expectInViewport(page, page.getByRole("article", { name: `Agent ${targetName}` }));
    }
    const openCodeTarget = page.getByRole("article", { name: "Agent OpenCode" });
    const claudeTarget = page.getByRole("article", { name: "Agent Claude Code" });
    await expect
      .poll(() =>
        openCodeTarget.getByRole("button", { name: "Open OpenCode in Profiles" }).textContent()
      )
      .toContain("Choose Profile");
    await expect
      .poll(() =>
        claudeTarget
          .getByRole("button", { name: "Open Claude Code in Profiles" })
          .textContent()
      )
      .toContain("Choose Profile");
    const targetPeerActions = await Promise.all(
      [
        openCodeTarget.getByRole("button", { name: "Create profile from OpenCode" }),
        openCodeTarget.getByRole("button", { name: "Open OpenCode in Profiles" })
      ].map((button) =>
        button.evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          border: getComputedStyle(element).borderColor,
          color: getComputedStyle(element).color,
          height: Math.round(element.getBoundingClientRect().height)
        }))
      )
    );
    expect(targetPeerActions[0]).toMatchObject({
      background: "rgba(0, 0, 0, 0)",
      border: "rgba(0, 0, 0, 0)",
      height: 30
    });
    expect(targetPeerActions[1]).toMatchObject({
      color: "rgb(29, 29, 31)",
      height: 30
    });
    expect(targetPeerActions[1].background).not.toBe(targetPeerActions[0].background);
    expect(targetPeerActions[1].border).not.toBe(targetPeerActions[0].border);
    await expectInViewport(page, page.getByRole("button", { name: /Recovery/ }));
    expect(await page.getByRole("dialog", { name: "Recovery" }).count()).toBe(0);

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight
    }));
    expect(dimensions.documentWidth).toBe(dimensions.viewportWidth);
    expect(dimensions.documentHeight).toBe(dimensions.viewportHeight);
  }, 30_000);

  it("keeps global chrome and page control scale stable across primary workspaces", async () => {
    const { page } = await launchApp();
    const navigation = page.getByRole("complementary", { name: "Global navigation" });
    const skillsButton = navigation.getByRole("button", { name: "Skills", exact: true });
    const profilesButton = navigation.getByRole("button", { name: "Profiles", exact: true });

    const readGeometry = async (headingName: string, actionName: string) => {
      const heading = page.getByRole("heading", { name: headingName, exact: true });
      const action = page.getByRole("button", { name: actionName, exact: true });
      await heading.waitFor({ state: "visible" });
      const headingElement = await heading.elementHandle();
      const actionElement = await action.elementHandle();
      if (!headingElement || !actionElement) {
        throw new Error(`Unable to measure ${headingName}`);
      }
      return page.evaluate(
        ({ headingElement, actionElement }) => {
          const rect = (element: Element | null) => {
            const box = element?.getBoundingClientRect();
            return box
              ? {
                  height: Math.round(box.height),
                  width: Math.round(box.width),
                  x: Math.round(box.x),
                  y: Math.round(box.y)
                }
              : undefined;
          };
          const editor = document.querySelector(".editor-panel");
          const editorStyle = editor ? getComputedStyle(editor) : undefined;
          const headingStyle = getComputedStyle(headingElement);
          return {
            action: rect(actionElement),
            brand: rect(document.querySelector(".brand-lockup")),
            editorPadding: editorStyle
              ? [
                  editorStyle.paddingTop,
                  editorStyle.paddingRight,
                  editorStyle.paddingBottom,
                  editorStyle.paddingLeft
                ]
              : [],
            heading: {
              ...rect(headingElement),
              fontSize: headingStyle.fontSize,
              lineHeight: headingStyle.lineHeight
            },
            navigation: [...document.querySelectorAll(".workspace-button")].map(rect),
            sidebar: rect(document.querySelector(".global-sidebar")),
            status: rect(document.querySelector(".system-status-card"))
          };
        },
        {
          actionElement,
          headingElement
        }
      );
    };

    for (const viewport of [
      { width: 1180, height: 728 },
      { width: 920, height: 620 }
    ]) {
      await page.setViewportSize(viewport);
      await skillsButton.click();
      const skillsGeometry = await readGeometry("Skills", "Import skills");

      const workspaces = [
        { button: "MCPs", heading: "MCPs", action: "Add MCP" },
        { button: "Profiles", heading: "Profiles", action: "New Profile" },
        { button: "Agents", heading: "Agents", action: "Refresh" },
        { button: "Settings", heading: "Settings", action: "Sign in with GitHub" }
      ];
      for (const workspace of workspaces) {
        await navigation.getByRole("button", { name: workspace.button, exact: true }).click();
        const workspaceGeometry = await readGeometry(workspace.heading, workspace.action);

        expect(workspaceGeometry.brand).toEqual(skillsGeometry.brand);
        expect(workspaceGeometry.navigation).toHaveLength(skillsGeometry.navigation.length);
        workspaceGeometry.navigation.forEach((workspaceRow, index) => {
        const skillRow = skillsGeometry.navigation[index];
          expect(workspaceRow?.height).toBe(skillRow?.height);
          expect(workspaceRow?.width).toBe(skillRow?.width);
          expect(Math.abs((workspaceRow?.x ?? 0) - (skillRow?.x ?? 0))).toBeLessThanOrEqual(1);
          expect(Math.abs((workspaceRow?.y ?? 0) - (skillRow?.y ?? 0))).toBeLessThanOrEqual(1);
        });
        expect(workspaceGeometry.sidebar).toEqual(skillsGeometry.sidebar);
        expect(workspaceGeometry.status).toEqual(skillsGeometry.status);
        expect(workspaceGeometry.editorPadding).toEqual(skillsGeometry.editorPadding);
        expect({
          fontSize: workspaceGeometry.heading.fontSize,
          height: workspaceGeometry.heading.height,
          lineHeight: workspaceGeometry.heading.lineHeight,
          x: workspaceGeometry.heading.x
        }).toEqual({
          fontSize: skillsGeometry.heading.fontSize,
          height: skillsGeometry.heading.height,
          lineHeight: skillsGeometry.heading.lineHeight,
          x: skillsGeometry.heading.x
        });
        expect(workspaceGeometry.action?.height).toBe(skillsGeometry.action?.height);
        if (workspace.button === "Settings") {
          const actionGeometry = await page.locator(".settings-data-actions button").evaluateAll(
            (buttons) =>
              buttons.map((button) => {
                const box = button.getBoundingClientRect();
                return {
                  height: Math.round(box.height),
                  right: Math.round(box.right),
                  y: Math.round(box.y)
                };
              })
          );
          const dataSectionRight = await page
            .locator('[aria-labelledby="agentenv-data-heading"]')
            .evaluate((element) => Math.round(element.getBoundingClientRect().right));
          expect(new Set(actionGeometry.map((box) => box.height)).size).toBe(1);
          const actionGroups = page.locator('[aria-labelledby="agentenv-data-heading"] .settings-data-actions');
          for (let index = 0; index < await actionGroups.count(); index += 1) {
            const groupRows = await actionGroups.nth(index).locator("button").evaluateAll((buttons) =>
              buttons.map((button) => Math.round(button.getBoundingClientRect().y))
            );
            expect(new Set(groupRows).size).toBe(1);
          }
          expect(Math.max(...actionGeometry.map((box) => box.right))).toBeLessThanOrEqual(
            dataSectionRight
          );
        }
      }
    }

    const profilePositions = await Promise.all([skillsButton.boundingBox(), profilesButton.boundingBox()]);
    expect(profilePositions[0]!.y).toBeLessThan(profilePositions[1]!.y);

    await navigation.getByRole("button", { name: "Agents", exact: true }).click();
    expect(await page.getByRole("complementary", { name: "Workspace summary" }).count()).toBe(0);
    await navigation.getByRole("button", { name: "Settings", exact: true }).click();
    expect(await page.getByRole("complementary", { name: "Workspace summary" }).count()).toBe(0);

    const metrics = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    }));
    expect(metrics.documentWidth).toBe(metrics.viewportWidth);
  }, 30_000);

  it("paints the complete desktop surface on short and long workspaces", async () => {
    const { page } = await launchApp();
    await page.setViewportSize({ width: 920, height: 620 });

    for (const workspace of ["Skills", "MCPs", "Profiles", "Agents", "Settings"]) {
      await page.getByRole("button", { name: workspace, exact: true }).click();
      await page.evaluate(() => window.scrollTo({ top: 240, left: 120 }));
      await page.locator(".app-shell").evaluate((shell) => {
        shell.scrollTo({ top: 240, left: 120 });
      });
      const paint = await page.evaluate(() => {
        const root = document.getElementById("root");
        const shell = document.querySelector(".app-shell");
        const rootRect = root?.getBoundingClientRect();
        const shellRect = shell?.getBoundingClientRect();
        return {
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          rootBackground: root ? getComputedStyle(root).backgroundColor : "missing",
          rootHeight: rootRect?.height ?? 0,
          rootWidth: rootRect?.width ?? 0,
          shellHeight: shellRect?.height ?? 0,
          shellWidth: shellRect?.width ?? 0,
          shellScrollLeft: shell?.scrollLeft ?? -1,
          shellScrollTop: shell?.scrollTop ?? -1,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth
        };
      });

      expect(paint.bodyBackground).toBe("rgb(246, 248, 252)");
      expect(paint.rootBackground).toBe("rgb(246, 248, 252)");
      expect(paint.rootWidth).toBe(paint.viewportWidth);
      expect(paint.rootHeight).toBe(paint.viewportHeight);
      expect(paint.shellWidth).toBe(paint.viewportWidth);
      expect(paint.shellHeight).toBe(paint.viewportHeight);
      expect(paint.shellScrollLeft).toBe(0);
      expect(paint.shellScrollTop).toBe(0);
      expect(paint.scrollX).toBe(0);
      expect(paint.scrollY).toBe(0);
    }
  }, 30_000);

  it("opens the apply preview at its summary instead of scrolling to the footer", async () => {
    const { page } = await launchApp({ openCodeAlphaLibrarySkillCount: 8 });
    await resizeAppWindow(page, 1180, 728);
    await selectProfile(page, "UI OpenCode alpha");

    await applyActionButton(page, "OpenCode").click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });

    expect(await previewDialog.evaluate((element) => element.scrollTop)).toBe(0);
    await expectInViewport(page, previewDialog.locator(".preview-header"));
    await expectInViewport(page, previewDialog.locator(".preview-actions"));
    const summaryGrid = previewDialog.locator(".preview-summary-grid");
    const resourcePlan = previewDialog.getByRole("region", { name: "Resource changes" });
    const resourceList = resourcePlan.getByRole("list", {
      name: "Scrollable resource changes"
    });
    const resourceRows = resourceList.locator("article");
    const resourceCount = await resourceRows.count();
    expect(resourceCount).toBeGreaterThan(4);
    await expect.poll(() => resourcePlan.locator("header").textContent())
      .toContain(`${resourceCount} total`);

    const resourceGeometry = await resourceList.evaluate((list) => {
      const listBox = list.getBoundingClientRect();
      const visibleRows = [...list.querySelectorAll("article")].filter((row) => {
        const rowBox = row.getBoundingClientRect();
        return rowBox.top >= listBox.top - 1 && rowBox.bottom <= listBox.bottom + 1;
      }).length;
      return {
        visibleRows,
        listHeight: listBox.height,
        planHeight: list.closest(".preview-resource-plan")?.getBoundingClientRect().height,
        dialogHeight: list.closest(".preview-dialog")?.getBoundingClientRect().height,
        diffHeight: list.closest(".preview-dialog")?.querySelector(".diff-list")?.getBoundingClientRect().height
      };
    });
    expect(resourceGeometry.visibleRows, JSON.stringify(resourceGeometry)).toBeGreaterThanOrEqual(3);
    await resourcePlan.locator(".preview-resource-plan__more").waitFor({ state: "visible" });
    await resourceList.evaluate((list) => {
      list.scrollTop = list.scrollHeight;
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await resourcePlan.locator(".preview-resource-plan__more").waitFor({ state: "hidden" });
    await resourceList.evaluate((list) => {
      list.scrollTop = 0;
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await resourcePlan.locator(".preview-resource-plan__more").waitFor({ state: "visible" });
    await expect.poll(() => summaryGrid.evaluate((element) => getComputedStyle(element).alignItems))
      .toBe("start");
    const summaryCardAlignment = await previewDialog
      .locator(".preview-summary-card")
      .evaluateAll((cards) => cards.map((card) => getComputedStyle(card).alignSelf));
    expect(summaryCardAlignment.length).toBeGreaterThan(0);
    expect(summaryCardAlignment.every((alignment) => alignment === "start")).toBe(true);
    const configurationReview = previewDialog.getByRole("button", {
      name: /Review \d+ files?/
    });
    await configurationReview.click();
    const firstConfigurationChange = previewDialog.locator(".diff-list details").first();
    await expect.poll(() => firstConfigurationChange.getAttribute("open")).not.toBeNull();
    await expect.poll(() => firstConfigurationChange.locator("summary").evaluate(
      (summary) => document.activeElement === summary
    )).toBe(true);
    await expectInViewport(page, firstConfigurationChange.locator("summary"));
    await previewDialog.evaluate((dialog) => { dialog.scrollTop = 0; });

    const expectPreviewGeometry = async () => {
      const cancelButton = previewDialog.getByRole("button", { name: "Cancel" });
      const confirmButton = previewDialog.getByRole("button", { name: "Apply profile" });
      const [cancelBox, confirmBox] = await Promise.all([
        cancelButton.boundingBox(),
        confirmButton.boundingBox()
      ]);
      expect(cancelBox).not.toBeNull();
      expect(confirmBox).not.toBeNull();
      expect(Math.round(cancelBox!.height)).toBe(40);
      expect(Math.abs(cancelBox!.height - confirmBox!.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(cancelBox!.width - confirmBox!.width)).toBeLessThanOrEqual(1);
      await expectInViewport(page, previewDialog.locator(".preview-header"));
      await expectInViewport(page, previewDialog.locator(".preview-actions"));

      const geometry = await previewDialog.evaluate((dialog) => {
        const textFits = (element: Element) => {
          const style = getComputedStyle(element);
          const lineHeight = Number.parseFloat(style.lineHeight);
          const verticalPadding =
            Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
          return lineHeight + verticalPadding <= (element as HTMLElement).clientHeight + 1;
        };
        const resourceRows = [...dialog.querySelectorAll<HTMLElement>(".preview-resource-plan article")];
        return {
          buttonsFitText: [...dialog.querySelectorAll(".preview-actions button")].every(textFits),
          dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
          resourceRows: resourceRows.map((row) => row.getBoundingClientRect().height),
          summaryCardsFit: [...dialog.querySelectorAll<HTMLElement>(".preview-summary-card")].every(
            (card) => {
              const box = card.getBoundingClientRect();
              return (
                card.scrollWidth <= card.clientWidth + 1 &&
                [...card.children].every((child) => {
                  const childBox = child.getBoundingClientRect();
                  return (
                    childBox.left >= box.left &&
                    childBox.right <= box.right &&
                    childBox.top >= box.top &&
                    childBox.bottom <= box.bottom
                  );
                })
              );
            }
          )
        };
      });
      expect(geometry.buttonsFitText).toBe(true);
      expect(geometry.dialogOverflow).toBeLessThanOrEqual(1);
      expect(geometry.resourceRows.length).toBeGreaterThan(0);
      expect(geometry.resourceRows.every((height) => height >= 49)).toBe(true);
      expect(geometry.summaryCardsFit).toBe(true);
    };

    await expectPreviewGeometry();
    await resizeAppWindow(page, 920, 620);
    await expectPreviewGeometry();
  }, 30_000);

  it("lays out Agents as one ordered management list with on-demand diagnostics", async () => {
    const { page } = await launchApp();
    await page.setViewportSize({ width: 1180, height: 728 });
    await page.getByRole("button", { name: "Agents", exact: true }).click();

    const openCodeCard = page.getByRole("article", { name: "Agent OpenCode" });
    const claudeCard = page.getByRole("article", { name: "Agent Claude Code" });
    const codexCard = page.getByRole("article", { name: "Agent Codex" });
    const [openCodeBox, claudeBox, codexBox] = await Promise.all([
      openCodeCard.boundingBox(),
      claudeCard.boundingBox(),
      codexCard.boundingBox()
    ]);
    expect(openCodeBox).not.toBeNull();
    expect(claudeBox).not.toBeNull();
    expect(codexBox).not.toBeNull();
    expect(Math.abs(claudeBox!.x - openCodeBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(codexBox!.x - openCodeBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(claudeBox!.width - openCodeBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(codexBox!.width - openCodeBox!.width)).toBeLessThanOrEqual(1);
    expect(claudeBox!.y).toBeGreaterThanOrEqual(openCodeBox!.y + openCodeBox!.height);
    expect(codexBox!.y).toBeGreaterThanOrEqual(claudeBox!.y + claudeBox!.height);

    const diagnostics = openCodeCard.getByRole("button", {
      name: "Show OpenCode diagnostics"
    });
    await diagnostics.click();
    await openCodeCard.getByRole("region", { name: "OpenCode diagnostics" }).waitFor({
      state: "visible"
    });
    const [expandedOpenCodeBox, shiftedClaudeBox] = await Promise.all([
      openCodeCard.boundingBox(),
      claudeCard.boundingBox()
    ]);
    expect(expandedOpenCodeBox).not.toBeNull();
    expect(shiftedClaudeBox).not.toBeNull();
    expect(shiftedClaudeBox!.y).toBeGreaterThan(claudeBox!.y);
    expect(
      shiftedClaudeBox!.y - (expandedOpenCodeBox!.y + expandedOpenCodeBox!.height)
    ).toBeGreaterThanOrEqual(0);
    expect(
      shiftedClaudeBox!.y - (expandedOpenCodeBox!.y + expandedOpenCodeBox!.height)
    ).toBeLessThanOrEqual(13);

    await resizeAppWindow(page, 920, 620);
    const [compactOpenCodeBox, compactClaudeBox] = await Promise.all([
      openCodeCard.boundingBox(),
      claudeCard.boundingBox()
    ]);
    expect(compactOpenCodeBox).not.toBeNull();
    expect(compactClaudeBox).not.toBeNull();
    expect(compactClaudeBox!.y).toBeGreaterThan(compactOpenCodeBox!.y);

    await openCodeCard
      .getByRole("button", { name: "Open OpenCode in Profiles" })
      .waitFor({ state: "visible" });
    await expect
      .poll(() => openCodeCard.getByRole("button", { name: "Create profile from OpenCode" }).getAttribute("class"))
      .toContain("secondary-action");
    await expect
      .poll(() => openCodeCard.getByRole("button", { name: "Open OpenCode in Profiles" }).getAttribute("class"))
      .toContain("secondary-action");
    expect(
      await claudeCard.getByRole("button", { name: "Show Claude Code diagnostics" }).getAttribute("aria-expanded")
    ).toBe("false");
    const expandedHeights = await Promise.all([
      openCodeCard.evaluate((element) => Math.round(element.getBoundingClientRect().height)),
      claudeCard.evaluate((element) => Math.round(element.getBoundingClientRect().height))
    ]);
    expect(expandedHeights[0]).toBeGreaterThan(expandedHeights[1]);
    const diagnosticsAlignment = await openCodeCard.evaluate((card) => {
      const toggle = card.querySelector<HTMLElement>(".target-diagnostics-toggle")!;
      const state = card.querySelector<HTMLElement>(".target-state-grid > span")!;
      return Math.abs(toggle.getBoundingClientRect().left - state.getBoundingClientRect().left);
    });
    expect(diagnosticsAlignment).toBeLessThanOrEqual(4);
    expect(
      await openCodeCard
        .getByRole("region", { name: "OpenCode diagnostics" })
        .evaluate((region) => region.getBoundingClientRect().height)
    ).toBeLessThanOrEqual(250);

    await claudeCard.getByRole("button", { name: "Show Claude Code diagnostics" }).click();
    await claudeCard.getByRole("region", { name: "Claude Code diagnostics" }).waitFor({
      state: "visible"
    });
    expect(await openCodeCard.getByRole("region", { name: "OpenCode diagnostics" }).count()).toBe(0);

    expect(await page.getByRole("button", { name: "Activity", exact: true }).count()).toBe(0);
    const recoveryTrigger = page.getByRole("button", { name: /Recovery/ });
    await recoveryTrigger.click();
    const recoveryDialog = page.getByRole("dialog", { name: "Recovery" });
    await recoveryDialog.waitFor({ state: "visible" });
    await expectInViewport(page, recoveryDialog);
    await page.keyboard.press("Escape");
    await recoveryDialog.waitFor({ state: "hidden" });
    expect(await recoveryTrigger.evaluate((element) => document.activeElement === element)).toBe(true);

    await codexCard.getByRole("button", { name: "Open Codex in Profiles" }).click();
    await page.getByRole("region", { name: "Profiles", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Apply", exact: true }).waitFor({ state: "visible" });
  }, 30_000);

  it("stops managing OpenCode while keeping deployed files and clearing ownership", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    const deployedInstructions = await readFile(join(opencodeDir, "AGENTS.md"), "utf8");

    await page.getByRole("button", { name: "Agents", exact: true }).click();
    const openCodeCard = page.getByRole("article", { name: "Agent OpenCode" });
    await expect
      .poll(() => openCodeCard.getByRole("button", { name: "Open OpenCode in Profiles" }).getAttribute("class"))
      .toContain("secondary-action");
    await expect
      .poll(() => openCodeCard.getByRole("button", { name: "Create profile from OpenCode" }).getAttribute("class"))
      .toContain("secondary-action");
    await openCodeCard.getByRole("button", { name: "Show OpenCode diagnostics" }).click();
    await openCodeCard.getByRole("button", { name: "Stop managing OpenCode" }).click();

    const choiceDialog = page.getByRole("dialog", { name: "Stop managing Agent" });
    await choiceDialog.getByText("Keep current environment", { exact: true }).waitFor({
      state: "visible"
    });
    await choiceDialog.getByRole("button", { name: "Review changes" }).click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.getByText("Stop managing OpenCode", { exact: true }).waitFor({
      state: "visible"
    });
    await previewDialog.getByRole("button", { name: "Keep files and detach" }).click();
    await previewDialog.waitFor({ state: "hidden" });

    await expect(readFile(join(opencodeDir, "AGENTS.md"), "utf8")).resolves.toBe(
      deployedInstructions
    );
    await expect(
      fileExists(join(appDataRoot, "target-states", "opencode.json"))
    ).resolves.toBe(false);
    await expect.poll(() => openCodeCard.textContent()).toContain("Not managed");
    await expect.poll(() => openCodeCard.textContent()).toContain("None");
  }, 30_000);

  it("stops managing OpenCode by restoring the environment from before takeover", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    const instructionsPath = join(opencodeDir, "AGENTS.md");
    const configPath = join(opencodeDir, "opencode.jsonc");
    const originalInstructions = await readFile(instructionsPath, "utf8");
    const originalConfig = await readFile(configPath, "utf8");

    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    await expect(readFile(instructionsPath, "utf8")).resolves.not.toBe(originalInstructions);

    await page.getByRole("button", { name: "Agents", exact: true }).click();
    const openCodeCard = page.getByRole("article", { name: "Agent OpenCode" });
    await openCodeCard.getByRole("button", { name: "Show OpenCode diagnostics" }).click();
    await openCodeCard.getByRole("button", { name: "Stop managing OpenCode" }).click();

    const choiceDialog = page.getByRole("dialog", { name: "Stop managing Agent" });
    await choiceDialog.getByText("Restore environment before takeover", { exact: true }).click();
    await choiceDialog.getByRole("button", { name: "Review changes" }).click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.getByRole("button", { name: "Restore and detach" }).click();
    await previewDialog.waitFor({ state: "hidden" });

    await expect(readFile(instructionsPath, "utf8")).resolves.toBe(originalInstructions);
    await expect(readFile(configPath, "utf8")).resolves.toBe(originalConfig);
    await expect(
      fileExists(join(appDataRoot, "target-states", "opencode.json"))
    ).resolves.toBe(false);
    await expect.poll(() => openCodeCard.textContent()).toContain("Not managed");
  }, 30_000);

  it("opens MCP creation from a clear page action", async () => {
    const { page } = await launchApp();
    await resizeAppWindow(page, 920, 620);
    await page.getByRole("button", { name: "MCPs", exact: true }).click();

    const addButton = page
      .locator(".library-page-header")
      .getByRole("button", { name: "Add MCP" });
    expect(await addButton.count()).toBe(1);
    expect(
      await page
        .getByRole("region", { name: "MCP library" })
        .getByText("MCP Library", { exact: true })
        .count()
    ).toBe(0);
    expect(await page.getByRole("region", { name: "MCP editor" }).count()).toBe(0);
    const mcpLibrary = page.getByRole("region", { name: "MCP library" });
    for (const column of ["MCP", "Profiles", "Actions"]) {
      expect(await mcpLibrary.getByText(column, { exact: true }).count()).toBe(1);
    }
    const libraryGeometry = await mcpLibrary.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      overflow: element.scrollWidth - element.clientWidth,
      searchTop: element.querySelector(".mcp-library-search")!.getBoundingClientRect().top,
      headerTop: element.querySelector(".mcp-list-header")!.getBoundingClientRect().top,
      toolbarBottom: element.querySelector(".mcp-library-toolbar")!.getBoundingClientRect().bottom
    }));
    expect(libraryGeometry.height).toBeGreaterThan(400);
    expect(libraryGeometry.overflow).toBeLessThanOrEqual(1);
    expect(libraryGeometry.headerTop - libraryGeometry.toolbarBottom).toBeLessThanOrEqual(1);
    await addButton.click();
    const editor = page.getByRole("dialog", { name: "MCP editor" });
    await editor.waitFor({ state: "visible" });
    const editorActions = editor.locator(".mcp-editor-actions");
    expect(await editorActions.getByRole("button", { name: "Cancel" }).boundingBox()).not.toBeNull();
    expect(await editorActions.getByRole("button", { name: "Add to library" }).boundingBox()).not.toBeNull();
    await expectInViewport(page, editor);
    await page.mouse.click(220, 420);
    await editor.waitFor({ state: "detached" });

    await addButton.click();
    await editor.waitFor({ state: "visible" });
    await expect
      .poll(() =>
        page
          .getByLabel("MCP library id")
          .evaluate((element) => document.activeElement === element)
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "detached" });
    await expect
      .poll(() => addButton.evaluate((element) => document.activeElement === element))
      .toBe(true);
  }, 30_000);

  it("edits and persists Instructions from the default-collapsed Composer", async () => {
    const { appDataRoot, page } = await launchApp();
    await page.setViewportSize({ width: 1180, height: 728 });
    await selectProfile(page, "UI OpenCode alpha");

    const instructionsTrigger = page
      .getByRole("region", { name: "Profile composer" })
      .getByRole("button", { name: "Instructions", exact: true });
    expect(await instructionsTrigger.getAttribute("aria-expanded")).toBe("false");
    await expandComposerSection(page, "Instructions");
    await page
      .getByRole("textbox", { name: "AGENTS.md" })
      .fill("# Updated through collapsed Composer\n");

    const saveButton = page.getByRole("button", { name: "Save", exact: true });
    const applyButton = page.getByRole("button", { name: "Apply", exact: true });
    const newProfileButton = page.getByRole("button", { name: "New Profile", exact: true });
    await expect
      .poll(() =>
        newProfileButton.evaluate((element) => getComputedStyle(element).backgroundColor)
      )
      .not.toBe("rgb(0, 122, 255)");
    expect(await saveButton.isEnabled()).toBe(true);
    expect(await saveButton.getAttribute("class")).toContain("is-primary");
    await expect
      .poll(() =>
        saveButton.evaluate((element) => getComputedStyle(element).backgroundColor)
      )
      .toBe("rgb(0, 122, 255)");
    expect(await applyButton.isDisabled()).toBe(true);
    expect(await applyButton.textContent()).toContain("Apply");

    await saveProfile(page);
    expect(await saveButton.isDisabled()).toBe(true);
    await expect.poll(() => applyButton.isEnabled()).toBe(true);
    await expect
      .poll(() =>
        applyButton.evaluate((element) => getComputedStyle(element).backgroundColor)
      )
      .toBe("rgb(0, 122, 255)");

    await expect(
      readFile(join(appDataRoot, "profiles", "ui-opencode-alpha", "AGENTS.md"), "utf8")
    ).resolves.toBe("# Updated through collapsed Composer\n");
  }, 30_000);

  it("cancels or saves a dirty Profile before leaving its workspace", async () => {
    const { appDataRoot, page } = await launchApp();
    const instructionsPath = join(
      appDataRoot,
      "profiles",
      "ui-opencode-alpha",
      "AGENTS.md"
    );
    const savedDraft = "# Saved before navigation\n";
    const navigation = page.getByRole("complementary", { name: "Global navigation" });

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Instructions");
    const instructions = page.getByRole("textbox", { name: "AGENTS.md" });
    await instructions.fill(savedDraft);
    await navigation.getByRole("button", { name: "Skills", exact: true }).click();

    let guard = page.getByRole("dialog", { name: "Unsaved profile changes" });
    await guard.waitFor({ state: "visible", timeout: 5_000 });
    const actionClearance = await guard.evaluate((dialog) => {
      const saveAndContinue = dialog.querySelector<HTMLButtonElement>(
        ".profile-dirty-actions .primary-action"
      );
      if (!saveAndContinue) return null;
      const dialogBox = dialog.getBoundingClientRect();
      const buttonBox = saveAndContinue.getBoundingClientRect();
      return {
        bottom: dialogBox.bottom - buttonBox.bottom,
        right: dialogBox.right - buttonBox.right
      };
    });
    expect(actionClearance).not.toBeNull();
    expect(actionClearance!.right).toBeGreaterThanOrEqual(16);
    expect(actionClearance!.bottom).toBeGreaterThanOrEqual(16);
    await guard.getByRole("button", { name: "Cancel" }).click();
    await guard.waitFor({ state: "hidden", timeout: 5_000 });
    await expect.poll(() => instructions.inputValue()).toBe(savedDraft);
    await expect(readFile(instructionsPath, "utf8")).resolves.not.toBe(savedDraft);

    await navigation.getByRole("button", { name: "Skills", exact: true }).click();
    guard = page.getByRole("dialog", { name: "Unsaved profile changes" });
    await guard.waitFor({ state: "visible", timeout: 5_000 });
    await guard.getByRole("button", { name: "Save and continue" }).click();
    await page.getByRole("heading", { name: "Skills" }).waitFor({
      state: "visible",
      timeout: 5_000
    });
    await expect(readFile(instructionsPath, "utf8")).resolves.toBe(savedDraft);
  }, 30_000);

  it("discards a dirty Profile without changing its saved file", async () => {
    const { appDataRoot, page } = await launchApp();
    const instructionsPath = join(
      appDataRoot,
      "profiles",
      "ui-opencode-alpha",
      "AGENTS.md"
    );
    const originalInstructions = await readFile(instructionsPath, "utf8");
    const discardedDraft = "# Discard this navigation draft\n";
    const navigation = page.getByRole("complementary", { name: "Global navigation" });

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Instructions");
    const reloadedInstructions = page.getByRole("textbox", { name: "AGENTS.md" });
    await reloadedInstructions.fill(discardedDraft);
    await navigation.getByRole("button", { name: "Agents", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "Unsaved profile changes" });
    await guard.waitFor({ state: "visible", timeout: 5_000 });
    await guard.getByRole("button", { name: "Discard changes" }).click();
    await page.getByRole("heading", { name: "Agents" }).waitFor({
      state: "visible",
      timeout: 5_000
    });
    await expect(readFile(instructionsPath, "utf8")).resolves.toBe(originalInstructions);
  }, 30_000);

  it("closes a clean Electron window without waiting for renderer confirmation", async () => {
    const { page } = await launchApp({ testCloseGuard: true });
    const windowHandle = await app!.browserWindow(page);
    const closed = page.waitForEvent("close");

    await windowHandle.evaluate((browserWindow) => browserWindow.close());

    await closed;
    await expect.poll(() => app!.windows().length).toBe(0);
  }, 30_000);

  it("guards dirty Electron close, supports cancel, and closes after discard", async () => {
    const { appDataRoot, page } = await launchApp({ testCloseGuard: true });
    const instructionsPath = join(
      appDataRoot,
      "profiles",
      "ui-opencode-alpha",
      "AGENTS.md"
    );
    const originalInstructions = await readFile(instructionsPath, "utf8");
    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Instructions");
    await page.getByRole("textbox", { name: "AGENTS.md" }).fill("# Unsaved close draft\n");
    const windowHandle = await app!.browserWindow(page);

    await windowHandle.evaluate((browserWindow) => browserWindow.close());
    let guard = page.getByRole("dialog", { name: "Unsaved profile changes" });
    await guard.waitFor({ state: "visible" });
    await guard.getByRole("button", { name: "Cancel" }).click();
    await guard.waitFor({ state: "hidden" });
    expect(page.isClosed()).toBe(false);

    await windowHandle.evaluate((browserWindow) => browserWindow.close());
    guard = page.getByRole("dialog", { name: "Unsaved profile changes" });
    await guard.waitFor({ state: "visible" });
    const closed = page.waitForEvent("close");
    const discardClick = guard
      .getByRole("button", { name: "Discard changes" })
      .click()
      .catch((error) => {
        if (!page.isClosed()) throw error;
      });
    await Promise.all([discardClick, closed]);

    await expect(readFile(instructionsPath, "utf8")).resolves.toBe(originalInstructions);
  }, 30_000);

  it("imports a local skill folder from the Import dialog", async () => {
    const { appDataRoot, page } = await launchApp();
    await page.setViewportSize({ width: 1180, height: 728 });
    const localSkillDir = join(appDataRoot, "manual-import-skills", "path-reviewer");
    await mkdir(localSkillDir, { recursive: true });
    await writeFile(
      join(localSkillDir, "SKILL.md"),
      "---\nname: Path Reviewer\ndescription: Imported from a selected local folder.\n---\n\n# Path Reviewer\n\nUse the selected folder import flow.\n",
      "utf8"
    );

    await app!.evaluate(
      ({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selectedPath],
          bookmarks: []
        });
      },
      localSkillDir
    );

    await page.getByRole("button", { name: "Import skills" }).click();
    await page.getByRole("button", { name: "Choose local skill folder" }).waitFor({
      state: "visible"
    });
    await expect
      .poll(
        () =>
          page.locator(".library-import-dialog").evaluate((element) => ({
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight
          })),
        { timeout: 5_000 }
      )
      .toMatchObject({
        clientHeight: expect.any(Number),
        scrollHeight: expect.any(Number)
      });
    const drawerMetrics = await page.locator(".library-import-dialog").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(drawerMetrics.clientHeight).toBeGreaterThanOrEqual(
      Math.min(drawerMetrics.scrollHeight, 360)
    );
    await page.getByRole("button", { name: "Choose local skill folder" }).click();
    await expect
      .poll(() => page.getByLabel("Local skill folder path").inputValue(), { timeout: 5_000 })
      .toBe(localSkillDir);
    await page.getByRole("button", { name: "Import copy", exact: true }).click();
    await expect
      .poll(() => fileExists(join(appDataRoot, "skills-library", "path-reviewer", "SKILL.md")), {
        timeout: 5_000
      })
      .toBe(true);

    await page
      .getByRole("group", { name: "Library item path-reviewer" })
      .getByText("Imported from a selected local folder.")
      .waitFor({ state: "visible" });
    await expect(
      readFile(join(appDataRoot, "skills-library", "path-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("Use the selected folder import flow.");
    const importedMetadata = await readJson<{
      source?: string;
      updateCheckEnabled?: boolean;
    }>(join(appDataRoot, "skills-library", "path-reviewer", ".agentenv-skill.json"));
    expect(importedMetadata).toMatchObject({
      source: localSkillDir,
      updateCheckEnabled: false
    });
    await rm(localSkillDir, { recursive: true, force: true });
    const importedRow = page.getByRole("group", { name: "Library item path-reviewer" });
    await expect.poll(() => importedRow.textContent()).toContain("Checks disabled");
    await page.getByRole("button", { name: "Close import" }).click();
    await page.getByRole("dialog", { name: "Import skills" }).waitFor({ state: "hidden" });
  }, 30_000);

  it("reviews same-name Skill differences before keeping another Library copy", async () => {
    const { appDataRoot, page } = await launchApp();
    await resizeAppWindow(page, 920, 620);
    const incomingDir = join(appDataRoot, "manual-import-skills", "shared-reviewer-alternative");
    await mkdir(incomingDir, { recursive: true });
    await writeFile(
      join(incomingDir, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: Alternative review guidance.\nversion: 2.0.0\n---\n# Alternative Reviewer\n",
      "utf8"
    );
    await app!.evaluate(
      ({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selectedPath],
          bookmarks: []
        });
      },
      incomingDir
    );

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Import skills" }).click();
    await page.getByRole("button", { name: "Choose local skill folder" }).click();
    await page.getByRole("button", { name: "Import copy", exact: true }).click();
    let conflict = page.getByRole("dialog", { name: "Review duplicate Skill" });
    await conflict.waitFor({ state: "visible" });
    const conflictBounds = await conflict.boundingBox();
    expect(conflictBounds).not.toBeNull();
    expect(conflictBounds!.x).toBeGreaterThanOrEqual(0);
    expect(conflictBounds!.y).toBeGreaterThanOrEqual(0);
    expect(conflictBounds!.x + conflictBounds!.width).toBeLessThanOrEqual(920);
    expect(conflictBounds!.y + conflictBounds!.height).toBeLessThanOrEqual(620);
    await conflict.getByRole("button", { name: "Replace Skill" }).waitFor({ state: "visible" });
    await expect.poll(() => conflict.textContent()).toContain("Different");
    await expect.poll(() => conflict.textContent()).toContain("2.0.0");
    await expect.poll(() => conflict.textContent()).toContain("SKILL.md");
    await conflict.getByRole("radio", { name: /Keep both/ }).check();
    await conflict.getByRole("textbox", { name: "Library ID", exact: true })
      .fill("shared-reviewer-alternative");
    await conflict.getByRole("button", { name: "Save another Skill" }).click();
    await conflict.waitFor({ state: "hidden" });

    await page.getByRole("group", { name: "Library item shared-reviewer-alternative" })
      .waitFor({ state: "visible" });
    await expect.poll(() =>
      page.getByRole("group", { name: "Library item shared-reviewer-alternative" }).textContent()
    ).toContain("2.0.0");
    await expect(readFile(join(appDataRoot, "skills-library", "shared-reviewer", "SKILL.md"), "utf8"))
      .resolves.toContain("Shared Reviewer");
    await expect(readFile(join(appDataRoot, "skills-library", "shared-reviewer-alternative", "SKILL.md"), "utf8"))
      .resolves.toContain("Alternative Reviewer");
    const sameNameRows = page.locator(".library-table-row", { hasText: "Shared Reviewer" });
    expect(await sameNameRows.count()).toBe(2);
    await expect.poll(() => sameNameRows.nth(0).textContent()).toContain("shared-reviewer");
    await expect.poll(() => sameNameRows.nth(1).textContent()).toContain("shared-reviewer-alternative");

    await page.getByRole("button", { name: "Import skills" }).click();
    await page.getByRole("button", { name: "Choose local skill folder" }).click();
    await page.getByRole("button", { name: "Import copy", exact: true }).click();
    conflict = page.getByRole("dialog", { name: "Review duplicate Skill" });
    await conflict.waitFor({ state: "visible" });
    await conflict.getByRole("radio", { name: /shared-reviewer-alternative/ }).click();
    await expect.poll(() => conflict.textContent()).toContain("Identical");
    await conflict.getByRole("button", { name: "Use existing" }).click();
    await conflict.waitFor({ state: "hidden" });
    expect(await page.locator(".library-table-row", { hasText: "Shared Reviewer" }).count()).toBe(2);

    const originalRow = page.getByRole("group", { name: "Library item shared-reviewer", exact: true });
    await originalRow.getByRole("button", { name: "More actions for shared-reviewer", exact: true }).click();
    await page.getByRole("menuitem", { name: "Merge duplicates" }).click();
    const mergeDialog = page.getByRole("dialog", { name: "Merge same-name Skills" });
    await mergeDialog.waitFor({ state: "visible" });
    await expectInViewport(page, mergeDialog);
    await expectNoHorizontalOverflow(page, [".skill-merge-dialog"]);
    await expect.poll(() => mergeDialog.textContent()).toContain("Differences found");
    await expect.poll(() => mergeDialog.textContent()).toContain("SKILL.md");
    const keepSkill = mergeDialog.getByRole("group", { name: "Keep Skill" });
    const keepSource = mergeDialog.getByRole("group", { name: "Keep update source" });
    await keepSkill.getByRole("radio", { name: /^shared-reviewer\s/ }).check();
    await keepSource.getByRole("radio", { name: /shared-reviewer-alternative/ }).check();
    await mergeDialog.getByRole("button", { name: "Merge Skills" }).click();
    await mergeDialog.waitFor({ state: "hidden" });

    await expect
      .poll(() => page.getByRole("group", { name: /Library item shared-reviewer/ }).count())
      .toBe(1);
    await expect(fileExists(join(appDataRoot, "skills-library", "shared-reviewer-alternative")))
      .resolves.toBe(false);
    await expect(readFile(join(appDataRoot, "skills-library", "shared-reviewer", "SKILL.md"), "utf8"))
      .resolves.toContain("Shared Reviewer");
    const undoMerge = page.getByRole("button", { name: "Undo merge" });
    await undoMerge.waitFor({ state: "visible" });
    await expect.poll(() => page.getByText("Merged duplicates into shared-reviewer").count()).toBe(1);
    await undoMerge.click();
    await expect
      .poll(() => page.locator(".library-table-row", { hasText: "Shared Reviewer" }).count())
      .toBe(2);
    await expect(fileExists(join(appDataRoot, "skills-library", "shared-reviewer-alternative", "SKILL.md")))
      .resolves.toBe(true);
  }, 45_000);

  it("imports a Target-local skill and immediately replaces the source with a managed install", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    const localSkillDir = join(opencodeDir, "skills", "managed-after-import");
    await mkdir(localSkillDir, { recursive: true });
    await writeFile(
      join(localSkillDir, "SKILL.md"),
      "---\nname: Managed After Import\ndescription: The original Target copy becomes managed.\n---\n\n# Managed After Import\n",
      "utf8"
    );
    await app!.evaluate(
      ({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selectedPath],
          bookmarks: []
        });
      },
      localSkillDir
    );

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Import skills" }).click();
    await page.getByRole("button", { name: "Choose local skill folder" }).click();
    await expect.poll(() => page.getByRole("status").textContent()).toContain(
      "back up this Agent copy"
    );
    await page.getByRole("button", { name: "Import & manage", exact: true }).click();

    const markerPath = `${localSkillDir}.agentenv-owner.json`;
    await expect.poll(() => fileExists(markerPath), { timeout: 5_000 }).toBe(true);
    await expect(
      readFile(join(appDataRoot, "skills-library", "managed-after-import", "SKILL.md"), "utf8")
    ).resolves.toContain("The original Target copy becomes managed");
    await expect(readFile(markerPath, "utf8")).resolves.toContain(
      '"source": "skills-library/managed-after-import"'
    );
    const managedInventory = await page.evaluate(() => window.agentEnv.scanSkillInventory());
    expect(
      managedInventory.filter((item) => item.skillKey === "managed-after-import")
    ).toEqual([
      expect.objectContaining({
        status: "managed",
        libraryId: "managed-after-import",
        contentMatchesLibrary: true
      })
    ]);

    await page.getByRole("button", { name: "Close import" }).click();
    await page.getByRole("button", { name: "Scan local" }).click();
    const cleanupGroup = page.getByRole("group", {
      name: "Cleanup group managed-after-import"
    });
    await cleanupGroup.waitFor({ state: "visible" });
    await expect.poll(() => cleanupGroup.textContent()).toContain("Managed");
    expect(
      await cleanupGroup.getByRole("button", { name: "Add to Library managed-after-import" }).count()
    ).toBe(0);
    expect(
      await cleanupGroup.getByRole("button", {
        name: "More cleanup actions for managed-after-import"
      }).count()
    ).toBe(1);
  }, 30_000);

  it("imports a shared compatibility Skill without taking ownership and blocks early removal", async () => {
    const { appDataRoot, homeDir, page } = await launchApp();
    const sharedSkillDir = join(homeDir, ".agents", "skills", "shared-migration-reviewer");
    const sharedContent =
      "---\nname: Shared Migration Reviewer\ndescription: Shared by installed compatibility consumers.\n---\n\n# Shared Migration Reviewer\n";
    await mkdir(sharedSkillDir, { recursive: true });
    await writeFile(join(sharedSkillDir, "SKILL.md"), sharedContent, "utf8");

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    const cleanupGroup = page.getByRole("group", {
      name: "Cleanup group shared-migration-reviewer"
    });
    await cleanupGroup.waitFor({ state: "visible" });
    await expect.poll(() => cleanupGroup.textContent()).toContain("Unmanaged");
    expect(
      await cleanupGroup
        .getByRole("button", { name: "Manage copies shared-migration-reviewer" })
        .count()
    ).toBe(0);
    for (const viewport of [
      { width: 1180, height: 728 },
      { width: 920, height: 620 }
    ]) {
      await resizeAppWindow(page, viewport.width, viewport.height);
      const geometry = await cleanupGroup.evaluate((row) => {
        const rowBox = row.getBoundingClientRect();
        const main = row.querySelector<HTMLElement>(".resource-row__main")!.getBoundingClientRect();
        const actionGroup = row.querySelector<HTMLElement>(".cleanup-group-actions")!;
        const actions = actionGroup.getBoundingClientRect();
        return {
          contained: actions.right <= rowBox.right + 1 && row.scrollWidth <= row.clientWidth + 1,
          separated: actions.left >= main.right - 1,
          buttonsFit: Array.from(actionGroup.querySelectorAll<HTMLElement>("button"))
            .every((button) => button.scrollWidth <= button.clientWidth + 1)
        };
      });
      expect(geometry).toEqual({ contained: true, separated: true, buttonsFit: true });
    }

    await cleanupGroup
      .getByRole("button", { name: "Add to Library shared-migration-reviewer" })
      .click();
    const addSharedDialog = page.getByRole("dialog", { name: "Review skill cleanup" });
    await addSharedDialog.getByRole("button", { name: "Add to Library" }).click();
    await expect
      .poll(
        () => fileExists(join(appDataRoot, "skills-library", "shared-migration-reviewer", "SKILL.md")),
        { timeout: 5_000 }
      )
      .toBe(true);
    await expect(readFile(join(sharedSkillDir, "SKILL.md"), "utf8")).resolves.toBe(sharedContent);
    await expect(fileExists(join(sharedSkillDir, ".agentenv-owner.json"))).resolves.toBe(false);
    await expect.poll(() => cleanupGroup.textContent()).toContain("Shared");
    await expect.poll(() => cleanupGroup.textContent()).toContain("2 Agents still load this shared copy");
    await resizeAppWindow(page, 920, 620);
    const sharedStateGeometry = await cleanupGroup.evaluate((row) => {
      const rowBox = row.getBoundingClientRect();
      const name = row.querySelector<HTMLElement>(".cleanup-group-name")!.getBoundingClientRect();
      const stateElement = row.querySelector<HTMLElement>(".cleanup-group-state")!;
      const state = stateElement.getBoundingClientRect();
      const overlaps =
        name.left < state.right &&
        name.right > state.left &&
        name.top < state.bottom &&
        name.bottom > state.top;
      return {
        contained:
          name.left >= rowBox.left - 1 &&
          state.right <= rowBox.right + 1,
        overlaps,
        stateFits: stateElement.scrollWidth <= stateElement.clientWidth + 1
      };
    });
    expect(sharedStateGeometry).toEqual({ contained: true, overlaps: false, stateFits: true });
    await cleanupGroup.locator(".cleanup-group-state").hover();
    const sharedStateTooltip = page.getByRole("tooltip").filter({
      hasText: "Shared copy still active"
    });
    await sharedStateTooltip.waitFor({ state: "visible" });
    await expectInViewport(page, sharedStateTooltip);
    expect(
      await Promise.all([
        sharedStateTooltip.boundingBox(),
        cleanupGroup
          .getByRole("button", { name: "Review shared copy shared-migration-reviewer" })
          .boundingBox()
      ]).then(([tooltip, action]) =>
        Boolean(
          tooltip &&
          action &&
          tooltip.x < action.x + action.width &&
          tooltip.x + tooltip.width > action.x &&
          tooltip.y < action.y + action.height &&
          tooltip.y + tooltip.height > action.y
        )
      )
    ).toBe(false);
    await cleanupGroup
      .getByRole("button", { name: "Review shared copy shared-migration-reviewer" })
      .click();
    const sharedTargetReview = page.getByRole("dialog", { name: "Choose shared Skill handling" });
    await sharedTargetReview.waitFor({ state: "visible" });
    await expect.poll(() => sharedTargetReview.textContent()).toContain(
      "still loaded by 2 Agents from one shared folder"
    );
    await expect.poll(() => sharedTargetReview.textContent()).toContain("OpenCode");
    await expect.poll(() => sharedTargetReview.textContent()).toContain("Codex");
    await expect.poll(() => sharedTargetReview.textContent()).toContain(
      "return here to replace the shared copy"
    );
    await expect(sharedTargetReview.getByRole("button", { name: "Keep shared copy" }).count()).resolves.toBe(1);
    await sharedTargetReview.getByRole("button", { name: "Open Profiles" }).click();
    await page.getByRole("region", { name: "Profiles", exact: true }).waitFor({ state: "visible" });
    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    await cleanupGroup.waitFor({ state: "visible" });

    const retirementError = await page.evaluate(async ({ skillKey, libraryId, path }) => {
      try {
        await window.agentEnv.retireSharedSkill({
          skillKey,
          libraryId,
          paths: [path]
        });
        return "";
      } catch (error) {
        return String(error);
      }
    }, {
      skillKey: "shared-migration-reviewer",
      libraryId: "shared-migration-reviewer",
      path: sharedSkillDir
    });
    expect(retirementError).toContain("is not prepared");
    await expect(fileExists(sharedSkillDir)).resolves.toBe(true);

    await cleanupGroup
      .getByRole("button", { name: "More cleanup actions for shared-migration-reviewer" })
      .click();
    await page.getByRole("menuitem", { name: "Keep shared copy" }).click();
    await expect.poll(() => cleanupGroup.textContent()).toContain("Kept");
    await cleanupGroup
      .getByRole("button", { name: "More cleanup actions for shared-migration-reviewer" })
      .click();
    await page.getByRole("menuitem", { name: "Review again" }).click();
    await expect.poll(() => cleanupGroup.textContent()).toContain("Shared");
  }, 30_000);

  it("atomically migrates and restores a shared Skill after every consumer is prepared", async () => {
    const { appDataRoot, homeDir, opencodeDir, codexDir, page } = await launchApp();
    const skillId = "shared-ready-reviewer";
    const skillName = "Shared Ready Reviewer";
    const sharedSkillDir = join(homeDir, ".agents", "skills", skillId);
    const sharedContent =
      `---\nname: ${skillName}\ndescription: Ready after every consumer migrates.\n---\n\n# ${skillName}\n`;
    await mkdir(sharedSkillDir, { recursive: true });
    await writeFile(join(sharedSkillDir, "SKILL.md"), sharedContent, "utf8");
    const openCodeDuplicate = join(opencodeDir, "skills", skillId);
    const codexDuplicate = join(codexDir, "skills", skillId);
    await mkdir(openCodeDuplicate, { recursive: true });
    await mkdir(codexDuplicate, { recursive: true });
    await writeFile(join(openCodeDuplicate, "SKILL.md"), "# OpenCode older copy\n", "utf8");
    await writeFile(join(codexDuplicate, "SKILL.md"), "# Codex older copy\n", "utf8");

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    let cleanupGroup = page.getByRole("group", { name: `Cleanup group ${skillId}` });
    await cleanupGroup
      .getByRole("button", { name: `Add to Library ${skillId}` })
      .click();
    const addSharedDialog = page.getByRole("dialog", { name: "Review skill cleanup" });
    await expect.poll(() => addSharedDialog.textContent()).toContain("Version to keep in Library");
    await addSharedDialog.getByRole("radio", { name: /Shared:/ }).click();
    await addSharedDialog.getByRole("button", { name: "Add to Library" }).click();
    await expect
      .poll(() => fileExists(join(appDataRoot, "skills-library", skillId, "SKILL.md")))
      .toBe(true);
    await expect.poll(() => fileExists(join(sharedSkillDir, "SKILL.md"))).toBe(true);
    await expect(readFile(join(sharedSkillDir, "SKILL.md"), "utf8")).resolves.toBe(sharedContent);
    await expect(fileExists(join(sharedSkillDir, ".agentenv-owner.json"))).resolves.toBe(false);
    await expect.poll(() => fileExists(openCodeDuplicate), { timeout: 5_000 }).toBe(false);
    await expect.poll(() => fileExists(codexDuplicate), { timeout: 5_000 }).toBe(false);

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    await addLibrarySkillToProfile(page, skillName);
    await saveProfile(page);
    await applyActionButton(page, "OpenCode").click();
    const preparationPreview = page.getByRole("dialog", { name: "Preview" });
    await expect.poll(() => preparationPreview.textContent()).toContain("Shared Skill cleanup");
    await expect.poll(() => preparationPreview.textContent()).toContain(
      `After cleanup: install as ${skillId}`
    );
    await preparationPreview.getByRole("button", { name: "Apply profile" }).click();
    await preparationPreview.waitFor({ state: "hidden" });
    await expect(fileExists(join(opencodeDir, "skills", skillId))).resolves.toBe(false);

    await selectTarget(page, "Codex");
    await selectProfile(page, "UI Codex alpha");
    await expandComposerSection(page, "Skills");
    await addLibrarySkillToProfile(page, skillName);
    await saveProfile(page);
    await previewAndApply(page, "Codex");
    await expect(fileExists(join(codexDir, "skills", skillId))).resolves.toBe(false);

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    cleanupGroup = page.getByRole("group", { name: `Cleanup group ${skillId}` });
    await expect.poll(() => cleanupGroup.textContent()).toContain("Ready");
    await expect.poll(() => cleanupGroup.textContent()).toContain("All consumer Agents are ready");
    for (const viewport of [
      { width: 1180, height: 728 },
      { width: 920, height: 620 }
    ]) {
      await resizeAppWindow(page, viewport.width, viewport.height);
      const geometry = await cleanupGroup.evaluate((row) => {
        const rowBox = row.getBoundingClientRect();
        const actionGroup = row.querySelector<HTMLElement>(".cleanup-group-actions")!;
        const actions = actionGroup.getBoundingClientRect();
        const buttonWidths = Array.from(actionGroup.querySelectorAll<HTMLElement>("button"))
          .map((button) => ({
            text: button.textContent?.trim() ?? "",
            client: button.clientWidth,
            scroll: button.scrollWidth
          }));
        return {
          contained: actions.right <= rowBox.right + 1 && row.scrollWidth <= row.clientWidth + 1,
          buttonWidths
        };
      });
      expect(geometry.contained).toBe(true);
      expect(
        geometry.buttonWidths.filter((button) => button.scroll > button.client + 1)
      ).toEqual([]);
    }
    await cleanupGroup
      .getByRole("button", { name: `Review replacement ${skillId}` })
      .click();
    const retirementDialog = page.getByRole("dialog", { name: "Replace shared Skill copy" });
    await expect.poll(() => retirementDialog.textContent()).toContain(`Install as ${skillId}`);
    await expectInViewport(page, retirementDialog);
    await retirementDialog.getByRole("button", { name: "Replace shared copy" }).click();
    await retirementDialog.waitFor({ state: "hidden" });
    await expect(fileExists(sharedSkillDir)).resolves.toBe(false);
    await expect(fileExists(join(appDataRoot, "skills-library", skillId, "SKILL.md"))).resolves.toBe(true);
    await expect(fileExists(`${join(opencodeDir, "skills", skillId)}.agentenv-owner.json`)).resolves.toBe(true);
    await expect(fileExists(`${join(codexDir, "skills", skillId)}.agentenv-owner.json`)).resolves.toBe(true);

    const history = page.getByRole("region", { name: "Cleanup history" });
    await expect.poll(() => history.textContent()).toContain("Shared copy replacement");
    const migrationHistoryRow = history
      .locator(".cleanup-history-row")
      .filter({ hasText: skillId })
      .filter({ hasText: "Shared copy replacement" });
    await migrationHistoryRow
      .getByRole("button", { name: `Restore cleanup ${skillId}` })
      .click();
    await expect.poll(() => fileExists(join(sharedSkillDir, "SKILL.md"))).toBe(true);
    await expect(readFile(join(sharedSkillDir, "SKILL.md"), "utf8")).resolves.toBe(sharedContent);
    await expect.poll(() => fileExists(join(opencodeDir, "skills", skillId))).toBe(false);
    await expect.poll(() => fileExists(join(codexDir, "skills", skillId))).toBe(false);
  }, 45_000);

  it("auto-manages safe cleanup groups while leaving content conflicts for review", async () => {
    const { appDataRoot, opencodeDir, homeDir, page } = await launchApp();
    await writeUnmanagedTargetSkill(
      opencodeDir,
      "auto-local-reviewer",
      "A single safe local copy."
    );
    const openCodeDuplicate = join(opencodeDir, "skills", "auto-duplicate-reviewer");
    const codexDuplicate = join(homeDir, ".codex", "skills", "auto-duplicate-reviewer");
    await mkdir(openCodeDuplicate, { recursive: true });
    await mkdir(codexDuplicate, { recursive: true });
    const duplicateContent =
      "---\nname: Auto Duplicate Reviewer\ndescription: Identical copies.\n---\n\n# Same\n";
    await writeFile(join(openCodeDuplicate, "SKILL.md"), duplicateContent, "utf8");
    await writeFile(join(codexDuplicate, "SKILL.md"), duplicateContent, "utf8");
    const openCodeConflict = join(opencodeDir, "skills", "manual-conflict-reviewer");
    const codexConflict = join(homeDir, ".codex", "skills", "manual-conflict-reviewer");
    await mkdir(openCodeConflict, { recursive: true });
    await mkdir(codexConflict, { recursive: true });
    await writeFile(join(openCodeConflict, "SKILL.md"), "# OpenCode version\n", "utf8");
    await writeFile(join(codexConflict, "SKILL.md"), "# Codex version\n", "utf8");

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    const safeGroup = page.getByRole("group", { name: "Cleanup group auto-local-reviewer" });
    const duplicateGroup = page.getByRole("group", {
      name: "Cleanup group auto-duplicate-reviewer"
    });
    const conflictGroup = page.getByRole("group", {
      name: "Cleanup group manual-conflict-reviewer"
    });
    await safeGroup.waitFor({ state: "visible" });
    await expect.poll(() => safeGroup.textContent()).toContain("Unmanaged");
    await expect.poll(() => duplicateGroup.textContent()).toContain("Duplicate");
    await expect.poll(() => conflictGroup.textContent()).toContain("Conflict");
    expect(
      await conflictGroup.getByRole("button", { name: "Add to Library manual-conflict-reviewer" }).count()
    ).toBe(1);
    await conflictGroup
      .getByRole("button", { name: "Add to Library manual-conflict-reviewer" })
      .click();
    const cleanupDialog = page.getByRole("dialog", { name: "Review skill cleanup" });
    await cleanupDialog.waitFor({ state: "visible" });
    await expect.poll(() => cleanupDialog.textContent()).toContain("Version to keep in Library");
    await expect.poll(() => cleanupDialog.textContent()).toContain(
      "Choose the copy whose contents you want to preserve"
    );
    await page.keyboard.press("Escape");
    await cleanupDialog.waitFor({ state: "hidden" });

    const assertCleanupLayout = async (stacked: boolean) => {
      const geometry = await page.getByRole("region", { name: "Environment skills" }).evaluate((drawer) => {
        const heading = drawer.querySelector<HTMLElement>(".cleanup-section-heading")!;
        const headingCopy = heading.firstElementChild!.getBoundingClientRect();
        const autoAction = heading.querySelector<HTMLElement>(".cleanup-auto-action")!.getBoundingClientRect();
        const rows = Array.from(drawer.querySelectorAll<HTMLElement>(".cleanup-group-row")).map((row) => {
          const rowBox = row.getBoundingClientRect();
          const main = row.querySelector<HTMLElement>(".resource-row__main")!.getBoundingClientRect();
          const name = row.querySelector<HTMLElement>(".cleanup-group-name")!.getBoundingClientRect();
          const stateElement = row.querySelector<HTMLElement>(".cleanup-group-state")!;
          const state = stateElement.getBoundingClientRect();
          const actionGroup = row.querySelector<HTMLElement>(".cleanup-group-actions")!;
          const actions = actionGroup.getBoundingClientRect();
          const headingItemsOverlap =
            name.left < state.right &&
            name.right > state.left &&
            name.top < state.bottom &&
            name.bottom > state.top;
          return {
            contained:
              name.left >= rowBox.left - 1 &&
              state.right <= rowBox.right + 1 &&
              actions.right <= rowBox.right + 1 &&
              state.left >= main.right - 1 &&
              actions.left >= state.right - 1 &&
              !headingItemsOverlap,
            stateLeft: Math.round(state.left),
            stateFits: stateElement.scrollWidth <= stateElement.clientWidth + 1,
            textFits: Array.from(row.querySelectorAll<HTMLElement>(".resource-row__main > *")).every(
              (item) => item.clientWidth <= main.width + 1
            ),
            actionsFit: Array.from(actionGroup.querySelectorAll<HTMLElement>("button"))
              .every((button) => button.scrollWidth <= button.clientWidth + 1)
          };
        });
        return {
          actionBelowCopy: autoAction.top >= headingCopy.bottom - 1,
          actionAfterCopy: autoAction.left >= headingCopy.right,
          actionContained: autoAction.right <= heading.getBoundingClientRect().right + 1,
          actionWidths: Array.from(
            drawer.querySelectorAll<HTMLElement>(".cleanup-current-action")
          ).map((button) => Math.round(button.getBoundingClientRect().width)),
          rows
        };
      });
      expect(geometry.actionContained).toBe(true);
      expect(stacked ? geometry.actionBelowCopy : geometry.actionAfterCopy).toBe(true);
      expect(
        geometry.rows.every(
          (row) => row.contained && row.stateFits && row.textFits && row.actionsFit
        )
      ).toBe(true);
      expect(new Set(geometry.rows.map((row) => row.stateLeft)).size).toBe(1);
      expect(new Set(geometry.actionWidths).size).toBeLessThanOrEqual(1);
    };
    await assertCleanupLayout(false);
    await resizeAppWindow(page, 920, 620);
    await assertCleanupLayout(false);

    await duplicateGroup
      .getByRole("button", { name: "Add to Library auto-duplicate-reviewer" })
      .click();
    await page
      .getByRole("dialog", { name: "Review skill cleanup" })
      .getByRole("button", { name: "Add to Library" })
      .click();
    await expect
      .poll(() => fileExists(`${openCodeDuplicate}.agentenv-owner.json`), { timeout: 10_000 })
      .toBe(true);
    await expect
      .poll(() => fileExists(`${codexDuplicate}.agentenv-owner.json`), { timeout: 10_000 })
      .toBe(true);
    await expect.poll(() => duplicateGroup.textContent()).toContain("Managed");
    await expect
      .poll(() => duplicateGroup.getByText("Duplicate", { exact: true }).count())
      .toBe(0);
    expect(
      await duplicateGroup
        .getByRole("button", { name: "Add to Library auto-duplicate-reviewer" })
        .count()
    ).toBe(0);
    const resolvedAlignment = await Promise.all([duplicateGroup, conflictGroup].map((row) =>
      row.evaluate((element) => {
        const state = element.querySelector<HTMLElement>(".cleanup-group-state")!.getBoundingClientRect();
        const actions = element.querySelector<HTMLElement>(".cleanup-group-actions")!.getBoundingClientRect();
        return {
          stateLeft: Math.round(state.left),
          actionsLeft: Math.round(actions.left),
          actionsRight: Math.round(actions.right)
        };
      })
    ));
    expect(resolvedAlignment[0]).toEqual(resolvedAlignment[1]);

    await page.getByRole("button", { name: /Review \d+ ready Skills/ }).click();
    const bulkCleanupDialog = page.getByRole("dialog", { name: "Review ready skills" });
    await expect.poll(() => bulkCleanupDialog.textContent()).toContain("Auto Local Reviewer");
    await expectInViewport(page, bulkCleanupDialog);
    expect(
      await bulkCleanupDialog
        .locator(".preview-actions button")
        .evaluateAll((buttons) => buttons.every((button) => button.scrollWidth <= button.clientWidth))
    ).toBe(true);
    await bulkCleanupDialog.getByRole("button", { name: /Clean up \d+ skills/ }).click();
    await expect
      .poll(
        () => fileExists(join(appDataRoot, "skills-library", "auto-local-reviewer", "SKILL.md")),
        { timeout: 10_000 }
      )
      .toBe(true);
    await expect(
      fileExists(join(appDataRoot, "skills-library", "auto-duplicate-reviewer", "SKILL.md"))
    ).resolves.toBe(true);
    await expect(
      fileExists(join(appDataRoot, "skills-library", "manual-conflict-reviewer"))
    ).resolves.toBe(false);
    await expect.poll(() => conflictGroup.textContent()).toContain("Conflict");
    await expect
      .poll(() => page.getByRole("button", { name: /Review \d+ ready Skills/ }).count())
      .toBe(0);
  }, 30_000);

  it("refreshes the open local skill cleanup with a new disk scan", async () => {
    const { opencodeDir, page } = await launchApp();

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    const drawer = page.getByRole("region", { name: "Environment skills" });
    await drawer.waitFor({ state: "visible" });
    expect(
      await drawer.getByRole("group", { name: "Cleanup group refresh-only-reviewer" }).count()
    ).toBe(0);

    await writeUnmanagedTargetSkill(
      opencodeDir,
      "refresh-only-reviewer",
      "Found by an explicit cleanup refresh."
    );
    await drawer.getByRole("button", { name: "Refresh local skills" }).click();

    const refreshedGroup = drawer.getByRole("group", {
      name: "Cleanup group refresh-only-reviewer"
    });
    await refreshedGroup.waitFor({ state: "visible", timeout: 5_000 });
    await expect.poll(() => refreshedGroup.textContent()).toContain(
      "Found by an explicit cleanup refresh"
    );
    await expect.poll(() => page.getByRole("status").textContent()).toContain(
      "Local skills refreshed"
    );
  }, 30_000);

  it("imports a Skills CLI installation without changing the external copy or lock", async () => {
    const { appDataRoot, homeDir, opencodeDir, page } = await launchApp();
    const canonicalDir = join(homeDir, ".agents", "skills", "skills-cli-reviewer");
    const targetSkillsDir = join(opencodeDir, "skills");
    const targetDir = join(targetSkillsDir, "skills-cli-reviewer");
    const lockPath = join(homeDir, ".agents", ".skill-lock.json");
    const lockContent = JSON.stringify({
      version: 3,
      skills: {
        "skills-cli-reviewer": {
          source: "acme/skills",
          sourceType: "github",
          sourceUrl: "https://github.com/acme/skills",
          ref: "main",
          skillPath: "skills/skills-cli-reviewer/SKILL.md",
          skillFolderHash: "tree-sha"
        }
      }
    });
    await mkdir(canonicalDir, { recursive: true });
    await mkdir(targetSkillsDir, { recursive: true });
    await writeFile(
      join(canonicalDir, "SKILL.md"),
      "---\nname: Skills CLI Reviewer\ndescription: Imported without takeover.\n---\n"
    );
    await symlink(canonicalDir, targetDir, "dir");
    await writeFile(lockPath, lockContent);

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    const group = page.getByRole("group", { name: "Cleanup group skills-cli-reviewer" });
    await group.waitFor({ state: "visible", timeout: 5_000 });
    await expect.poll(() => group.textContent()).toContain("External");
    await group.getByRole("button", { name: "Review ownership skills-cli-reviewer" }).click();
    const dialog = page.getByRole("dialog", { name: "Import external skill" });
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
    await expect.poll(() => dialog.textContent()).toContain("lock data stay unchanged");
    await resizeAppWindow(page, 920, 620);
    const dialogGeometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const actions = element.querySelector<HTMLElement>(".preview-actions")?.getBoundingClientRect();
      const buttons = [...element.querySelectorAll<HTMLButtonElement>(".preview-actions button")];
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        actionsBottom: actions?.bottom ?? 0,
        buttonsFit: buttons.every((button) => button.scrollWidth <= button.clientWidth),
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height)
      };
    });
    expect(dialogGeometry.left).toBeGreaterThanOrEqual(0);
    expect(dialogGeometry.right).toBeLessThanOrEqual(920);
    expect(dialogGeometry.top).toBeGreaterThanOrEqual(0);
    expect(dialogGeometry.bottom).toBeLessThanOrEqual(620);
    expect(dialogGeometry.actionsBottom).toBeLessThanOrEqual(dialogGeometry.bottom);
    expect(dialogGeometry.buttonsFit).toBe(true);
    expect(new Set(dialogGeometry.buttonHeights).size).toBe(1);
    await dialog.getByRole("button", { name: "Import copy" }).click();

    await page
      .getByRole("group", { name: "Library item skills-cli-reviewer" })
      .waitFor({ state: "visible", timeout: 5_000 });
    await expect(readFile(lockPath, "utf8")).resolves.toBe(lockContent);
    expect((await lstat(targetDir)).isSymbolicLink()).toBe(true);
    await expect(
      readFile(join(appDataRoot, "skills-library", "skills-cli-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("Imported without takeover");
    const metadata = await readJson<{
      sourceType?: string;
      updatePolicy?: string;
      provenance?: { externalManager?: string; externalLockPath?: string };
    }>(join(appDataRoot, "skills-library", "skills-cli-reviewer", ".agentenv-skill.json"));
    expect(metadata).toMatchObject({
      sourceType: "github",
      updatePolicy: "tracked",
      provenance: {
        externalManager: "skills-cli",
        externalLockPath: lockPath
      }
    });
  }, 30_000);

  it("imports an external Skill with a colliding Library id without leaving the dialog open", async () => {
    const { appDataRoot, homeDir, opencodeDir, page } = await launchApp();
    const skillId = "open-browser-use";
    const existingLibraryDir = join(appDataRoot, "skills-library", skillId);
    const canonicalDir = join(homeDir, ".agents", "skills", skillId);
    const targetDir = join(opencodeDir, "skills", skillId);
    const lockPath = join(homeDir, ".agents", ".skill-lock.json");
    await mkdir(existingLibraryDir, { recursive: true });
    await mkdir(canonicalDir, { recursive: true });
    await mkdir(dirname(targetDir), { recursive: true });
    await writeFile(join(existingLibraryDir, "SKILL.md"), "# Existing unrelated Library version\n");
    await writeFile(
      join(canonicalDir, "SKILL.md"),
      "---\nname: Open Browser Use\ndescription: External version.\n---\n# External\n"
    );
    await symlink(canonicalDir, targetDir, "dir");
    await writeJson(lockPath, {
      version: 3,
      skills: {
        [skillId]: {
          source: "acme/browser-skills",
          sourceType: "github",
          sourceUrl: "https://github.com/acme/browser-skills",
          ref: "main",
          skillPath: `skills/${skillId}/SKILL.md`,
          skillFolderHash: "browser-tree"
        }
      }
    });

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    const group = page.getByRole("group", { name: `Cleanup group ${skillId}` });
    await group.waitFor({ state: "visible" });
    await group.getByRole("button", { name: `Review ownership ${skillId}` }).click();
    const dialog = page.getByRole("dialog", { name: "Import external skill" });
    await dialog.getByRole("button", { name: "Import copy" }).click();
    await dialog.waitFor({ state: "hidden" });
    const duplicateDialog = page.getByRole("dialog", { name: "Review duplicate Skill" });
    await duplicateDialog.waitFor({ state: "visible" });
    await duplicateDialog.getByRole("radio", { name: /Keep both/ }).check();
    await duplicateDialog.getByRole("textbox", { name: "Library ID", exact: true })
      .fill("open-browser-use-2");
    await duplicateDialog.getByRole("button", { name: "Save another Skill" }).click();
    await duplicateDialog.waitFor({ state: "hidden" });

    await page.getByRole("group", { name: "Library item open-browser-use-2" })
      .waitFor({ state: "visible" });
    await expect(readFile(join(existingLibraryDir, "SKILL.md"), "utf8"))
      .resolves.toContain("Existing unrelated");
    await expect(readFile(join(appDataRoot, "skills-library", "open-browser-use-2", "SKILL.md"), "utf8"))
      .resolves.toContain("# External");
    expect((await lstat(targetDir)).isSymbolicLink()).toBe(true);
    await page.getByRole("button", { name: "Scan local" }).click();
    const representedReview = page.getByRole("button", { name: `Review ownership ${skillId}` });
    await representedReview.waitFor({ state: "visible" });
    await representedReview.click();
    const representedDialog = page.getByRole("dialog", { name: "Import external skill" });
    await expect.poll(() => representedDialog.textContent()).toContain("Review the matching Library copy");
    await representedDialog.getByRole("button", { name: "Review Library copy" }).click();
    const representedConflict = page.getByRole("dialog", { name: "Review duplicate Skill" });
    await representedConflict.waitFor({ state: "visible" });
    await expect.poll(() => representedConflict.textContent()).toContain("Identical");
    await representedConflict.getByRole("button", { name: "Use existing" }).click();
    await representedConflict.waitFor({ state: "hidden" });
    const repeatedImport = await page.evaluate(async (sourcePath) => {
      const preview = await window.agentEnv.previewSkillImport({
        kind: "local",
        input: { sourcePath, id: "open-browser-use" }
      });
      return window.agentEnv.importSkillToLibrary({
        sourcePath,
        id: "open-browser-use",
        expectedContentHash: preview.incoming.contentHash,
        conflictResolution: { action: "reuse", existingId: "open-browser-use-2" }
      });
    }, targetDir);
    expect(repeatedImport).toMatchObject({
      reused: true,
      managedLocations: [],
      skill: { id: "open-browser-use-2" }
    });
  }, 45_000);

  it("updates an existing Library source from a represented External Skill", async () => {
    const { appDataRoot, homeDir, opencodeDir, page } = await launchApp();
    const skillId = "external-source-upgrade";
    const content =
      "---\nname: External Source Upgrade\ndescription: Same content with online provenance.\n---\n# External Source Upgrade\n";
    const libraryDir = join(appDataRoot, "skills-library", skillId);
    const localSourceDir = join(appDataRoot, "local-sources", skillId);
    const canonicalDir = join(homeDir, ".agents", "skills", skillId);
    const targetDir = join(opencodeDir, "skills", skillId);
    await mkdir(libraryDir, { recursive: true });
    await mkdir(localSourceDir, { recursive: true });
    await mkdir(canonicalDir, { recursive: true });
    await mkdir(dirname(targetDir), { recursive: true });
    await writeFile(join(libraryDir, "SKILL.md"), content);
    await writeFile(join(localSourceDir, "SKILL.md"), content);
    await writeFile(join(canonicalDir, "SKILL.md"), content);
    await writeJson(join(libraryDir, ".agentenv-skill.json"), {
      sourceType: "local",
      source: localSourceDir,
      updatePolicy: "untracked"
    });
    await symlink(canonicalDir, targetDir, "dir");
    await writeJson(join(homeDir, ".agents", ".skill-lock.json"), {
      version: 3,
      skills: {
        [skillId]: {
          source: "acme/browser-skills",
          sourceType: "github",
          sourceUrl: "https://github.com/acme/browser-skills",
          ref: "main",
          skillPath: `skills/${skillId}/SKILL.md`,
          skillFolderHash: "external-source-upgrade-tree"
        }
      }
    });

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    const group = page.getByRole("group", { name: `Cleanup group ${skillId}` });
    await group.waitFor({ state: "visible" });
    await group.getByRole("button", { name: `Review ownership ${skillId}` }).click();
    const externalDialog = page.getByRole("dialog", { name: "Import external skill" });
    await expect.poll(() => externalDialog.textContent()).toContain("Review the matching Library copy");
    await externalDialog.getByRole("button", { name: "Review Library copy" }).click();
    const conflict = page.getByRole("dialog", { name: "Review duplicate Skill" });
    await conflict.waitFor({ state: "visible" });
    await expect.poll(() => conflict.textContent()).toContain("Source available");
    await conflict.getByRole("button", { name: "Update source" }).click();
    await conflict.waitFor({ state: "hidden" });

    await expect.poll(async () => readJson<{
      sourceType?: string;
      source?: string;
      updatePolicy?: string;
    }>(join(libraryDir, ".agentenv-skill.json"))).toMatchObject({
      sourceType: "github",
      source: `https://github.com/acme/browser-skills/tree/main/skills/${skillId}`,
      updatePolicy: "tracked"
    });
    expect((await lstat(targetDir)).isSymbolicLink()).toBe(true);
  }, 30_000);

  it("keeps all three conflicting Target copies after a stale cleanup error", async () => {
    const { opencodeDir, codexDir, claudeDir, page } = await launchApp({
      includeClaudeTarget: true
    });
    const skillId = "three-target-conflict";
    const copies = [
      join(opencodeDir, "skills", skillId),
      join(codexDir, "skills", skillId),
      join(claudeDir, "skills", skillId)
    ];
    for (const [index, path] of copies.entries()) {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, "SKILL.md"), `# Target version ${index + 1}\n`);
    }

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local" }).click();
    const group = page.getByRole("group", { name: `Cleanup group ${skillId}` });
    await group.waitFor({ state: "visible" });
    await expect.poll(() => group.textContent()).toContain("3 locations");
    await expect.poll(() => group.textContent()).toContain("Conflict");

    await group.getByRole("button", { name: `Add to Library ${skillId}` }).click();
    let dialog = page.getByRole("dialog", { name: "Review skill cleanup" });
    await dialog.waitFor({ state: "visible" });
    await writeFile(join(copies[1], "SKILL.md"), "# Target version changed after preview\n");
    await dialog.getByRole("button", { name: "Add to Library" }).click();
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(() => page.locator(".app-feedback").textContent()).toContain(
      "changed after the cleanup preview"
    );
    await expect.poll(() => group.textContent()).toContain("3 locations");
    await expect.poll(() => group.textContent()).toContain("Conflict");
    for (const path of copies) {
      await expect(fileExists(join(path, "SKILL.md"))).resolves.toBe(true);
    }
  }, 45_000);

  it("refreshes Skills in place without clearing the current view", async () => {
    const { appDataRoot, page } = await launchApp();
    const search = page.getByRole("textbox", { name: "Search skills" });
    await search.waitFor({ state: "visible" });

    const shortcutSkill = join(appDataRoot, "skills-library", "refresh-shortcut");
    await mkdir(shortcutSkill, { recursive: true });
    await writeFile(
      join(shortcutSkill, "SKILL.md"),
      "---\nname: Refresh Shortcut\ndescription: Added outside the app.\n---\n",
      "utf8"
    );
    await search.fill("Refresh Shortcut");
    await page.keyboard.press("Meta+R");

    await page.getByRole("group", { name: "Library item refresh-shortcut" }).waitFor({
      state: "visible"
    });
    await expect.poll(() => search.inputValue()).toBe("Refresh Shortcut");
    await page.getByText("Skills refreshed", { exact: true }).waitFor({ state: "visible" });

    const buttonSkill = join(appDataRoot, "skills-library", "refresh-button");
    await mkdir(buttonSkill, { recursive: true });
    await writeFile(
      join(buttonSkill, "SKILL.md"),
      "---\nname: Refresh Button\ndescription: Added for the toolbar refresh.\n---\n",
      "utf8"
    );
    await search.fill("Refresh Button");
    await page.getByRole("button", { name: "Refresh skills" }).click();

    await page.getByRole("group", { name: "Library item refresh-button" }).waitFor({
      state: "visible"
    });
    await expect.poll(() => search.inputValue()).toBe("Refresh Button");
  }, 30_000);

  it("persists custom Skill and Profile icons through the rendered app", async () => {
    const { appDataRoot, page } = await launchApp();
    const skillRow = page.getByRole("group", { name: "Library item shared-reviewer" });
    const skillIcon = skillRow.getByRole("button", { name: "Change icon for Shared Reviewer" });
    expect(await skillIcon.getAttribute("data-icon")).toBe("folder");
    await skillIcon.click();
    await page
      .getByRole("menu", { name: "Icons for Shared Reviewer" })
      .getByRole("menuitemradio", { name: "Shield" })
      .click();
    await expect
      .poll(async () =>
        (await readJson<{ iconKey?: string }>(
          join(appDataRoot, "skills-library", "shared-reviewer", ".agentenv-skill.json")
        )).iconKey
      )
      .toBe("shield");
    await expect.poll(() => skillIcon.getAttribute("data-icon")).toBe("shield");

    await selectProfile(page, "UI OpenCode alpha");
    const profileRow = page.getByRole("group", { name: "Profile UI OpenCode alpha" });
    await profileRow
      .getByRole("button", { name: "Change icon for profile ui-opencode-alpha" })
      .click();
    await page
      .getByRole("menu", { name: "Icons for UI OpenCode alpha" })
      .getByRole("menuitemradio", { name: "Design" })
      .click();
    expect(await page.getByRole("button", { name: "Save", exact: true }).isDisabled()).toBe(true);
    await expect.poll(async () =>
      (await readJson<{ iconKey?: string }>(
        join(appDataRoot, "profiles", "ui-opencode-alpha", "profile.json")
      )).iconKey
    ).toBe("palette");
  }, 30_000);

  it("adds and removes reusable MCP servers through the rendered MCP library", async () => {
    const { appDataRoot, page } = await launchApp();
    const mcpLibraryPath = join(appDataRoot, "mcp-library.json");

    await page.getByRole("button", { name: "MCPs" }).click();
    await page.getByRole("region", { name: "MCP library" }).waitFor({ state: "visible" });
    const sharedMcpRow = page.getByRole("group", { name: "MCP library item shared-docs" });
    expect(await sharedMcpRow.locator(".resource-chip").count()).toBe(0);
    expect(await sharedMcpRow.locator(".mcp-row-icon .lucide-network").count()).toBe(1);
    await sharedMcpRow.getByRole("button", { name: "More actions for shared-docs" }).click();
    await page.getByRole("menuitem", { name: "Review profiles" }).click();
    await page.getByRole("heading", { name: "Profiles", exact: true }).waitFor();
    await page.getByRole("button", { name: "MCPs", exact: true }).click();
    await page.getByRole("button", { name: "Add MCP" }).click();
    await page.getByLabel("MCP library id").fill("local-search");
    await page.getByLabel("MCP library name").fill("Local Search");
    await page.getByLabel("MCP command").fill("node");
    await page.getByLabel("MCP args").fill("server.js\n--stdio");
    await page.getByLabel("MCP env").fill("SEARCH_TOKEN\nAGENTENV_CACHE_DIR");
    await page.getByRole("button", { name: "Add to library" }).click();

    const localSearch = page.getByRole("group", { name: "MCP library item local-search" });
    await localSearch.waitFor({ state: "visible" });
    await expect.poll(() => localSearch.textContent()).toContain("node server.js --stdio");
    await expect.poll(() => localSearch.textContent()).toContain("2 env variables");
    await expect
      .poll(async () =>
        readJson<
          Array<{ id: string; command?: string; args?: string[]; env?: Record<string, string> }>
        >(mcpLibraryPath)
      )
      .toContainEqual(
        expect.objectContaining({
          id: "local-search",
          command: "node",
          args: ["server.js", "--stdio"],
          env: {
            AGENTENV_CACHE_DIR: "AGENTENV_CACHE_DIR",
            SEARCH_TOKEN: "SEARCH_TOKEN"
          }
        })
      );

    await localSearch.getByRole("button", { name: "More actions for local-search" }).click();
    await page.getByRole("menuitem", { name: "Edit local-search" }).click();
    await expect.poll(() => page.getByLabel("MCP library id").inputValue()).toBe("local-search");
    expect(await page.getByLabel("MCP library id").isDisabled()).toBe(true);
    await expect.poll(() => page.getByLabel("MCP args").inputValue()).toBe("server.js\n--stdio");
    await page.getByRole("button", { name: "Close MCP editor" }).click();

    await page.getByRole("button", { name: "Add MCP" }).click();
    await page.getByLabel("MCP library id").fill("local-search");
    await expect
      .poll(() => page.getByRole("dialog", { name: "MCP editor" }).textContent())
      .toContain("This ID already exists");
    expect(await page.getByRole("button", { name: "Add to library" }).isDisabled()).toBe(true);
    await page.keyboard.press("Escape");

    await localSearch.getByRole("button", { name: "More actions for local-search" }).click();
    await page.getByRole("menuitem", { name: "Remove local-search" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete MCP" });
    await deleteDialog.waitFor({ state: "visible" });
    await expect.poll(() => deleteDialog.textContent()).toContain("Local Search");
    await deleteDialog.getByRole("button", { name: "Delete MCP" }).click();
    await localSearch.waitFor({ state: "detached" });
    await expect
      .poll(async () =>
        (await readJson<Array<{ id: string }>>(mcpLibraryPath)).some(
          (server) => server.id === "local-search"
        )
      )
      .toBe(false);
  }, 30_000);

  it("installs a shared library skill into an OpenCode profile from the rendered app", async () => {
    const { librarySkill, opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    await addLibrarySkillToProfile(page);
    await page
      .getByRole("listitem", { name: "Profile skill shared-reviewer" })
      .waitFor({ state: "visible" });
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    const installedSkillDir = join(
      opencodeDir,
      "skills",
      "shared-reviewer"
    );
    const installedSkillMd = join(installedSkillDir, "SKILL.md");
    await expect(readFile(installedSkillMd, "utf8")).resolves.toContain(
      "Review code changes before applying them."
    );
    expect((await lstat(installedSkillDir)).isSymbolicLink()).toBe(true);
    await expect(readlink(installedSkillDir)).resolves.toBe(librarySkill.libraryDir);
    await expect(
      readFile(
        `${installedSkillDir}.agentenv-owner.json`,
        "utf8"
      )
    ).resolves.toContain('"source": "skills-library/shared-reviewer"');
  }, 30_000);

  it("detects and applies updates after a library skill is installed on OpenCode", async () => {
    const { librarySkill, opencodeDir, page } = await launchApp();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Global skill sync method").selectOption("copy");
    const autoCheck = page.getByRole("switch", { name: "Skill auto update check" });
    if ((await autoCheck.getAttribute("aria-checked")) === "true") {
      await autoCheck.click();
    }
    await expect.poll(() => autoCheck.getAttribute("aria-checked")).toBe("false");
    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    await addLibrarySkillToProfile(page);
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    const installedSkillMd = join(opencodeDir, "skills", "shared-reviewer", "SKILL.md");
    await expect(readFile(installedSkillMd, "utf8")).resolves.toContain(
      "Review code changes before applying them."
    );

    await writeFile(
      join(librarySkill.sourceDir, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: Installed update guidance.\n---\n\n# Shared Reviewer\n\nUse the installed update path.\n",
      "utf8"
    );
    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Check updates" }).click();
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByRole("button", { name: "Review update shared-reviewer" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Review update shared-reviewer" }).click();
    await page
      .getByRole("dialog", { name: "Update preview for shared-reviewer" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Apply update shared-reviewer" }).click();
    await expect.poll(() => page.getByRole("status").textContent()).toContain("Updated shared-reviewer");
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByText("Installed update guidance.")
      .waitFor({ state: "visible" });

    await expect(readFile(installedSkillMd, "utf8")).resolves.not.toContain(
      "Use the installed update path."
    );
    await page.setViewportSize({ width: 920, height: 620 });
    const updatedRow = page.getByRole("group", { name: "Library item shared-reviewer" });
    await updatedRow.getByText("1 out of sync").waitFor({ state: "visible" });
    const installActionGeometry = await updatedRow.evaluate((element) => {
      const status = element.querySelector<HTMLElement>(".library-status-cell")!;
      const actions = element.querySelector<HTMLElement>(".library-actions-cell")!;
      const syncButton = status.querySelector<HTMLElement>(".library-status-action")!;
      const syncDetail = status.querySelector<HTMLElement>(".library-status-detail")!;
      const statusBox = status.getBoundingClientRect();
      const actionsBox = actions.getBoundingClientRect();
      const buttonBox = syncButton.getBoundingClientRect();
      const detailBox = syncDetail.getBoundingClientRect();
      return {
        columnGap: actionsBox.left - statusBox.right,
        detailClearance: detailBox.top - buttonBox.bottom,
        verticalOverlap: buttonBox.bottom > detailBox.top
      };
    });
    expect(installActionGeometry.columnGap).toBeGreaterThanOrEqual(0);
    expect(installActionGeometry.detailClearance).toBeGreaterThanOrEqual(3);
    expect(installActionGeometry.verticalOverlap).toBe(false);
    await updatedRow.getByRole("button", { name: "Sync install of shared-reviewer" }).click();
    await updatedRow.getByText("Up to date").waitFor({ state: "visible" });
    await expect(readFile(installedSkillMd, "utf8")).resolves.toContain(
      "Use the installed update path."
    );
  }, 30_000);

  it("keeps the five Skill lanes aligned across status actions and supported widths", async () => {
    const { appDataRoot, librarySkill, page } = await launchApp();
    const staticSkillDir = join(appDataRoot, "skills-library", "static-layout-reference");
    await mkdir(staticSkillDir, { recursive: true });
    await writeFile(
      join(staticSkillDir, "SKILL.md"),
      "---\nname: Static Layout Reference\ndescription: A stable row without a contextual update action.\n---\n\n# Static Layout Reference\n",
      "utf8"
    );
    await writeFile(
      join(librarySkill.sourceDir, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: Layout update available.\n---\n\n# Shared Reviewer\n\nUpdated layout fixture.\n",
      "utf8"
    );

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Refresh skills" }).click();
    await page.getByRole("button", { name: "Check updates" }).click();
    const updateRow = page.getByRole("group", { name: "Library item shared-reviewer" });
    const staticRow = page.getByRole("group", { name: "Library item static-layout-reference" });
    await updateRow
      .getByRole("button", { name: "Review update shared-reviewer" })
      .waitFor({ state: "visible" });
    await staticRow.waitFor({ state: "visible" });
    await resizeAppWindow(page, 1180, 728);

    const defaultGeometry = await page.evaluate(() => {
      const head = document.querySelector<HTMLElement>(".skill-library-panel .library-table__head");
      const rows = [
        document.querySelector<HTMLElement>('[aria-label="Library item shared-reviewer"]'),
        document.querySelector<HTMLElement>('[aria-label="Library item static-layout-reference"]')
      ];
      const cellSelectors = [
        ".library-resource-cell",
        ".library-source-cell",
        ".library-usage-cell",
        ".library-status-cell",
        ".library-actions-cell"
      ];
      const headerCells = head ? Array.from(head.children) as HTMLElement[] : [];
      const headerLefts = headerCells.slice(0, 4).map((cell) => cell.getBoundingClientRect().left);
      const headerActionsRight = headerCells[4]?.getBoundingClientRect().right ?? -1;
      const rowMetrics = rows.map((row) => {
        const cells = cellSelectors.map((selector) => row?.querySelector<HTMLElement>(selector));
        const actions = row?.querySelector<HTMLElement>(".library-actions-cell");
        const status = row?.querySelector<HTMLElement>(".library-status-cell");
        const primary = [
          row?.querySelector<HTMLElement>(".library-source-primary"),
          row?.querySelector<HTMLElement>(".library-usage-cell .usage-summary"),
          row?.querySelector<HTMLElement>(".library-primary-status, .library-status-action")
        ].filter((item): item is HTMLElement => Boolean(item));
        const secondary = [
          row?.querySelector<HTMLElement>(".library-source-meta"),
          row?.querySelector<HTMLElement>(".library-usage-detail"),
          row?.querySelector<HTMLElement>(".library-status-detail")
        ].filter((item): item is HTMLElement => Boolean(item));
        const rowBox = row?.getBoundingClientRect();
        const actionBox = actions?.getBoundingClientRect();
        const statusBox = status?.getBoundingClientRect();
        return {
          actionsRight: actionBox?.right ?? -1,
          cellLefts: cells.slice(0, 4).map((cell) => cell?.getBoundingClientRect().left ?? -1),
          actionsLeft: actionBox?.left ?? -1,
          actionGap: actionBox && statusBox ? actionBox.left - statusBox.right : -1,
          childrenFit: Boolean(rowBox) && Array.from(row!.children).every((child) => {
            const box = child.getBoundingClientRect();
            return box.left >= rowBox!.left - 1 && box.right <= rowBox!.right + 1;
          }),
          primaryTops: primary.map((item) => item.getBoundingClientRect().top),
          rowHeight: rowBox?.height ?? -1,
          secondaryTops: secondary.map((item) => item.getBoundingClientRect().top),
          statusOverflow: (() => {
            const label = row?.querySelector<HTMLElement>(".library-status-cell .library-status-action > span, .library-status-cell .library-primary-status > span");
            return label ? label.scrollWidth - label.clientWidth : 0;
          })()
        };
      });
      return {
        containerName: getComputedStyle(document.querySelector<HTMLElement>(".skill-library-panel")!).containerName,
        headerDisplay: head ? getComputedStyle(head).display : "missing",
        headerActionsRight,
        headerLefts,
        rowMetrics,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth
      };
    });

    expect(defaultGeometry.documentWidth).toBe(defaultGeometry.viewportWidth);
    expect(defaultGeometry.containerName).toBe("skill-library");
    expect(defaultGeometry.headerDisplay).toBe("grid");
    for (const row of defaultGeometry.rowMetrics) {
      row.cellLefts.forEach((left, index) => {
        expect(Math.abs(left - defaultGeometry.headerLefts[index]!)).toBeLessThanOrEqual(1);
      });
      expect(row.childrenFit).toBe(true);
      expect(Math.abs(row.actionsRight - defaultGeometry.headerActionsRight)).toBeLessThanOrEqual(1);
      expect(row.actionGap).toBeGreaterThanOrEqual(9);
      expect(row.statusOverflow).toBeLessThanOrEqual(1);
      expect(Math.max(...row.primaryTops) - Math.min(...row.primaryTops)).toBeLessThanOrEqual(1);
      expect(Math.max(...row.secondaryTops) - Math.min(...row.secondaryTops)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(defaultGeometry.rowMetrics[0]!.rowHeight - defaultGeometry.rowMetrics[1]!.rowHeight)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(defaultGeometry.rowMetrics[0]!.actionsLeft - defaultGeometry.rowMetrics[1]!.actionsLeft)
    ).toBeLessThanOrEqual(1);

    await resizeAppWindow(page, 920, 620);
    const compactGeometry = await updateRow.evaluate((row) => {
      const actions = row.querySelector<HTMLElement>(".library-actions-cell")!.getBoundingClientRect();
      const status = row.querySelector<HTMLElement>(".library-status-cell")!.getBoundingClientRect();
      const head = document.querySelector<HTMLElement>(".skill-library-panel .library-table__head")!;
      const statusLabel = row.querySelector<HTMLElement>(".library-status-action > span")!;
      return {
        actionGap: actions.left - status.right,
        documentWidth: document.documentElement.scrollWidth,
        headerColumns: head.children.length,
        headerDisplay: getComputedStyle(head).display,
        rowHeight: row.getBoundingClientRect().height,
        statusOverflow: statusLabel.scrollWidth - statusLabel.clientWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(compactGeometry.documentWidth).toBe(compactGeometry.viewportWidth);
    expect(compactGeometry.actionGap).toBeGreaterThanOrEqual(9);
    expect(compactGeometry.headerDisplay).toBe("grid");
    expect(compactGeometry.headerColumns).toBe(5);
    expect(compactGeometry.rowHeight).toBeLessThanOrEqual(68);
    expect(compactGeometry.statusOverflow).toBeLessThanOrEqual(1);
  }, 30_000);

  it("updates all available library skill updates from the rendered app", async () => {
    const { appDataRoot, librarySkill, page } = await launchApp();
    const helperSkill = await writeTrackedLibrarySkill(
      appDataRoot,
      "batch-helper",
      "Batch helper v1.",
      "Batch helper v2."
    );

    await writeFile(
      join(librarySkill.sourceDir, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: Batch shared v2.\n---\n\n# Shared Reviewer\n\nBatch updated shared content.\n",
      "utf8"
    );
    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Check updates" }).click();
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByRole("button", { name: "Review update shared-reviewer" })
      .waitFor({ state: "visible" });
    await page
      .getByRole("group", { name: "Library item batch-helper" })
      .getByRole("button", { name: "Review update batch-helper" })
      .waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Update all skills" }).click();
    const bulkUpdateDialog = page.getByRole("dialog", { name: "Review all skill updates" });
    await bulkUpdateDialog.waitFor({ state: "visible" });
    await bulkUpdateDialog.getByRole("button", { name: "Apply 2 updates" }).click();
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByText("Batch shared v2.")
      .waitFor({ state: "visible" });
    await page
      .getByRole("group", { name: "Library item batch-helper" })
      .getByText("Batch helper v2.")
      .waitFor({ state: "visible" });

    await expect(readFile(join(librarySkill.libraryDir, "SKILL.md"), "utf8")).resolves.toContain(
      "Batch updated shared content."
    );
    await expect(readFile(join(helperSkill.libraryDir, "SKILL.md"), "utf8")).resolves.toContain(
      "Updated content."
    );
  }, 30_000);

  it("keeps successful skill updates when another bulk update source disappears", async () => {
    const { appDataRoot, librarySkill, page } = await launchApp();
    const missingSourceSkill = await writeTrackedLibrarySkill(
      appDataRoot,
      "missing-source-helper",
      "Missing source helper v1.",
      "Missing source helper v2."
    );

    await writeFile(
      join(librarySkill.sourceDir, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: Partial bulk v2.\n---\n\n# Shared Reviewer\n\nSuccessful partial update.\n",
      "utf8"
    );
    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Check updates" }).click();
    await page.getByRole("button", { name: "Update all skills" }).click();
    const bulkUpdateDialog = page.getByRole("dialog", { name: "Review all skill updates" });
    await bulkUpdateDialog.waitFor({ state: "visible" });

    await rm(missingSourceSkill.sourceDir, { recursive: true, force: true });
    await bulkUpdateDialog.getByRole("button", { name: "Apply 2 updates" }).click();

    const feedback = page.getByRole("alert");
    await expect.poll(() => feedback.textContent()).toContain("1 update failed");
    await expect.poll(() => feedback.textContent()).toContain("source");
    await expect(readFile(join(librarySkill.libraryDir, "SKILL.md"), "utf8")).resolves.toContain(
      "Successful partial update."
    );
    await expect(
      readFile(join(missingSourceSkill.libraryDir, "SKILL.md"), "utf8")
    ).resolves.toContain("Missing source helper v1.");
  }, 30_000);

  it("backs up and restores AgentEnv data through system directory pickers", async () => {
    const { appDataRoot, page } = await launchApp();
    const backupRoot = join(root, "exported-backups");
    const instructionsPath = join(appDataRoot, "profiles", "ui-opencode-alpha", "AGENTS.md");
    const originalInstructions = await readFile(instructionsPath, "utf8");
    await mkdir(backupRoot, { recursive: true });

    await app!.evaluate(
      ({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selectedPath],
          bookmarks: []
        });
      },
      backupRoot
    );
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Export data" }).click();
    await expect.poll(() => page.getByRole("status").textContent()).toContain(
      "Data export created"
    );

    const backupEntries = await readdir(backupRoot);
    expect(backupEntries).toHaveLength(1);
    const backupPath = join(backupRoot, backupEntries[0] ?? "");
    expect((await stat(backupPath)).mode & 0o777).toBe(0o700);
    await expect(fileExists(join(backupPath, "agentenv-backup.json"))).resolves.toBe(true);

    await writeFile(instructionsPath, "# Changed after backup\n", "utf8");
    await writeFile(join(appDataRoot, "restore-me-away.json"), "{}\n", "utf8");
    await app!.evaluate(
      ({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selectedPath],
          bookmarks: []
        });
      },
      backupPath
    );
    await page.getByRole("button", { name: "Restore data" }).click();
    const restoreDialog = page.getByRole("dialog", { name: "Restore AgentEnv data" });
    await restoreDialog.waitFor({ state: "visible" });
    await expect.poll(() => restoreDialog.textContent()).toContain("Version 1");
    await restoreDialog.getByRole("button", { name: "Restore data" }).click();
    await restoreDialog.waitFor({ state: "hidden" });

    await expect(readFile(instructionsPath, "utf8")).resolves.toBe(originalInstructions);
    await expect(fileExists(join(appDataRoot, "restore-me-away.json"))).resolves.toBe(false);
    await expect.poll(() => page.getByRole("status").textContent()).toContain(
      "AgentEnv data restored"
    );
    const safetyRoot = join(root, "agentenv-import-safety");
    expect((await readdir(safetyRoot)).length).toBeGreaterThan(0);
  }, 30_000);

  it("shows backup usage and deletes individual or retention-eligible recovery points", async () => {
    const { appDataRoot, page } = await launchApp();
    const backupsRoot = join(appDataRoot, "backups");
    const writeBackup = async (id: string, createdAt: string, profileName: string) => {
      const backupDir = join(backupsRoot, id);
      await mkdir(backupDir, { recursive: true });
      await writeFile(join(backupDir, "manifest.json"), JSON.stringify({
        id,
        createdAt,
        operation: "apply",
        targetId: "cleanup-target",
        profileId: "daily-coding",
        profileName,
        entries: []
      }));
      return backupDir;
    };
    const manualDeleteDir = await writeBackup(
      "2025-01-01T00-00-00-000Z",
      "2025-01-01T00:00:00.000Z",
      "Old Manual"
    );
    const policyDeleteDir = await writeBackup(
      "2025-02-01T00-00-00-000Z",
      "2025-02-01T00:00:00.000Z",
      "Old Cleanup"
    );
    const retainedDir = await writeBackup(
      "2099-01-01T00-00-00-000Z",
      "2099-01-01T00:00:00.000Z",
      "Latest Recovery"
    );

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Backup retention").selectOption("30");
    await expect.poll(() => page.getByLabel("Backup retention").inputValue()).toBe("30");
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "Manage Backups" });
    await manager.waitFor({ state: "visible" });
    await expectInViewport(page, manager);
    await expectNoHorizontalOverflow(page, [".backup-manager-dialog"]);
    await expectTextFits(manager.getByRole("button", { name: "Clean up now" }));
    await page.setViewportSize({ width: 920, height: 620 });
    await expectInViewport(page, manager);
    await expectNoHorizontalOverflow(page, [".backup-manager-dialog"]);
    await expectTextFits(manager.getByRole("button", { name: "Clean up now" }));
    await expect.poll(() => manager.textContent()).toContain("3 backups");
    await manager.getByRole("button", {
      name: "Delete backup Old Manual · cleanup-target"
    }).click();
    await manager.getByRole("button", { name: "Delete backup", exact: true }).click();
    await expect.poll(() => fileExists(manualDeleteDir)).toBe(false);

    await manager.getByRole("button", { name: "Clean up now" }).click();
    await manager.getByRole("button", { name: "Clean up 1 backup" }).click();
    await expect.poll(() => fileExists(policyDeleteDir)).toBe(false);
    await expect(fileExists(retainedDir)).resolves.toBe(true);
    await expect.poll(() => manager.textContent()).toContain("1 backup");
  }, 30_000);

  it("installs library skills using copy mode from Settings", async () => {
    const { opencodeDir, page } = await launchApp();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Global skill sync method").selectOption("copy");
    await expect
      .poll(() => page.getByLabel("Global skill sync method").inputValue())
      .toBe("copy");

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    await addLibrarySkillToProfile(page);
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    const installedSkillMd = join(opencodeDir, "skills", "shared-reviewer", "SKILL.md");
    await expect(readFile(installedSkillMd, "utf8")).resolves.toContain(
      "Review code changes before applying them."
    );
    expect((await lstat(installedSkillMd)).isSymbolicLink()).toBe(false);
  }, 30_000);

  it("keeps canonical skills in app data while installing Target-specific runtime copies", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect.poll(() => page.getByLabel("Global skill storage location").textContent())
      .toBe("AgentEnv data");
    const canonicalSkillMd = join(appDataRoot, "skills-library", "shared-reviewer", "SKILL.md");
    const runtimeSkillMd = join(opencodeDir, "skills", "shared-reviewer", "SKILL.md");
    await expect(fileExists(canonicalSkillMd)).resolves.toBe(true);
    await expect(
      fileExists(runtimeSkillMd)
    ).resolves.toBe(false);

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    await addLibrarySkillToProfile(page);
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    await expect(readFile(runtimeSkillMd, "utf8")).resolves.toBe(
      await readFile(canonicalSkillMd, "utf8")
    );
    await expect(fileExists(canonicalSkillMd)).resolves.toBe(true);
  }, 30_000);

  it("captures a Profile from the live OpenCode Target without taking it over", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    const conflictingTargetSkill = join(opencodeDir, "skills", "shared-reviewer");
    await mkdir(conflictingTargetSkill, { recursive: true });
    await writeFile(
      join(conflictingTargetSkill, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: Target-specific version.\n---\n\n# Target version\n",
      "utf8"
    );
    await resizeAppWindow(page, 920, 620);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    const targetCard = page.getByRole("article", { name: "Agent OpenCode" });
    const captureButton = targetCard.getByRole("button", { name: "Create profile from OpenCode" });
    await captureButton.click();

    let dialog = page.getByRole("dialog", { name: "Create profile from OpenCode" });
    await dialog.waitFor({ state: "visible" });
    await expect.poll(() => page.getByRole("region", { name: "Agents", exact: true }).isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(() => captureButton.evaluate((element) => document.activeElement === element)).toBe(true);

    await captureButton.click();
    dialog = page.getByRole("dialog", { name: "Create profile from OpenCode" });
    await dialog.getByRole("button", { name: "Review" }).click();

    dialog = page.getByRole("dialog", { name: "Review OpenCode capture" });
    const impact = dialog.getByRole("region", { name: "Capture impact" });
    await expect.poll(() => impact.textContent()).toContain("target-only-reviewer");
    await expect.poll(() => impact.textContent()).toContain(
      "Import Agent copy as opencode-shared-reviewer; existing same-name Library Skill stays unchanged"
    );
    const captureGeometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const footer = element.querySelector<HTMLElement>(".capture-dialog__footer")?.getBoundingClientRect();
      const confirm = element.querySelector<HTMLButtonElement>(".capture-dialog__footer .primary-action")?.getBoundingClientRect();
      const body = element.querySelector<HTMLElement>(".capture-dialog__body");
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        footerTop: footer?.top ?? 0,
        footerBottom: footer?.bottom ?? 0,
        confirmBottom: confirm?.bottom ?? 0,
        dialogOverflow: getComputedStyle(element).overflowY,
        bodyOverflow: body ? getComputedStyle(body).overflowY : ""
      };
    });
    expect(captureGeometry.left).toBeGreaterThanOrEqual(0);
    expect(captureGeometry.right).toBeLessThanOrEqual(920);
    expect(captureGeometry.top).toBeGreaterThanOrEqual(0);
    expect(captureGeometry.bottom).toBeLessThanOrEqual(620);
    expect(captureGeometry.footerTop).toBeGreaterThanOrEqual(captureGeometry.top);
    expect(captureGeometry.footerBottom).toBeLessThanOrEqual(captureGeometry.bottom);
    expect(captureGeometry.confirmBottom).toBeLessThanOrEqual(captureGeometry.bottom);
    expect(captureGeometry.dialogOverflow).toBe("hidden");
    expect(captureGeometry.bodyOverflow).toBe("auto");
    await dialog.getByRole("button", { name: "Save Profile" }).click();
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(() => page.locator(".app-feedback").textContent()).toContain(
      "OpenCode Current created. Agent unchanged."
    );

    await expect(
      readFile(join(appDataRoot, "skills-library", "target-only-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("Migrate me into the shared library.");
    await expect(
      readFile(join(appDataRoot, "skills-library", "shared-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("Review code changes before applying them.");
    await expect(
      readFile(join(appDataRoot, "skills-library", "opencode-shared-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("# Target version");
    const capturedSkillMetadata = await readJson<{ contentHash: string }>(
      join(appDataRoot, "skills-library", "target-only-reviewer", ".agentenv-skill.json")
    );
    await expect(
      readFile(join(opencodeDir, "skills", "target-only-reviewer", ".agentenv-owner.json"), "utf8")
    ).rejects.toThrow();
    const manifests = await Promise.all(
      (await readdir(join(appDataRoot, "profiles"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => readJson<{ id: string; name: string }>(join(appDataRoot, "profiles", entry.name, "profile.json")))
    );
    const captured = manifests.find((manifest) => manifest.name === "OpenCode Current");
    expect(captured?.id).toBeTruthy();
    await expect(fileExists(join(appDataRoot, "target-states", "opencode.json"))).resolves.toBe(false);

    await page.getByRole("button", { name: "Profiles", exact: true }).click();
    await selectProfile(page, "OpenCode Current");
    await expandComposerSection(page, "Skills");
    const capturedSkillRow = page.getByRole("listitem", {
      name: "Profile skill target-only-reviewer"
    });
    await expect.poll(() => capturedSkillRow.textContent()).toContain(
      `Library revision ${capturedSkillMetadata.contentHash.slice(0, 7)}`
    );
    await expect.poll(() => capturedSkillRow.textContent()).not.toContain("Not tracked");
  }, 30_000);

  it("keeps capture actions visible with long, high-density review content", async () => {
    const { app: electronApp, page } = await launchApp();
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("profiles:preview-create-from-target");
      ipcMain.handle("profiles:preview-create-from-target", async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return {
          id: "dense-capture-preview",
          targetId: "opencode",
          targetName: "OpenCode",
          suggestedName: "OpenCode Current",
          createdAt: "2026-07-14T00:00:00.000Z",
          resources: Array.from({ length: 30 }, (_, index) => ({
            kind: index === 0 ? "instructions" : "skill",
            id: `dense-capture-resource-${index + 1}`,
            name: `dense-capture-resource-${index + 1}-with-a-long-name`,
            action: index === 0 ? "include" : "import",
            detail: index > 0 && index < 7
              ? "Source copy stays unchanged"
              : "A deliberately long path and description used to verify compact window containment"
          })),
          warnings: Array.from(
            { length: 6 },
            (_, index) => `dense-capture-resource-${index + 1}: compatibility copies stay in place until every installed consumer has an equivalent managed Skill`
          ),
          errors: []
        };
      });
    });
    await resizeAppWindow(page, 920, 620);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page
      .getByRole("article", { name: "Agent OpenCode" })
      .getByRole("button", { name: "Create profile from OpenCode" })
      .click();
    const setupDialog = page.getByRole("dialog", { name: "Create profile from OpenCode" });
    const reviewButton = setupDialog.getByRole("button", { name: "Review" });
    const idleButtonBox = await reviewButton.boundingBox();
    await reviewButton.click();
    const reviewingButton = setupDialog.getByRole("button", { name: "Reviewing..." });
    await reviewingButton.waitFor({ state: "visible" });
    expect(await reviewingButton.getAttribute("aria-busy")).toBe("true");
    expect(await reviewingButton.isDisabled()).toBe(true);
    const workingState = await reviewingButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const spinner = element.querySelector("svg");
      return {
        width: rect.width,
        height: rect.height,
        animationName: spinner ? getComputedStyle(spinner).animationName : ""
      };
    });
    expect(workingState.width).toBe(idleButtonBox?.width);
    expect(workingState.height).toBe(idleButtonBox?.height);
    expect(workingState.animationName).toBe("spin");

    const dialog = page.getByRole("dialog", { name: "Review OpenCode capture" });
    const impact = dialog.getByRole("region", { name: "Capture impact" });
    await expect.poll(() => impact.textContent()).toContain("dense-capture-resource-30");
    await expect.poll(() => impact.textContent()).toContain("6 items will remain outside AgentEnv");
    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const footer = element.querySelector<HTMLElement>(".capture-dialog__footer")?.getBoundingClientRect();
      const confirm = element.querySelector<HTMLButtonElement>(".capture-dialog__footer .primary-action")?.getBoundingClientRect();
      const body = element.querySelector<HTMLElement>(".capture-dialog__body");
      return {
        top: rect.top,
        bottom: rect.bottom,
        footerTop: footer?.top ?? 0,
        footerBottom: footer?.bottom ?? 0,
        confirmBottom: confirm?.bottom ?? 0,
        dialogOverflow: getComputedStyle(element).overflowY,
        bodyOverflow: body ? getComputedStyle(body).overflowY : "",
        bodyScrollable: body ? body.scrollHeight > body.clientHeight : false,
        nestedScrollers: Array.from(element.querySelectorAll<HTMLElement>("*"))
          .filter((item) => {
            const style = getComputedStyle(item);
            return item !== body && /(auto|scroll)/.test(style.overflowY) && item.scrollHeight > item.clientHeight;
          }).length
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(620);
    expect(geometry.footerTop).toBeGreaterThanOrEqual(geometry.top);
    expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.bottom);
    expect(geometry.confirmBottom).toBeLessThanOrEqual(geometry.bottom);
    expect(geometry.dialogOverflow).toBe("hidden");
    expect(geometry.bodyOverflow).toBe("auto");
    expect(geometry.bodyScrollable).toBe(true);
    expect(geometry.nestedScrollers).toBe(0);
    await dialog.getByRole("button", { name: "Back" }).click();
    await expect.poll(() => page.getByLabel("Profile name").inputValue()).toBe("OpenCode Current");
    await page.keyboard.press("Escape");
  }, 30_000);

  it("persists skill background update check settings from Settings", async () => {
    const { appDataRoot, page } = await launchApp();

    await page.getByRole("button", { name: "Settings" }).click();
    const autoCheck = page.getByRole("switch", { name: "Skill auto update check" });
    const interval = page.getByLabel("Skill auto check interval minutes");
    const assertAutoCheckLayout = async () => {
      const geometry = await autoCheck.evaluate((switchControl) => {
        const autoRow = switchControl.closest<HTMLElement>(".settings-preference-row")!;
        const intervalControl = document.querySelector<HTMLElement>(".settings-interval-control")!;
        const intervalRow = intervalControl.closest<HTMLElement>(".settings-preference-row")!;
        const title = autoRow.querySelector<HTMLElement>(".settings-preference-copy strong")!;
        const autoRowRect = autoRow.getBoundingClientRect();
        const intervalRowRect = intervalRow.getBoundingClientRect();
        const intervalRect = intervalControl.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const switchRect = switchControl.getBoundingClientRect();
        return {
          autoRowRight: autoRowRect.right,
          autoRowTop: autoRowRect.top,
          autoRowBottom: autoRowRect.bottom,
          intervalRowRight: intervalRowRect.right,
          titleRight: titleRect.right,
          intervalLeft: intervalRect.left,
          intervalRight: intervalRect.right,
          switchLeft: switchRect.left,
          switchRight: switchRect.right,
          switchTop: switchRect.top,
          switchBottom: switchRect.bottom
        };
      });
      expect(geometry.switchLeft).toBeGreaterThanOrEqual(geometry.titleRight + 8);
      expect(geometry.switchRight).toBeLessThanOrEqual(geometry.autoRowRight);
      expect(geometry.intervalRight).toBeLessThanOrEqual(geometry.intervalRowRight);
      expect(Math.abs(geometry.switchRight - geometry.intervalRight)).toBeLessThanOrEqual(1);
      expect(geometry.switchTop).toBeGreaterThanOrEqual(geometry.autoRowTop);
      expect(geometry.switchBottom).toBeLessThanOrEqual(geometry.autoRowBottom);
      expect(geometry.intervalLeft).toBeGreaterThan(geometry.titleRight);
    };
    await assertAutoCheckLayout();
    await page.setViewportSize({ width: 920, height: 620 });
    await assertAutoCheckLayout();
    await expectNoHorizontalOverflow(page, [".app-shell", ".editor-panel", ".settings-page"]);
    await expect.poll(() => autoCheck.getAttribute("aria-checked")).toBe("true");
    await autoCheck.click();
    await expect.poll(() => autoCheck.getAttribute("aria-checked")).toBe("false");
    await expect.poll(() => interval.isDisabled()).toBe(true);
    await autoCheck.click();
    await expect.poll(() => autoCheck.getAttribute("aria-checked")).toBe("true");
    await expect.poll(() => interval.isEnabled()).toBe(true);
    await interval.fill("15");
    await expect
      .poll(async () =>
        JSON.parse(await readFile(join(appDataRoot, "settings.json"), "utf8"))
      )
      .toMatchObject({
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 15
      });
  }, 30_000);

  it("reveals sidebar Agents hidden behind the overflow count", async () => {
    const { page } = await launchApp();
    const overflow = page.getByRole("button", { name: "Show hidden Agent list, 1 item" });
    await overflow.waitFor({ state: "visible" });

    await overflow.hover();
    const popover = page.getByRole("tooltip");
    await popover.waitFor({ state: "visible" });
    await expect.poll(() => popover.textContent()).toContain("Antigravity");
    expect(await popover.locator(".agent-chip--antigravity .agent-chip__logo").count()).toBe(1);
    await expectTopmost(popover);

    for (const viewport of [
      { width: 1180, height: 728 },
      { width: 920, height: 620 }
    ]) {
      await resizeAppWindow(page, viewport.width, viewport.height);
      await overflow.hover();
      const box = await popover.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }

    await popover.hover();
    await expect.poll(() => popover.isVisible()).toBe(true);
    await page.getByRole("heading", { name: "Skills" }).hover();
    await popover.waitFor({ state: "hidden" });

    await overflow.focus();
    await popover.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "hidden" });
    await expect.poll(() => overflow.evaluate((element) => element === document.activeElement)).toBe(true);

    await overflow.click();
    await popover.waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Skills" }).click();
    await popover.waitFor({ state: "hidden" });
  }, 30_000);

  it("persists enabled Agents and excludes disabled Agents from operations", async () => {
    const { appDataRoot, homeDir, page } = await launchApp();
    const sharedSkillDir = join(homeDir, ".agents", "skills", "shared-scope-skill");
    await mkdir(sharedSkillDir, { recursive: true });
    await writeFile(
      join(sharedSkillDir, "SKILL.md"),
      "---\nname: shared-scope-skill\n---\n\nShared compatibility Skill.\n",
      "utf8"
    );

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const openCodeSwitch = page.getByRole("switch", { name: "Turn off OpenCode" });
    await openCodeSwitch.waitFor({ state: "visible" });

    for (const viewport of [
      { width: 1180, height: 728 },
      { width: 920, height: 620 }
    ]) {
      await resizeAppWindow(page, viewport.width, viewport.height);
      await expectNoHorizontalOverflow(page, [".app-shell", ".editor-panel", ".settings-page"]);
      const rowGeometry = await page.locator(".agent-settings-row").evaluateAll((rows) =>
        rows.map((row) => {
          const rowRect = row.getBoundingClientRect();
          const children = Array.from(row.children).map((child) => {
            const childRect = child.getBoundingClientRect();
            return {
              left: childRect.left,
              right: childRect.right,
              top: childRect.top,
              bottom: childRect.bottom
            };
          });
          return {
            row: {
              left: rowRect.left,
              right: rowRect.right,
              top: rowRect.top,
              bottom: rowRect.bottom
            },
            children
          };
        })
      );
      expect(rowGeometry).toHaveLength(4);
      for (const geometry of rowGeometry) {
        for (const child of geometry.children) {
          expect(child.left).toBeGreaterThanOrEqual(geometry.row.left);
          expect(child.right).toBeLessThanOrEqual(geometry.row.right);
          expect(child.top).toBeGreaterThanOrEqual(geometry.row.top);
          expect(child.bottom).toBeLessThanOrEqual(geometry.row.bottom);
        }
      }
    }

    await openCodeSwitch.click();

    await expect
      .poll(async () => {
        const settings = await readJson<{ enabledTargetIds?: string[] }>(
          join(appDataRoot, "settings.json")
        );
        return settings.enabledTargetIds ?? [];
      })
      .not.toContain("opencode");
    await page.getByRole("switch", { name: "Turn on OpenCode" }).waitFor({ state: "visible" });

    const disabledState = await page.evaluate(async () => {
      const targets = await window.agentEnv.listTargets(true);
      const errors: string[] = [];
      try {
        await window.agentEnv.previewApply("ui-opencode-alpha", "opencode");
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      try {
        await window.agentEnv.previewCreateProfileFromTarget("opencode");
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      return { ids: targets.map((target) => target.id), errors };
    });
    expect(disabledState.ids).not.toContain("opencode");
    expect(disabledState.errors).toHaveLength(2);
    expect(disabledState.errors.join("\n")).toContain("OpenCode");

    await page.getByRole("switch", { name: "Turn off Codex" }).click();
    await page.getByRole("switch", { name: "Turn off Claude Code" }).click();
    await page.getByRole("switch", { name: "Turn off Antigravity" }).click();
    await expect
      .poll(async () => {
        const settings = await readJson<{ enabledTargetIds?: string[] }>(
          join(appDataRoot, "settings.json")
        );
        return settings.enabledTargetIds ?? [];
      })
      .toEqual([]);
    expect(await page.getByRole("button", { name: "Agents", exact: true }).count()).toBe(0);
    const inventory = await page.evaluate(() => window.agentEnv.scanSkillInventory());
    expect(inventory.some((item) => item.id === "shared-scope-skill")).toBe(true);
    expect(inventory.some((item) => item.id === "target-only-reviewer")).toBe(false);

    await page.reload();
    await page.getByRole("region", { name: "Skill library", exact: true }).waitFor({
      state: "visible"
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("switch", { name: "Turn on OpenCode" }).click();
    await page.getByRole("switch", { name: "Turn off OpenCode" }).waitFor({ state: "visible" });

    await expect
      .poll(async () => (await page.evaluate(() => window.agentEnv.listTargets(true))).map((item) => item.id))
      .toContain("opencode");
  }, 30_000);

  it("switches, persists, and contains all supported interface languages", async () => {
    const { appDataRoot, page } = await launchApp();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByTestId("locale-select").selectOption("zh_CN");
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
    await expect
      .poll(async () => JSON.parse(await readFile(join(appDataRoot, "settings.json"), "utf8")))
      .toMatchObject({ locale: "zh_CN" });

    await page.reload();
    await page.getByRole("button", { name: "设置", exact: true }).waitFor();
    expect(await page.locator("html").getAttribute("lang")).toBe("zh-CN");

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByTestId("locale-select").selectOption("zh_TW");
    await page.getByRole("heading", { name: "設定", exact: true }).waitFor();
    expect(await page.locator("html").getAttribute("lang")).toBe("zh-TW");

    await resizeAppWindow(page, 920, 620);
    for (const workspace of ["技能", "MCP", "設定檔", "Agents", "設定"]) {
      await page.getByRole("button", { name: workspace, exact: true }).click();
      if (workspace === "MCP") {
        const mcpLibrary = page.locator(".skill-library-panel--mcp");
        await mcpLibrary.waitFor({ state: "visible" });
        const mcpRowGeometry = await mcpLibrary.locator(".resource-row").first().evaluate((row) => {
          const style = getComputedStyle(row);
          return {
            gridTemplateColumns: style.gridTemplateColumns,
            height: Math.round(row.getBoundingClientRect().height),
            minHeight: style.minHeight
          };
        });
        expect(mcpRowGeometry.gridTemplateColumns.split(" ")).toHaveLength(5);
        expect(mcpRowGeometry.minHeight).toBe("58px");
        expect(mcpRowGeometry.height).toBeLessThanOrEqual(72);
      }
      const containment = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: document.documentElement.clientHeight
      }));
      expect(containment.documentWidth).toBe(containment.viewportWidth);
      expect(containment.documentHeight).toBe(containment.viewportHeight);
    }

    await page.getByTestId("locale-select").selectOption("en");
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await expect
      .poll(async () => JSON.parse(await readFile(join(appDataRoot, "settings.json"), "utf8")))
      .toMatchObject({ locale: "en" });
  }, 30_000);

  it("routes a rate-limited GitHub update check to account connection", async () => {
    const { app: electronApp, page } = await launchApp();
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("skills:check-updates");
      ipcMain.handle("skills:check-updates", () => [
        {
          id: "shared-reviewer",
          name: "Shared Reviewer",
          sourceType: "github",
          currentRevision: "seed",
          updateAvailable: false,
          error: "GitHub API rate limit reached (403 Forbidden)"
        }
      ]);
    });

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Check updates" }).click();
    const feedback = page.getByRole("alert");
    await expect.poll(() => feedback.textContent()).toContain("GitHub request limited");
    await expect.poll(() => feedback.textContent()).toContain("Connect your account");
    await feedback.getByRole("button", { name: "Connect GitHub" }).click();

    const githubSettings = page.getByRole("region", { name: "GitHub OAuth settings" });
    await githubSettings.waitFor({ state: "visible" });
    await expect.poll(() => githubSettings.evaluate((element) => document.activeElement === element))
      .toBe(true);
    await githubSettings.getByRole("button", { name: "Sign in with GitHub" }).waitFor({
      state: "visible"
    });
  }, 30_000);

  it("reports an offline GitHub update check without offering sign-in as the fix", async () => {
    const { app: electronApp, page } = await launchApp();
    await electronApp.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { __agentEnvCopiedMessage?: string };
      state.__agentEnvCopiedMessage = undefined;
      ipcMain.removeHandler("skills:check-updates");
      ipcMain.removeHandler("clipboard:write-text");
      ipcMain.handle("skills:check-updates", () => [
        {
          id: "shared-reviewer",
          name: "Shared Reviewer",
          sourceType: "github",
          currentRevision: "seed",
          updateAvailable: false,
          error: "GitHub request failed: network offline"
        }
      ]);
      ipcMain.handle("clipboard:write-text", (_event, text) => {
        state.__agentEnvCopiedMessage = String(text);
      });
    });

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Check updates" }).click();
    const feedback = page.getByRole("alert");
    await expect.poll(() => feedback.textContent()).toContain("1 check failed");
    await expect.poll(() => feedback.textContent()).toContain("network offline");
    await feedback.getByRole("button", { name: "Copy message" }).click();
    await expect
      .poll(() =>
        electronApp.evaluate(
          () =>
            (globalThis as typeof globalThis & { __agentEnvCopiedMessage?: string })
              .__agentEnvCopiedMessage
        )
      )
      .toBe("1 check failed\nGitHub request failed: network offline");
    await feedback.getByRole("button", { name: "Message copied" }).waitFor();
    expect(await feedback.getByRole("button", { name: "Connect GitHub" }).count()).toBe(0);
    await feedback.getByRole("button", { name: "Dismiss message" }).click();
    await feedback.waitFor({ state: "hidden" });
  }, 30_000);

  it("copies the GitHub device code and refreshes connection state after authorization", async () => {
    const { app: electronApp, page } = await launchApp();
    await electronApp.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & {
        __agentEnvCopiedText?: string;
        __agentEnvGitHubSignedIn?: boolean;
        __agentEnvGitHubPolls?: number;
      };
      state.__agentEnvCopiedText = undefined;
      state.__agentEnvGitHubSignedIn = false;
      state.__agentEnvGitHubPolls = 0;

      for (const channel of [
        "clipboard:write-text",
        "github:status",
        "github:start-device-login",
        "github:poll-device-login",
        "github:open-device-page"
      ]) {
        ipcMain.removeHandler(channel);
      }
      ipcMain.handle("clipboard:write-text", (_event, text) => {
        state.__agentEnvCopiedText = String(text);
      });
      ipcMain.handle("github:status", () =>
        state.__agentEnvGitHubSignedIn
          ? {
              state: "signed-in",
              clientId: "e2e-client",
              user: { login: "e2e-user" },
              rateLimit: { limit: 5000, remaining: 4998, resetAt: "2026-07-12T00:00:00.000Z" }
            }
          : { state: "configured", clientId: "e2e-client" }
      );
      ipcMain.handle("github:start-device-login", () => ({
        id: "e2e-login",
        userCode: "E2E1-CODE",
        verificationUri: "https://github.com/login/device",
        expiresAt: "2026-07-12T00:15:00.000Z",
        intervalSeconds: 1
      }));
      ipcMain.handle("github:poll-device-login", () => {
        state.__agentEnvGitHubPolls = (state.__agentEnvGitHubPolls ?? 0) + 1;
        if (state.__agentEnvGitHubPolls === 1) {
          return {
            state: "pending",
            message: "Waiting for GitHub authorization",
            retryAfterSeconds: 1
          };
        }
        state.__agentEnvGitHubSignedIn = true;
        return {
          state: "signed-in",
          status: {
            state: "signed-in",
            clientId: "e2e-client",
            user: { login: "e2e-user" },
            rateLimit: { limit: 5000, remaining: 4998, resetAt: "2026-07-12T00:00:00.000Z" }
          }
        };
      });
      ipcMain.handle("github:open-device-page", () => undefined);
    });

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    const codeButton = page.getByRole("button", { name: "Copy GitHub device code E2E1-CODE" });
    await codeButton.click();
    await expect
      .poll(() =>
        electronApp.evaluate(() =>
          (globalThis as typeof globalThis & { __agentEnvCopiedText?: string })
            .__agentEnvCopiedText
        )
      )
      .toBe("E2E1-CODE");
    await page.getByText("Copied", { exact: true }).waitFor();

    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("Waiting for authorization. This page updates automatically.").waitFor();
    expect(await page.getByText(/slow down polling/i).count()).toBe(0);
    await page.getByText("Connected as e2e-user").waitFor();
    await page.getByText("Connected", { exact: true }).waitFor();
    expect(await codeButton.count()).toBe(0);
  }, 30_000);

  it("removes an existing profile-owned skill from the rendered Resources editor", async () => {
    const { opencodeDir, page } = await launchApp();
    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");

    const installedSkillDir = join(opencodeDir, "skills", "ui-alpha-skill");
    await expect(fileExists(installedSkillDir)).resolves.toBe(true);

    await expandComposerSection(page, "Skills");
    expect(await page.getByRole("button", { name: "Add skill" }).count()).toBe(0);
    await page
      .getByRole("listitem", { name: "Profile-owned skill ui-alpha-skill" })
      .getByRole("button", { name: "More actions for profile-owned skill ui-alpha-skill" })
      .click();
    await page.getByRole("menuitem", { name: "Remove from profile" }).click();
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    await expect(fileExists(installedSkillDir)).resolves.toBe(false);
  }, 30_000);

  it("imports a Profile-only skill into Library without deleting its source file", async () => {
    const { appDataRoot, page } = await launchApp();
    await resizeAppWindow(page, 920, 620);
    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");

    const profileOnlyRow = page.getByRole("listitem", {
      name: "Profile-owned skill ui-alpha-skill"
    });
    await expect.poll(() => profileOnlyRow.textContent()).toContain("Profile only");
    const importButton = profileOnlyRow.getByRole("button", {
      name: "Import ui-alpha-skill to Library"
    });
    const importGeometry = await profileOnlyRow.evaluate((row) => {
      const action = row.querySelector<HTMLElement>(".profile-skill-update")!;
      const menu = row.querySelector<HTMLElement>(".icon-action")!;
      const rowBox = row.getBoundingClientRect();
      const actionBox = action.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      return {
        actionInside: actionBox.left >= rowBox.left && actionBox.right <= rowBox.right,
        menuInside: menuBox.right <= rowBox.right,
        actionTextFits: action.scrollWidth <= action.clientWidth,
        gap: menuBox.left - actionBox.right
      };
    });
    expect(importGeometry.actionInside).toBe(true);
    expect(importGeometry.menuInside).toBe(true);
    expect(importGeometry.actionTextFits).toBe(true);
    expect(importGeometry.gap).toBeGreaterThanOrEqual(8);
    await importButton.click();

    const libraryRow = page.getByRole("listitem", { name: "Profile skill ui-alpha-skill" });
    await expect.poll(() => libraryRow.textContent()).toContain("Library revision");
    await expect.poll(() => page.locator(".app-feedback").textContent()).toContain(
      "imported to Library"
    );
    await saveProfile(page);

    const savedAssets = await readJson<{
      ownedDirs: Array<{ kind: string; source: string; targetName: string }>;
      skillRefs: Array<{ libraryId: string; targetName: string; enabled?: boolean }>;
    }>(join(appDataRoot, "profiles", "ui-opencode-alpha", "assets.json"));
    expect(savedAssets.ownedDirs.some((entry) => entry.targetName === "ui-alpha-skill")).toBe(false);
    expect(savedAssets.skillRefs).toContainEqual({
      libraryId: "ui-alpha-skill",
      targetName: "ui-alpha-skill",
      enabled: true
    });
    await expect(
      fileExists(join(appDataRoot, "skills-library", "ui-alpha-skill", "SKILL.md"))
    ).resolves.toBe(true);
    await expect(
      fileExists(join(appDataRoot, "profiles", "ui-opencode-alpha", "skills", "alpha-skill", "SKILL.md"))
    ).resolves.toBe(true);
  }, 30_000);

  it("saves and applies Profile Skill disable and re-enable changes", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp({
      openCodeAlphaLibrarySkillCount: 1
    });
    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");

    const installedSkillDir = join(opencodeDir, "skills", "layout-skill-1");
    await expect(fileExists(join(installedSkillDir, "SKILL.md"))).resolves.toBe(true);

    await expandComposerSection(page, "Skills");
    const skillRow = page.getByRole("listitem", { name: "Profile skill layout-skill-1" });
    const libraryMetadata = await readJson<{ contentHash: string }>(
      join(appDataRoot, "skills-library", "layout-skill-1", ".agentenv-skill.json")
    );
    await expect.poll(() => skillRow.textContent()).toContain(
      `OpenCode · ${libraryMetadata.contentHash.slice(0, 7)}`
    );
    await skillRow.getByRole("switch", { name: "Disable layout-skill-1" }).click();
    await expect(fileExists(join(installedSkillDir, "SKILL.md"))).resolves.toBe(true);
    await expect.poll(() => skillRow.textContent()).toContain("Apply pending");
    await skillRow.getByRole("switch", { name: "Enable layout-skill-1" }).waitFor();
    expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Apply", exact: true }).isDisabled()).toBe(true);
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");
    await expect(fileExists(installedSkillDir)).resolves.toBe(false);

    const savedAssets = await readJson<{
      skillRefs: Array<{ libraryId: string; targetName: string; enabled?: boolean }>;
    }>(join(appDataRoot, "profiles", "ui-opencode-alpha", "assets.json"));
    expect(savedAssets.skillRefs).toEqual([
      { libraryId: "layout-skill-1", targetName: "layout-skill-1", enabled: false }
    ]);
    await expect(fileExists(join(appDataRoot, "skills-library", "layout-skill-1", "SKILL.md")))
      .resolves.toBe(true);

    await skillRow.getByRole("switch", { name: "Enable layout-skill-1" }).click();
    await expect(fileExists(installedSkillDir)).resolves.toBe(false);
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");
    await expect(fileExists(join(installedSkillDir, "SKILL.md"))).resolves.toBe(true);
    await skillRow.getByRole("switch", { name: "Disable layout-skill-1" }).waitFor();
    const reenabledAssets = await readJson<{
      skillRefs: Array<{ libraryId: string; targetName: string; enabled?: boolean }>;
    }>(join(appDataRoot, "profiles", "ui-opencode-alpha", "assets.json"));
    expect(reenabledAssets.skillRefs).toEqual([
      { libraryId: "layout-skill-1", targetName: "layout-skill-1", enabled: true }
    ]);
  }, 30_000);

  it("keeps Profile Skill edits, Save, and Preview responsive with many Skills", async () => {
    const { page } = await launchApp({ openCodeAlphaLibrarySkillCount: 30 });
    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    const skillRow = page.getByRole("listitem", {
      name: "Profile skill layout-skill-1",
      exact: true
    });
    const skillSwitch = skillRow.getByRole("switch", {
      name: "Disable layout-skill-1",
      exact: true
    });

    const toggleStartedAt = await page.evaluate(() => performance.now());
    await skillSwitch.click();
    await skillRow.getByRole("switch", { name: "Enable layout-skill-1", exact: true }).waitFor();
    const toggleDuration = (await page.evaluate(() => performance.now())) - toggleStartedAt;
    expect(toggleDuration).toBeLessThan(500);

    const saveStartedAt = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).waitFor({ state: "visible" });
    await expect.poll(() => page.getByRole("button", { name: "Apply", exact: true }).isEnabled())
      .toBe(true);
    const saveDuration = (await page.evaluate(() => performance.now())) - saveStartedAt;
    expect(saveDuration).toBeLessThan(1_200);

    const previewStartedAt = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    expect(await page.getByRole("button", { name: "Apply", exact: true }).getAttribute("aria-busy"))
      .toBe("true");
    await page.getByRole("dialog", { name: "Preview" }).waitFor({ state: "visible" });
    const previewDuration = (await page.evaluate(() => performance.now())) - previewStartedAt;
    expect(previewDuration).toBeLessThan(2_000);
  }, 30_000);

  it("globally disables a Library skill, hides it from Profile selection, and removes it on Apply", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp({
      openCodeAlphaLibrarySkillCount: 1
    });
    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    const installedSkillDir = join(opencodeDir, "skills", "layout-skill-1");
    await expect(fileExists(join(installedSkillDir, "SKILL.md"))).resolves.toBe(true);

    await openSkillLibrary(page);
    const libraryRow = page.getByRole("group", { name: "Library item layout-skill-1" });
    await libraryRow.getByRole("button", { name: "More actions for layout-skill-1" }).click();
    await page.getByRole("menuitem", { name: /Disable globally/ }).click();
    const disableDialog = page.getByRole("dialog", { name: "Disable library skill" });
    await disableDialog.getByRole("button", { name: "Disable globally" }).click();
    await disableDialog.waitFor({ state: "hidden" });
    await page.mouse.move(8, 8);
    await expect.poll(async () =>
      (await readJson<{ globallyEnabled?: boolean }>(
        join(appDataRoot, "skills-library", "layout-skill-1", ".agentenv-skill.json")
      )).globallyEnabled
    ).toBe(false);
    await expect.poll(() => libraryRow.textContent()).toContain("Disabled");
    expect(await libraryRow.getAttribute("class")).toContain("is-globally-disabled");
    await expect
      .poll(() => libraryRow.evaluate((row) => getComputedStyle(row).backgroundColor))
      .toBe("rgb(245, 245, 247)");
    await expect
      .poll(() => libraryRow.evaluate((row) => getComputedStyle(row).boxShadow))
      .toBe("none");
    const disabledTab = page.getByRole("tab", { name: /Disabled 1/ });
    await disabledTab.click();
    expect(await disabledTab.getAttribute("aria-selected")).toBe("true");
    expect(await page.getByRole("group", { name: /^Library item / }).count()).toBe(1);
    await page.getByRole("tab", { name: /Updates/ }).click();
    expect(await page.getByRole("group", { name: "Library item layout-skill-1" }).count()).toBe(0);
    await page.getByRole("tab", { name: /^All / }).click();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const usageFilter = page.getByRole("combobox", { name: "Skill usage filter" });
    await usageFilter.selectOption("referenced");
    expect(await page.getByRole("group", { name: "Library item layout-skill-1" }).count()).toBe(0);
    await usageFilter.selectOption("unreferenced");
    expect(await page.getByRole("group", { name: "Library item layout-skill-1" }).count()).toBe(0);
    await usageFilter.selectOption("all");

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    const profileRow = page.getByRole("listitem", { name: "Profile skill layout-skill-1" });
    await expect.poll(() => profileRow.textContent()).toContain("Disabled in Library");
    expect(await profileRow.getByRole("switch", { name: "layout-skill-1 is disabled in Library" }).isDisabled())
      .toBe(true);
    await page.getByRole("button", { name: "Add library skill" }).click();
    const picker = page.getByRole("dialog", { name: "Add library skills" });
    expect(await picker.getByLabel("layout-skill-1").count()).toBe(0);
    await picker.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Apply", exact: true }).click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    const resourceChanges = previewDialog.getByRole("region", { name: "Resource changes" });
    await expect.poll(() => resourceChanges.textContent()).toContain("layout-skill-1");
    await expect.poll(() => resourceChanges.textContent()).toContain("remove");
    await previewDialog.getByRole("button", { name: "Apply profile" }).click();
    await previewDialog.waitFor({ state: "hidden" });
    await expect(fileExists(installedSkillDir)).resolves.toBe(false);

    await openSkillLibrary(page);
    await libraryRow.getByRole("button", { name: "More actions for layout-skill-1" }).click();
    await page.getByRole("menuitem", { name: /Enable globally/ }).click();
    await expect.poll(async () =>
      (await readJson<{ globallyEnabled?: boolean }>(
        join(appDataRoot, "skills-library", "layout-skill-1", ".agentenv-skill.json")
      )).globallyEnabled
    ).toBe(true);
    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    const restoredProfileRow = page.getByRole("listitem", {
      name: "Profile skill layout-skill-1"
    });
    expect(await restoredProfileRow.getByRole("switch", { name: "Disable layout-skill-1" }).isEnabled())
      .toBe(true);
    await page.getByRole("button", { name: "Add library skill" }).click();
    const restoredPicker = page.getByRole("dialog", { name: "Add library skills" });
    expect(await restoredPicker.getByLabel("layout-skill-1").count()).toBe(0);
    await restoredPicker.getByRole("button", { name: "Cancel" }).click();
    await previewAndApply(page, "OpenCode");
    await expect(fileExists(join(installedSkillDir, "SKILL.md"))).resolves.toBe(true);
  }, 30_000);

  it("reviews and replaces profile-owned Skill destination conflicts", async () => {
    const { opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    const alphaSkill = page.getByRole("listitem", {
      name: "Profile-owned skill ui-alpha-skill"
    });
    await alphaSkill
      .getByRole("button", { name: "More actions for profile-owned skill ui-alpha-skill" })
      .click();
    await page.getByRole("menuitem", { name: "Edit install name" }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit profile-owned skill" });
    await editDialog.getByLabel("Install name").fill("target-only-reviewer");
    await editDialog.getByRole("button", { name: "Save" }).click();
    await editDialog.waitFor({ state: "hidden" });
    await saveProfile(page);

    await applyActionButton(page, "OpenCode").click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    const targetSkill = join(opencodeDir, "skills", "target-only-reviewer");
    await expect.poll(() => previewDialog.textContent()).toContain(
      "Existing unmanaged Skill will be replaced"
    );
    await expect.poll(() => previewDialog.textContent()).toContain(targetSkill);
    expect(await previewDialog.getByRole("button", { name: "Apply profile" }).isDisabled()).toBe(true);
    await previewDialog
      .getByLabel("I understand; back up and replace these changes")
      .check();
    await previewDialog.getByRole("button", { name: "Back up and replace" }).click();
    await previewDialog.waitFor({ state: "hidden" });
    await expect(readFile(join(targetSkill, "SKILL.md"), "utf8")).resolves.toContain(
      "alpha skill prompt"
    );
  }, 30_000);

  it("imports and updates a GitHub-backed skill through the rendered app", async () => {
    const { app: electronApp, appDataRoot, githubFixtureRoot, page } = await launchApp();
    const sourceUrl = "https://github.com/acme/agent-skills/tree/main/skills/reviewer";

    await page.getByRole("button", { name: "Import skills" }).click();
    await page.getByRole("tab", { name: "Repository" }).click();
    await page.getByLabel("Repository address").fill(sourceUrl);
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    const githubReviewer = page.getByRole("checkbox", { name: "Select GitHub Reviewer" });
    await githubReviewer.waitFor();
    expect(await githubReviewer.isChecked()).toBe(true);
    await page.getByLabel("Library ID for GitHub Reviewer").fill("github-reviewer");
    expect(await githubReviewer.isChecked()).toBe(true);
    const librarySkillMd = join(appDataRoot, "skills-library", "github-reviewer", "SKILL.md");
    await page.getByRole("button", { name: "Import 1" }).click();
    await expect.poll(() => fileExists(librarySkillMd), { timeout: 5_000 }).toBe(true);
    await closeCompletedGitHubImport(page, "All 1 skills imported", ["GitHub Reviewer"]);
    await page
      .getByRole("group", { name: "Library item github-reviewer" })
      .getByText("GitHub skill v1.")
      .waitFor({ state: "visible" });

    await electronApp.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { __agentEnvOpenedSource?: string };
      ipcMain.removeHandler("external:open-url");
      ipcMain.handle("external:open-url", (_event, url) => {
        state.__agentEnvOpenedSource = String(url);
      });
    });
    const githubRow = page.getByRole("group", { name: "Library item github-reviewer" });
    const sourcePreview = githubRow.getByLabel("Full source for github-reviewer");
    await sourcePreview.hover();
    const sourceTooltip = page.getByRole("tooltip").filter({ hasText: sourceUrl });
    await sourceTooltip.waitFor({ state: "visible" });
    await expectInViewport(page, sourceTooltip);
    await page.mouse.move(10, 10);
    await githubRow.getByRole("button", { name: "Open repository source for github-reviewer" }).click();
    await expect
      .poll(() =>
        electronApp.evaluate(() =>
          (globalThis as typeof globalThis & { __agentEnvOpenedSource?: string })
            .__agentEnvOpenedSource
        )
      )
      .toBe(sourceUrl);

    await expect(readFile(librarySkillMd, "utf8")).resolves.toContain("v1 guidance from GitHub.");
    await expect(
      readFile(
        join(appDataRoot, "skills-library", "github-reviewer", "references", "guide.md"),
        "utf8"
      )
    ).resolves.toBe("# Guide v1\n");

    await githubRow.getByRole("button", { name: "More actions for github-reviewer" }).click();
    await page.getByRole("menuitem", { name: "Update settings" }).click();
    const updateCheckSwitch = page.getByRole("switch", {
      name: "Track updates for github-reviewer"
    });
    await expect.poll(() => updateCheckSwitch.getAttribute("aria-checked")).toBe("true");
    await updateCheckSwitch.click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.poll(() => githubRow.textContent()).toContain("Checks disabled");
    await expect
      .poll(async () =>
        (await readJson<{ updateCheckEnabled?: boolean }>(
          join(appDataRoot, "skills-library", "github-reviewer", ".agentenv-skill.json")
        )).updateCheckEnabled
      )
      .toBe(false);

    await writeGitHubFixtureSkill(githubFixtureRoot, "v2");
    await page.getByRole("button", { name: "Check updates" }).click();
    await expect
      .poll(() => githubRow.getByRole("button", { name: "Review update github-reviewer" }).count())
      .toBe(0);
    await githubRow.getByRole("button", { name: "More actions for github-reviewer" }).click();
    await page.getByRole("menuitem", { name: "Update settings" }).click();
    await page.getByRole("switch", { name: "Track updates for github-reviewer" }).click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect
      .poll(async () =>
        (await readJson<{ updateCheckEnabled?: boolean }>(
          join(appDataRoot, "skills-library", "github-reviewer", ".agentenv-skill.json")
        )).updateCheckEnabled
      )
      .toBe(true);
    await page.getByRole("button", { name: "Check updates" }).click();
    await page
      .getByRole("group", { name: "Library item github-reviewer" })
      .getByRole("button", { name: "Review update github-reviewer" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Review update github-reviewer" }).click();
    await page
      .getByRole("dialog", { name: "Update preview for github-reviewer" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Apply update github-reviewer" }).click();
    await expect.poll(() => page.getByRole("status").textContent()).toContain("Updated github-reviewer");
    await page
      .getByRole("group", { name: "Library item github-reviewer" })
      .getByText("GitHub skill v2.")
      .waitFor({ state: "visible" });

    await expect(readFile(librarySkillMd, "utf8")).resolves.toContain("v2 guidance from GitHub.");
  }, 60_000);

  it("writes Codex disabled skill paths from the rendered Resources editor", async () => {
    const { codexDir, page } = await launchApp();

    await page.getByRole("button", { name: "Profiles" }).click();
    await selectTarget(page, "Codex");
    await selectProfile(page, "UI Codex alpha");
    await expandComposerSection(page, "Advanced");
    await page
      .getByRole("textbox", { name: "Disabled Skill Paths" })
      .fill("/Users/example/.agents/skills/legacy-reviewer\n/Users/example/.agents/skills/noisy-helper");
    await saveProfile(page);
    await previewAndApply(page, "Codex");

    const codexConfig = await readFile(join(codexDir, "config.toml"), "utf8");
    expect(codexConfig).toContain("[[skills.config]]");
    expect(codexConfig).toContain('path = "/Users/example/.agents/skills/legacy-reviewer"');
    expect(codexConfig).toContain('path = "/Users/example/.agents/skills/noisy-helper"');
    expect(codexConfig).toContain("enabled = false");
  }, 30_000);

  it("scans a GitHub directory and imports only the selected skills", async () => {
    const { appDataRoot, githubFixtureRoot, page } = await launchApp();
    await writeGitHubFixtureDirectory(githubFixtureRoot);
    await resizeAppWindow(page, 920, 620);

    await page.getByRole("button", { name: "Import skills" }).click();
    await page.getByRole("tab", { name: "Repository" }).click();
    await page
      .getByLabel("Repository address")
      .fill("https://github.com/acme/agent-skills/tree/main/skills/engineering");
    await page.getByRole("button", { name: "Scan", exact: true }).click();

    const apiDesign = page.getByRole("checkbox", { name: "Select API Design" });
    const releaseCheck = page.getByRole("checkbox", { name: "Select Release Check" });
    await apiDesign.waitFor({ state: "visible" });
    expect(await apiDesign.isChecked()).toBe(true);
    expect(await releaseCheck.isChecked()).toBe(true);
    const selectAll = page.getByRole("checkbox", { name: "Select all discovered skills" });
    expect(await selectAll.isChecked()).toBe(true);
    const selectionGeometry = await page.locator(".github-selection-bar").evaluate((element) => {
      const bar = element.getBoundingClientRect();
      const label = element.querySelector("label")?.getBoundingClientRect();
      const checkbox = element.querySelector("input")?.getBoundingClientRect();
      const count = element.querySelector(".github-selection-count")?.getBoundingClientRect();
      return {
        barLeft: bar.left,
        barRight: bar.right,
        barTop: bar.top,
        barBottom: bar.bottom,
        labelLeft: label?.left ?? 0,
        labelRight: label?.right ?? 0,
        labelCenter: label ? label.top + label.height / 2 : 0,
        checkboxLeft: checkbox?.left ?? 0,
        checkboxRight: checkbox?.right ?? 0,
        countLeft: count?.left ?? 0,
        countRight: count?.right ?? 0,
        countCenter: count ? count.top + count.height / 2 : 0
      };
    });
    expect(selectionGeometry.labelLeft).toBeGreaterThanOrEqual(selectionGeometry.barLeft);
    expect(selectionGeometry.checkboxLeft).toBeGreaterThanOrEqual(selectionGeometry.labelLeft);
    expect(selectionGeometry.checkboxRight).toBeLessThanOrEqual(selectionGeometry.labelRight);
    expect(selectionGeometry.labelRight).toBeLessThan(selectionGeometry.countLeft);
    expect(selectionGeometry.countRight).toBeLessThanOrEqual(selectionGeometry.barRight);
    expect(Math.abs(selectionGeometry.labelCenter - selectionGeometry.countCenter)).toBeLessThanOrEqual(1);
    expect(selectionGeometry.labelCenter).toBeGreaterThanOrEqual(selectionGeometry.barTop);
    expect(selectionGeometry.labelCenter).toBeLessThanOrEqual(selectionGeometry.barBottom);
    await releaseCheck.uncheck();
    expect(await selectAll.isChecked()).toBe(false);
    expect(await selectAll.evaluate((element) => (element as HTMLInputElement).indeterminate)).toBe(true);
    await expect.poll(() => page.locator(".github-selection-count").textContent()).toContain("1 selected");
    await releaseCheck.check();
    await expect.poll(() => page.locator(".github-selection-count").textContent()).toContain("2 selected");
    await page.getByRole("button", { name: "Import 2" }).click();

    await closeCompletedGitHubImport(page, "All 2 skills imported", ["API Design", "Release Check"]);
    await page.getByRole("group", { name: "Library item api-design" }).waitFor({ state: "visible" });
    await page.getByRole("group", { name: "Library item release-check" }).waitFor({ state: "visible" });
    await expect(
      readFile(join(appDataRoot, "skills-library", "api-design", "SKILL.md"), "utf8")
    ).resolves.toContain("Design stable APIs");
    await expect(
      readFile(join(appDataRoot, "skills-library", "release-check", "SKILL.md"), "utf8")
    ).resolves.toContain("Verify releases before shipping");
  }, 30_000);

  it("reviews a GitHub same-name conflict before replacing the Library copy", async () => {
    const { appDataRoot, githubFixtureRoot, page } = await launchApp();
    const remotePath = "skills/shared-reviewer-next";
    const fixtureDir = join(githubFixtureRoot, "acme", "agent-skills", "main", remotePath);
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(
      join(fixtureDir, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: GitHub replacement.\nmetadata:\n  version: '3.0'\n---\n# GitHub replacement\n",
      "utf8"
    );

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Import skills" }).click();
    await page.getByRole("tab", { name: "Repository" }).click();
    await page.getByLabel("Repository address")
      .fill(`https://github.com/acme/agent-skills/tree/main/${remotePath}`);
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Shared Reviewer" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Import 1" }).click();

    const conflict = page.getByRole("dialog", { name: "Review duplicate Skill" });
    await conflict.waitFor({ state: "visible" });
    await expect.poll(() => conflict.textContent()).toContain("3.0");
    await expect.poll(() => conflict.textContent()).toContain("Different");
    await conflict.getByRole("button", { name: "Replace Skill" }).click();
    await conflict.waitFor({ state: "hidden" });
    await closeCompletedGitHubImport(page, "All 1 skills imported", ["Shared Reviewer"]);

    await expect.poll(() =>
      readFile(join(appDataRoot, "skills-library", "shared-reviewer", "SKILL.md"), "utf8")
    ).toContain("GitHub replacement");
    const metadata = await readJson<{ sourceType?: string; source?: string }>(
      join(appDataRoot, "skills-library", "shared-reviewer", ".agentenv-skill.json")
    );
    expect(metadata).toMatchObject({
      sourceType: "github",
      source: `https://github.com/acme/agent-skills/tree/main/${remotePath}`
    });
    expect((await readdir(join(appDataRoot, "backups", "skill-cleanup"))).length).toBeGreaterThan(0);
  }, 45_000);

  it("updates tracking metadata when identical content gains a GitHub source", async () => {
    const { appDataRoot, githubFixtureRoot, page } = await launchApp();
    const remotePath = "skills/shared-reviewer-online";
    const fixtureDir = join(githubFixtureRoot, "acme", "agent-skills", "main", remotePath);
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(
      join(fixtureDir, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: Shared review guidance for multiple profiles.\n---\n\n# Shared Reviewer\n\nReview code changes before applying them.\n",
      "utf8"
    );

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Import skills" }).click();
    await page.getByRole("tab", { name: "Repository" }).click();
    await page.getByLabel("Repository address")
      .fill(`https://github.com/acme/agent-skills/tree/main/${remotePath}`);
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Shared Reviewer" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Import 1" }).click();

    const conflict = page.getByRole("dialog", { name: "Review duplicate Skill" });
    await conflict.waitFor({ state: "visible" });
    await expect.poll(() => conflict.textContent()).toContain("Source available");
    await expect.poll(() => conflict.textContent()).toContain("No file changes");
    await expect.poll(() => conflict.textContent()).toContain(
      `https://github.com/acme/agent-skills/tree/main/${remotePath}`
    );
    expect(await conflict.getByRole("radio", { name: /Replace Library copy/ }).count()).toBe(0);
    await conflict.getByRole("button", { name: "Update source" }).click();
    await conflict.waitFor({ state: "hidden" });
    await closeCompletedGitHubImport(page, "All 1 skills imported", ["Shared Reviewer"]);

    expect(await page.getByRole("group", { name: "Library item shared-reviewer" }).count()).toBe(1);
    expect(await page.getByRole("group", { name: "Library item shared-reviewer-online" }).count()).toBe(0);
    await expect.poll(async () => readJson<{
        sourceType?: string;
        source?: string;
        updatePolicy?: string;
      }>(join(appDataRoot, "skills-library", "shared-reviewer", ".agentenv-skill.json")))
      .toMatchObject({
        sourceType: "github",
        source: `https://github.com/acme/agent-skills/tree/main/${remotePath}`,
        updatePolicy: "tracked"
      });
    await expect(readFile(join(appDataRoot, "skills-library", "shared-reviewer", "SKILL.md"), "utf8"))
      .resolves.toContain("Review code changes before applying them.");
  }, 45_000);

  it("updates a local library skill from its tracked source", async () => {
    const { librarySkill, page } = await launchApp();

    await writeFile(
      join(librarySkill.sourceDir, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: Updated shared review guidance.\n---\n\n# Shared Reviewer\n\nUse the refreshed source content.\n",
      "utf8"
    );
    await openSkillLibrary(page);
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .waitFor({ state: "visible" });

    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByRole("button", { name: "More actions for shared-reviewer" })
      .click();
    await page
      .getByRole("menu", { name: "Actions for shared-reviewer" })
      .getByRole("menuitem", { name: /Check update|Preview update/ })
      .click();
    await page
      .getByRole("dialog", { name: "Update preview for shared-reviewer" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Apply update shared-reviewer" }).click();
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByText("Updated shared review guidance.")
      .waitFor({ state: "visible" });

    await expect(readFile(join(librarySkill.libraryDir, "SKILL.md"), "utf8")).resolves.toContain(
      "Use the refreshed source content."
    );
  }, 30_000);

  it("configures a local update source before updating a library skill", async () => {
    const { appDataRoot, librarySkill, page } = await launchApp();
    const newSourceDir = join(appDataRoot, "alternate-source-skills", "shared-reviewer");
    await mkdir(newSourceDir, { recursive: true });
    await writeFile(
      join(newSourceDir, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: Alternate source guidance.\n---\n\n# Shared Reviewer\n\nUse the alternate configured source.\n",
      "utf8"
    );

    await openSkillLibrary(page);
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .waitFor({ state: "visible" });
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByRole("button", { name: "More actions for shared-reviewer" })
      .click();
    await page.getByRole("menuitem", { name: "Update settings" }).click();
    await page.getByLabel("Update source for shared-reviewer").fill(newSourceDir);
    await page.getByRole("button", { name: "Save source" }).click();
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByText(newSourceDir)
      .waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Review update shared-reviewer" }).click();
    await page
      .getByRole("dialog", { name: "Update preview for shared-reviewer" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Apply update shared-reviewer" }).click();
    await expect.poll(() => page.getByRole("status").textContent()).toContain("Updated shared-reviewer");
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByText("Alternate source guidance.")
      .waitFor({ state: "visible" });

    await expect(readFile(join(librarySkill.libraryDir, "SKILL.md"), "utf8")).resolves.toContain(
      "Use the alternate configured source."
    );
  }, 30_000);

  it("applies reusable MCP library refs to multiple agent targets", async () => {
    const { codexDir, opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    await expect(readFile(join(opencodeDir, "opencode.jsonc"), "utf8")).resolves.toContain(
      "https://example.com/shared-docs/mcp"
    );

    await selectTarget(page, "Codex");
    await selectProfile(page, "UI Codex alpha");
    await previewAndApply(page, "Codex");
    await expect(readFile(join(codexDir, "config.toml"), "utf8")).resolves.toContain(
      "[mcp_servers.shared-docs]"
    );
    await expect(readFile(join(codexDir, "config.toml"), "utf8")).resolves.toContain(
      'url = "https://example.com/shared-docs/mcp"'
    );
  }, 30_000);

  it("adds reusable MCP servers to a profile from the rendered Resources picker", async () => {
    const { opencodeDir, page } = await launchApp();

    await page.getByRole("button", { name: "MCPs" }).click();
    await page.getByRole("region", { name: "MCP library" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Add MCP" }).click();
    await page.getByLabel("MCP library id").fill("local-search");
    await page.getByLabel("MCP library name").fill("Local Search");
    await page.getByLabel("MCP command").fill("node");
    await page.getByLabel("MCP args").fill("server.js\n--stdio");
    await page.getByLabel("MCP env").fill("SEARCH_TOKEN");
    await page.getByRole("button", { name: "Add to library" }).click();
    await page
      .getByRole("group", { name: "MCP library item local-search" })
      .waitFor({ state: "visible" });

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "MCPs");
    await page.getByRole("button", { name: "Add library MCP" }).click();
    const picker = page.getByRole("dialog", { name: "Add library MCP servers" });
    await picker.waitFor({ state: "visible" });
    expect(await picker.getByLabel("Shared Docs").isDisabled()).toBe(true);
    await picker.getByLabel("Local Search").check();
    await picker.getByRole("button", { name: "Add selected MCP servers" }).click();
    await picker.waitFor({ state: "hidden" });
    await page
      .getByRole("group", { name: "MCP local-search" })
      .waitFor({ state: "visible" });

    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    await expect(readFile(join(opencodeDir, "opencode.jsonc"), "utf8")).resolves.toContain(
      "local-search"
    );
    await expect(readFile(join(opencodeDir, "opencode.jsonc"), "utf8")).resolves.toContain(
      "server.js"
    );
    await expect(readFile(join(opencodeDir, "opencode.jsonc"), "utf8")).resolves.toContain(
      '"SEARCH_TOKEN": "{env:SEARCH_TOKEN}"'
    );
    await expect(readFile(join(opencodeDir, "opencode.jsonc"), "utf8")).resolves.toContain(
      '"environment"'
    );
  }, 30_000);

  it("switches OpenCode profiles through the rendered app and restores from history", async () => {
    const { homeDir, opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    await expect(readFile(join(opencodeDir, "AGENTS.md"), "utf8")).resolves.toContain(
      "Active UI profile: alpha"
    );
    await expect(
      fileExists(join(opencodeDir, "agents", "ui-alpha-agent", "agent.md"))
    ).resolves.toBe(true);

    await selectProfile(page, "UI OpenCode beta");
    await previewAndApply(page, "OpenCode");
    const betaConfig = await readFile(join(opencodeDir, "opencode.jsonc"), "utf8");
    await expect(readFile(join(opencodeDir, "AGENTS.md"), "utf8")).resolves.toContain(
      "Active UI profile: beta"
    );
    expect(betaConfig).toContain("ui-beta-mcp");
    expect(betaConfig).not.toContain("ui-alpha-mcp");
    expect(betaConfig).toContain("user-managed");
    await expect(fileExists(join(opencodeDir, "agents", "ui-alpha-agent"))).resolves.toBe(
      false
    );
    await expect(fileExists(join(opencodeDir, "skills", "ui-alpha-skill"))).resolves.toBe(
      false
    );
    await expect(fileExists(join(opencodeDir, "skills", "ui-beta-skill", "SKILL.md"))).resolves.toBe(
      true
    );

    await expandComposerSection(page, "Advanced");
    await page.getByRole("button", { name: /Preview restore/ }).first().click();
    const rollbackDialog = page.getByRole("dialog", { name: "Preview" });
    await rollbackDialog.getByRole("button", { name: "Restore backup" }).waitFor({ state: "visible" });
    await writeFile(join(opencodeDir, "AGENTS.md"), "# External edit after rollback preview\n");
    await rollbackDialog.getByRole("button", { name: "Restore backup" }).click();
    await expect.poll(() => rollbackDialog.textContent()).toContain(
      "Agent files changed after the rollback preview"
    );
    await expect(readFile(join(opencodeDir, "AGENTS.md"), "utf8")).resolves.toBe(
      "# External edit after rollback preview\n"
    );
    await rollbackDialog.getByRole("button", { name: "Cancel" }).click();

    const restoreTriggers = page.getByRole("button", { name: /Preview restore/ });
    await restoreTriggers.first().click({ timeout: 5_000 });
    await rollbackDialog.getByRole("button", { name: "Restore backup" }).click();
    await rollbackDialog.waitFor({ state: "hidden" });
    await expect(readFile(join(opencodeDir, "AGENTS.md"), "utf8")).resolves.toContain(
      "Active UI profile: alpha"
    );
    await expect(fileExists(join(opencodeDir, "agents", "ui-beta-agent"))).resolves.toBe(
      false
    );
  }, 30_000);

  it("applies an OpenCode profile's portable resources to Codex and then reports it applied", async () => {
    const { codexDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await selectTarget(page, "Codex");
    await applyActionButton(page, "Codex").click();

    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });
    await expect
      .poll(() => previewDialog.textContent())
      .toContain("opencode Advanced config is Agent-specific and is not applied to Codex");
    await previewDialog.getByRole("checkbox", { name: /will not be applied to Codex/i }).check();
    await previewDialog.getByRole("button", { name: "Apply profile" }).click();
    await previewDialog.waitFor({ state: "hidden" });

    await expect(readFile(join(codexDir, "AGENTS.md"), "utf8")).resolves.toContain(
      "Active UI profile: alpha"
    );
    await expect(
      readFile(join(codexDir, "skills", "ui-alpha-skill", "SKILL.md"), "utf8")
    ).resolves.toContain("alpha skill prompt");
    await expect(fileExists(join(codexDir, "agents", "ui-alpha-agent"))).resolves.toBe(false);
    await expect
      .poll(() => page.getByRole("button", { name: "Apply", exact: true }).isDisabled())
      .toBe(true);

    const profileRow = page.getByRole("button", { name: /UI OpenCode alpha/ });
    await expect
      .poll(() => profileRow.locator(".profile-row__deployments").getAttribute("aria-label"))
      .toBe("Active on: Codex");

    await selectTarget(page, "OpenCode");
    await previewAndApply(page, "OpenCode");
    await expect
      .poll(() => profileRow.locator(".profile-row__deployments").getAttribute("aria-label"))
      .toBe("Active on: OpenCode, Codex");
    await resizeAppWindow(page, 920, 620);
    const deploymentGeometry = await profileRow.locator(".profile-row__deployments").evaluate(
      (element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        targetCount: element.querySelectorAll(".profile-target-chip").length
      })
    );
    expect(deploymentGeometry.targetCount).toBe(2);
    expect(deploymentGeometry.scrollWidth - deploymentGeometry.clientWidth).toBeLessThanOrEqual(1);
  }, 30_000);

  it("switches Codex profiles through the rendered app without touching auth", async () => {
    const { codexDir, page } = await launchApp();

    await page.getByRole("button", { name: "Profiles" }).click();
    await selectTarget(page, "Codex");
    await selectProfile(page, "UI Codex alpha");
    await previewAndApply(page, "Codex");
    await expect(readFile(join(codexDir, "AGENTS.md"), "utf8")).resolves.toContain(
      "Active Codex UI profile: alpha"
    );

    await selectProfile(page, "UI Codex beta");
    await previewAndApply(page, "Codex");
    const betaConfig = await readFile(join(codexDir, "config.toml"), "utf8");

    await expect(readFile(join(codexDir, "auth.json"), "utf8")).resolves.toBe(
      '{"token":"ui-keep"}\n'
    );
    expect(betaConfig).toContain('model = "gpt-5"');
    expect(betaConfig).toContain("[mcp_servers.user_docs]");
    expect(betaConfig).toContain("[mcp_servers.ui_codex_beta]");
    expect(betaConfig).not.toContain("[mcp_servers.ui_codex_alpha]");
    await expect(
      readFile(join(codexDir, "agents", "ui-codex-beta-agent.toml"), "utf8")
    ).resolves.toContain("beta Codex agent prompt");
    await expect(
      fileExists(join(codexDir, "agents", "ui-codex-alpha-agent.toml"))
    ).resolves.toBe(false);
    await expect(
      readFile(join(codexDir, "skills", "ui-codex-beta-skill", "SKILL.md"), "utf8")
    ).resolves.toContain("beta Codex skill prompt");
  }, 30_000);

  it("keeps the shared desktop visual contract stable across workspaces and review surfaces", async () => {
    const { page } = await launchApp();
    await resizeAppWindow(page, 920, 620);
    const sidebar = page.locator(".global-sidebar");

    const headerMetrics: Array<{ fontSize: string; left: number; top: number }> = [];
    for (const workspace of ["Skills", "MCPs", "Profiles", "Agents", "Settings"]) {
      await sidebar.getByRole("button", { name: workspace, exact: true }).click();
      const header = page.locator(".ui-page-header").first();
      await header.waitFor({ state: "visible" });
      const metrics = await header.evaluate((element) => {
        const title = element.querySelector<HTMLElement>("h2")!;
        const titleBox = title.getBoundingClientRect();
        const actionHeights = Array.from(
          element.querySelectorAll<HTMLElement>(".ui-page-header__actions button")
        ).map((button) => button.getBoundingClientRect().height);
        return {
          actionHeights,
          fontSize: getComputedStyle(title).fontSize,
          left: Math.round(titleBox.left),
          top: Math.round(titleBox.top),
          contained: element.scrollWidth <= element.clientWidth + 1
        };
      });
      expect(metrics.contained).toBe(true);
      expect(metrics.actionHeights.every((height) => Math.abs(height - 34) <= 1)).toBe(true);
      headerMetrics.push({ fontSize: metrics.fontSize, left: metrics.left, top: metrics.top });
    }
    expect(new Set(headerMetrics.map((metric) => metric.fontSize))).toEqual(new Set(["23px"]));
    expect(Math.max(...headerMetrics.map((metric) => metric.left)) - Math.min(...headerMetrics.map((metric) => metric.left))).toBeLessThanOrEqual(1);
    expect(Math.max(...headerMetrics.map((metric) => metric.top)) - Math.min(...headerMetrics.map((metric) => metric.top))).toBeLessThanOrEqual(1);

    await sidebar.getByRole("button", { name: "Skills", exact: true }).click();
    const windowChrome = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(".global-sidebar")!;
      const editorPanel = document.querySelector<HTMLElement>(".editor-panel")!;
      const editorDragStrip = document.querySelector<HTMLElement>(".window-drag-strip")!;
      const brand = document.querySelector<HTMLElement>(".brand-lockup")!;
      const pageHeader = document.querySelector<HTMLElement>(".ui-page-header")!;
      const pageHeaderButton = pageHeader.querySelector<HTMLElement>("button")!;
      const navigation = document.querySelector<HTMLElement>(".workspace-nav")!;
      const appRegion = (element: HTMLElement) =>
        getComputedStyle(element).getPropertyValue("-webkit-app-region");
      return {
        brandTop: Math.round(brand.getBoundingClientRect().top),
        editorPaddingTop: getComputedStyle(editorPanel).paddingTop,
        editorDragStripHeight: Math.round(editorDragStrip.getBoundingClientRect().height),
        editorDragStripLeft: Math.round(editorDragStrip.getBoundingClientRect().left),
        editorDragStripRegion: appRegion(editorDragStrip),
        editorDragStripRight: Math.round(editorDragStrip.getBoundingClientRect().right),
        editorLeft: Math.round(editorPanel.getBoundingClientRect().left),
        editorRight: Math.round(editorPanel.getBoundingClientRect().right),
        headerButtonRegion: appRegion(pageHeaderButton),
        navigationRegion: appRegion(navigation),
        pageHeaderRegion: appRegion(pageHeader),
        platform: document.documentElement.dataset.platform,
        sidebarPaddingTop: getComputedStyle(sidebar).paddingTop,
        sidebarRegion: appRegion(sidebar)
      };
    });
    expect(windowChrome.platform).toBe(process.platform);
    if (process.platform === "darwin") {
      expect(windowChrome).toMatchObject({
        editorPaddingTop: "38px",
        editorDragStripHeight: 38,
        editorDragStripRegion: "drag",
        headerButtonRegion: "no-drag",
        navigationRegion: "no-drag",
        pageHeaderRegion: "drag",
        sidebarPaddingTop: "38px",
        sidebarRegion: "drag"
      });
      expect(windowChrome.editorDragStripLeft).toBe(windowChrome.editorLeft);
      expect(windowChrome.editorDragStripRight).toBe(windowChrome.editorRight);
      expect(windowChrome.brandTop).toBeGreaterThanOrEqual(42);
      expect(Math.min(...headerMetrics.map((metric) => metric.top))).toBeGreaterThanOrEqual(38);
    }

    const navigationAlignment = await sidebar.locator(".workspace-button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const buttonBox = button.getBoundingClientRect();
        const iconBox = button.querySelector<HTMLElement>(".workspace-button__icon")!.getBoundingClientRect();
        const labelBox = button
          .querySelector<HTMLElement>(":scope > span:not(.workspace-button__icon)")!
          .getBoundingClientRect();
        const center = (box: DOMRect) => box.top + box.height / 2;
        return {
          iconOffset: Math.abs(center(iconBox) - center(buttonBox)),
          labelOffset: Math.abs(center(labelBox) - center(buttonBox))
        };
      })
    );
    for (const alignment of navigationAlignment) {
      expect(alignment.iconOffset).toBeLessThanOrEqual(1);
      expect(alignment.labelOffset).toBeLessThanOrEqual(1);
    }

    await sidebar.getByRole("button", { name: "Skills", exact: true }).click();
    const skillFrameGeometry = await page.locator(".skill-library-panel").evaluate((frame) => {
      const box = frame.getBoundingClientRect();
      const edge = getComputedStyle(frame, "::after");
      return {
        bottom: edge.borderBottomWidth,
        childrenContained: Array.from(frame.children).every((child) => {
          const childBox = child.getBoundingClientRect();
          return (
            childBox.left >= box.left + 1 &&
            childBox.right <= box.right - 1 &&
            childBox.top >= box.top + 1 &&
            childBox.bottom <= box.bottom - 1
          );
        }),
        left: edge.borderLeftWidth,
        right: edge.borderRightWidth,
        top: edge.borderTopWidth
      };
    });
    expect(skillFrameGeometry).toEqual({
      bottom: "1px",
      childrenContained: true,
      left: "1px",
      right: "1px",
      top: "1px"
    });

    await sidebar.getByRole("button", { name: "MCPs", exact: true }).click();
    const mcpSearchGeometry = await page.locator(".mcp-library-search").evaluate((field) => {
      const fieldBox = field.getBoundingClientRect();
      const inputBox = field.querySelector("input")!.getBoundingClientRect();
      return {
        bottomInset: fieldBox.bottom - inputBox.bottom,
        leftInset: inputBox.left - fieldBox.left,
        rightInset: fieldBox.right - inputBox.right,
        topInset: inputBox.top - fieldBox.top
      };
    });
    expect(mcpSearchGeometry.bottomInset).toBeGreaterThanOrEqual(1);
    expect(mcpSearchGeometry.leftInset).toBeGreaterThanOrEqual(30);
    expect(mcpSearchGeometry.rightInset).toBeGreaterThanOrEqual(1);
    expect(mcpSearchGeometry.topInset).toBeGreaterThanOrEqual(1);
    const mcpRow = page.locator(".mcp-library-row").first();
    await mcpRow.waitFor({ state: "visible" });
    const mcpGeometry = await mcpRow.evaluate((row) => {
      const icon = row.querySelector<HTMLElement>(".ui-resource-row__icon")!.getBoundingClientRect();
      const actions = row.querySelector<HTMLElement>(".ui-resource-row__actions")!.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      return {
        actionCount: row.querySelectorAll(".ui-resource-row__actions > button").length,
        actionsContained: actions.right <= box.right + 1,
        columnCount: getComputedStyle(row).gridTemplateColumns.split(" ").length,
        iconHeight: icon.height,
        iconWidth: icon.width,
        rowHeight: box.height,
        rowContained: row.scrollWidth <= row.clientWidth + 1
      };
    });
    expect(mcpGeometry).toEqual({
      actionCount: 1,
      actionsContained: true,
      columnCount: 5,
      iconHeight: 30,
      iconWidth: 30,
      rowHeight: 58,
      rowContained: true
    });

    await mcpRow.getByRole("button", { name: /More actions for/ }).click();
    const mcpMenu = page.locator(".mcp-row-action-menu.ui-action-menu");
    await mcpMenu.waitFor({ state: "visible" });
    const mcpMenuWidth = await mcpMenu.evaluate((menu) => menu.getBoundingClientRect().width);
    expect(mcpMenuWidth).toBe(220);
    await page.keyboard.press("Escape");

    await sidebar.getByRole("button", { name: "Profiles", exact: true }).click();
    await page.locator(".profile-hero").waitFor({ state: "visible" });
    const profileSearchGeometry = await page.locator(".profile-search").evaluate((field) => {
      const fieldBox = field.getBoundingClientRect();
      const inputBox = field.querySelector("input")!.getBoundingClientRect();
      return {
        bottomInset: fieldBox.bottom - inputBox.bottom,
        leftInset: inputBox.left - fieldBox.left,
        rightInset: fieldBox.right - inputBox.right,
        topInset: inputBox.top - fieldBox.top
      };
    });
    expect(profileSearchGeometry.bottomInset).toBeGreaterThanOrEqual(1);
    expect(profileSearchGeometry.leftInset).toBeGreaterThanOrEqual(30);
    expect(profileSearchGeometry.rightInset).toBeGreaterThanOrEqual(1);
    expect(profileSearchGeometry.topInset).toBeGreaterThanOrEqual(1);
    const profileActionGeometry = await page.locator(".profile-action-stack").evaluate((stack) => {
      const status = stack.querySelector<HTMLElement>(".profile-action-status")!;
      const actions = stack.querySelector<HTMLElement>(".profile-commit-actions")!;
      const statusBox = status.getBoundingClientRect();
      const actionsBox = actions.getBoundingClientRect();
      const overlaps = !(
        statusBox.right <= actionsBox.left ||
        actionsBox.right <= statusBox.left ||
        statusBox.bottom <= actionsBox.top ||
        actionsBox.bottom <= statusBox.top
      );
      return {
        actionsContained: actionsBox.right <= stack.getBoundingClientRect().right + 1,
        overlaps,
        statusBeforeActions: statusBox.top <= actionsBox.top,
        statusFits: status.scrollWidth <= status.clientWidth + 1
      };
    });
    expect(profileActionGeometry).toEqual({
      actionsContained: true,
      overlaps: false,
      statusBeforeActions: true,
      statusFits: true
    });
    await expandComposerSection(page, "Skills");
    const profileSkillGeometry = await page.locator(".profile-skill-manager").evaluate((manager) => {
      const icon = manager.querySelector<HTMLElement>(".profile-skill-icon")!;
      return {
        border: getComputedStyle(manager).borderTopWidth,
        iconBackground: getComputedStyle(icon).backgroundColor,
        radius: getComputedStyle(manager).borderRadius,
        rowContained: Array.from(manager.querySelectorAll<HTMLElement>(".profile-skill-row")).every(
          (row) => row.scrollWidth <= row.clientWidth + 1
        )
      };
    });
    expect(profileSkillGeometry).toEqual({
      border: "0px",
      iconBackground: "rgba(0, 0, 0, 0)",
      radius: "0px",
      rowContained: true
    });

    await sidebar.getByRole("button", { name: "Agents", exact: true }).click();
    const targetListGeometry = await page.locator(".target-list").evaluate((list) => {
      const rows = Array.from(list.querySelectorAll<HTMLElement>(".target-card--workflow"));
      const listBox = list.getBoundingClientRect();
      return {
        contained: rows.every((row) => {
          const box = row.getBoundingClientRect();
          return box.left >= listBox.left && box.right <= listBox.right;
        }),
        continuous: rows.slice(1).every((row, index) => {
          const previous = rows[index].getBoundingClientRect();
          return Math.abs(row.getBoundingClientRect().top - previous.bottom) <= 1;
        }),
        flatRows: rows.every((row) => {
          const style = getComputedStyle(row);
          return style.borderRadius === "0px" && style.boxShadow === "none";
        }),
        healthBackgroundsAreNeutral: rows.every((row) => {
          const status = row.querySelector<HTMLElement>(".target-health-status")!;
          return getComputedStyle(status).backgroundColor === "rgba(0, 0, 0, 0)";
        })
      };
    });
    expect(targetListGeometry).toEqual({
      contained: true,
      continuous: true,
      flatRows: true,
      healthBackgroundsAreNeutral: true
    });

    await sidebar.getByRole("button", { name: "Settings", exact: true }).click();
    const preferenceGeometry = await page.locator(".settings-preference-row").evaluateAll((rows) =>
      rows.map((row) => {
        const copy = row.querySelector<HTMLElement>(".settings-preference-copy")!;
        const control = row.querySelector<HTMLElement>(":scope > select, :scope > .ui-switch, :scope > .settings-readonly-value, :scope > .settings-interval-control")!;
        const rowBox = row.getBoundingClientRect();
        const copyBox = copy.getBoundingClientRect();
        const controlBox = control.getBoundingClientRect();
        return {
          contained:
            copyBox.left >= rowBox.left &&
            controlBox.right <= rowBox.right + 1 &&
            row.scrollWidth <= row.clientWidth + 1,
          overlaps: !(
            copyBox.right <= controlBox.left ||
            controlBox.right <= copyBox.left ||
            copyBox.bottom <= controlBox.top ||
            controlBox.bottom <= copyBox.top
          )
        };
      })
    );
    expect(preferenceGeometry.length).toBeGreaterThanOrEqual(5);
    expect(preferenceGeometry.every((row) => row.contained && !row.overlaps)).toBe(true);

    await sidebar.getByRole("button", { name: "Skills", exact: true }).click();
    await page.getByRole("button", { name: "Scan local" }).click();
    const cleanupRow = page.locator(".cleanup-group-row").first();
    await cleanupRow.waitFor({ state: "visible" });
    const cleanupGeometry = await cleanupRow.evaluate((row) => {
      const state = row.querySelector<HTMLElement>(".cleanup-group-state")!;
      const actions = row.querySelector<HTMLElement>(".cleanup-group-actions")!;
      const stateBox = state.getBoundingClientRect();
      const actionsBox = actions.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      return {
        aligned: Math.abs(
          stateBox.top + stateBox.height / 2 - (actionsBox.top + actionsBox.height / 2)
        ) <= 1,
        contained: actionsBox.right <= rowBox.right + 1 && row.scrollWidth <= row.clientWidth + 1,
        separated: actionsBox.left >= stateBox.right + 6,
        stateFits: state.scrollWidth <= state.clientWidth + 1
      };
    });
    expect(cleanupGeometry).toEqual({
      aligned: true,
      contained: true,
      separated: true,
      stateFits: true
    });
  }, 60_000);
});
