import { constants } from "node:fs";
import { access } from "node:fs/promises";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { delimiter, join } from "node:path";
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
  variant: "alpha" | "beta"
) => {
  const profileId = `ui-opencode-${variant}`;
  const profileDir = join(appDataRoot, "profiles", profileId);
  await mkdir(join(profileDir, "agents", `${variant}-agent`), { recursive: true });
  await mkdir(join(profileDir, "skills", `${variant}-skill`), { recursive: true });
  await writeJson(join(profileDir, "profile.json"), {
    id: profileId,
    targetId: "opencode",
    name: `UI OpenCode ${variant}`,
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

const launchApp = async (
  options: {
    openCodeAlphaLibrarySkillCount?: number;
    mcpLibraryCount?: number;
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
  await mkdir(binDir, { recursive: true });
  await mkdir(opencodeDir, { recursive: true });
  await mkdir(codexDir, { recursive: true });
  const opencodeExecutable = join(binDir, "opencode");
  const codexExecutable = join(binDir, "codex");
  await writeFile(opencodeExecutable, "#!/bin/sh\necho fake-opencode\n", "utf8");
  await chmod(opencodeExecutable, 0o755);
  await writeFile(codexExecutable, "#!/bin/sh\necho fake-codex\n", "utf8");
  await chmod(codexExecutable, 0o755);
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
  await writeOpenCodeProfile(appDataRoot, "beta");
  await writeCodexProfile(appDataRoot, "alpha");
  await writeCodexProfile(appDataRoot, "beta");
  const librarySkill = await writeLibrarySkill(appDataRoot);
  if (options.openCodeAlphaLibrarySkillCount) {
    await addOpenCodeAlphaLibrarySkills(appDataRoot, options.openCodeAlphaLibrarySkillCount);
  }
  await writeGitHubFixtureSkill(githubFixtureRoot, "v1");
  await writeUnmanagedTargetSkill(opencodeDir);
  await writeMcpLibrary(appDataRoot, options.mcpLibraryCount);

  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(process.cwd(), "out", "main", "main.js")],
    env: {
      ...process.env,
      AGENTENV_AUTOMATION: "1",
      AGENTENV_DATA_ROOT: appDataRoot,
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
  await page.getByRole("button", { name: "Select apply target" }).click();
  const targetMenu = page.getByRole("menu", { name: "Apply targets" });
  await page.getByRole("menuitemradio", { name }).click();
  await targetMenu.waitFor({ state: "hidden" });
};

type ComposerSectionName = "Instructions" | "Skills" | "MCP Servers" | "Advanced";

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

const applyActionButton = (page: Page, _targetName: "OpenCode" | "Codex") =>
  page.getByRole("button", { name: "Apply", exact: true }).first();

const previewAndApply = async (page: Page, targetName: "OpenCode" | "Codex") => {
  await applyActionButton(page, targetName).click();
  const previewDialog = page.getByRole("dialog", { name: "Preview" });
  await previewDialog.waitFor({ state: "visible" });
  await previewDialog.getByRole("button", { name: "Apply profile" }).click();
  await previewDialog.waitFor({ state: "hidden" });
};

const saveProfile = async (page: Page) => {
  const saveButton = page.getByRole("button", { name: "Save", exact: true });
  await saveButton.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => saveButton.isDisabled()).toBe(true);
};

const addLibrarySkillToProfile = async (page: Page, skillName = "Shared Reviewer") => {
  await page.getByRole("button", { name: "Add library skill" }).click();
  const picker = page.getByRole("dialog", { name: "Add library skills" });
  await picker.waitFor({ state: "visible" });
  await picker.getByLabel(skillName).check();
  await picker.getByRole("button", { name: "Add selected skills" }).click();
  await picker.waitFor({ state: "hidden" });
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
    await page
      .getByLabel("GitHub skill URL")
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
    const editorPanel = page.getByRole("region", { name: "Library workspace" });

    await navigation.getByRole("button", { name: "Skills", exact: true }).click();
    await expect
      .poll(() =>
        editorPanel.evaluate((element) => element.scrollHeight - element.clientHeight)
      )
      .toBeGreaterThan(100);
    await editorPanel.evaluate((element) => {
      element.scrollTop = Math.min(220, element.scrollHeight - element.clientHeight);
    });
    expect(await editorPanel.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    await page.getByRole("textbox", { name: "Search skills" }).fill("layout-skill");
    expect(await editorPanel.evaluate((element) => element.scrollTop)).toBe(0);
    await page.getByRole("combobox", { name: "Skill source filter" }).selectOption("local");
    await page.getByRole("tab", { name: /In use/ }).click();
    await page
      .getByRole("combobox", { name: "Skill target filter" })
      .selectOption("not-installed");
    await page.getByRole("tab", { name: /Updates/ }).click();
    await expect.poll(() => editorPanel.evaluate((element) => element.scrollTop)).toBe(0);
    await expect
      .poll(() =>
        editorPanel.evaluate((element) => element.scrollHeight - element.clientHeight)
      )
      .toBeGreaterThan(100);
    await editorPanel.evaluate((element) => {
      element.scrollTop = Math.min(280, element.scrollHeight - element.clientHeight);
    });
    const skillScroll = await editorPanel.evaluate((element) => element.scrollTop);
    expect(skillScroll).toBeGreaterThan(100);

    await navigation.getByRole("button", { name: "MCP Servers", exact: true }).click();
    await page.getByRole("textbox", { name: "Search MCP servers" }).fill("Fixture MCP");
    await editorPanel.evaluate((element) => {
      element.scrollTop = Math.min(240, element.scrollHeight - element.clientHeight);
    });
    const mcpScroll = await editorPanel.evaluate((element) => element.scrollTop);
    expect(mcpScroll).toBeGreaterThan(100);

    await navigation.getByRole("button", { name: "Profiles", exact: true }).click();
    await navigation.getByRole("button", { name: "Skills", exact: true }).click();
    expect(await page.getByRole("textbox", { name: "Search skills" }).inputValue()).toBe(
      "layout-skill"
    );
    expect(await page.getByRole("combobox", { name: "Skill source filter" }).inputValue()).toBe(
      "local"
    );
    expect(await page.getByRole("combobox", { name: "Skill target filter" }).inputValue()).toBe(
      "not-installed"
    );
    expect(await page.getByRole("tab", { name: /In use/ }).getAttribute("aria-selected")).toBe(
      "true"
    );
    expect(await page.getByRole("tab", { name: /Updates/ }).getAttribute("aria-selected")).toBe(
      "true"
    );
    await expect
      .poll(async () =>
        Math.abs((await editorPanel.evaluate((element) => element.scrollTop)) - skillScroll)
      )
      .toBeLessThanOrEqual(2);

    await navigation.getByRole("button", { name: "MCP Servers", exact: true }).click();
    expect(await page.getByRole("textbox", { name: "Search MCP servers" }).inputValue()).toBe(
      "Fixture MCP"
    );
    await expect
      .poll(async () =>
        Math.abs((await editorPanel.evaluate((element) => element.scrollTop)) - mcpScroll)
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

    await navigation.getByRole("button", { name: "MCP Servers", exact: true }).click();
    await page.keyboard.press("Meta+f");
    expect(
      await page
        .getByRole("textbox", { name: "Search MCP servers" })
        .evaluate((element) => document.activeElement === element)
    ).toBe(true);

    await navigation.getByRole("button", { name: "Targets", exact: true }).click();
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

    await page.getByRole("button", { name: "MCP Servers", exact: true }).click();
    const mcpSearch = page.getByRole("textbox", { name: "Search MCP servers" });
    await page.getByRole("button", { name: "Add MCP server" }).click();
    const editor = page.getByRole("dialog", { name: "MCP server editor" });
    await page.keyboard.press("Meta+f");
    await expectFocusInside(editor);
    expect(await mcpSearch.evaluate((element) => document.activeElement === element)).toBe(false);
    await page.keyboard.press("Escape");

    const sharedMcp = page.getByRole("group", { name: "MCP library item shared-docs" });
    await sharedMcp.getByRole("button", { name: "Remove shared-docs" }).click();
    const mcpDelete = page.getByRole("dialog", { name: "Delete MCP server" });
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
          .getByRole("button", { name: "Remove shared-docs" })
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
      const sourceFilter = page.getByRole("combobox", { name: "Skill source filter" });
      await sourceFilter.selectOption("github");
      await expect.poll(() => allRows.count()).toBe(0);
      await sourceFilter.selectOption("local");
      await expect.poll(() => allRows.count()).toBe(testCase.count + 2);
      await sourceFilter.selectOption("all");
      await page.getByRole("tab", { name: /In use/ }).click();
      await expect.poll(() => allRows.count()).toBe(testCase.count);
      await page.getByRole("tab", { name: /Unused/ }).click();
      await expect.poll(() => allRows.count()).toBe(2);
      await allTab.click();
      const targetFilter = page.getByRole("combobox", { name: "Skill target filter" });
      await targetFilter.selectOption("managed");
      await expect.poll(() => allRows.count()).toBe(0);
      await targetFilter.selectOption("all");
      await expect.poll(() => allRows.count()).toBe(testCase.count + 2);

      await expectNoHorizontalOverflow(page, [".app-shell", ".editor-panel"]);

      const changingRow = page.getByRole("group", {
        name: "Library item layout-skill-1",
        exact: true
      });
      const updateActionGeometry = await changingRow.evaluate((row) => {
        const updateCell = row.querySelector<HTMLElement>(".library-update-cell")!;
        const updateButton = updateCell.querySelector<HTMLButtonElement>(".library-row-inline-action")!;
        const actionsCell = row.querySelector<HTMLElement>(".library-actions-cell")!;
        const updateRect = updateCell.getBoundingClientRect();
        const buttonRect = updateButton.getBoundingClientRect();
        const actionsRect = actionsCell.getBoundingClientRect();
        return {
          buttonFitsText: updateButton.scrollWidth <= updateButton.clientWidth,
          buttonInsideUpdateColumn:
            buttonRect.left >= updateRect.left - 1 && buttonRect.right <= updateRect.right + 1,
          columnsDoNotOverlap: updateRect.right <= actionsRect.left
        };
      });
      expect(updateActionGeometry).toEqual({
        buttonFitsText: true,
        buttonInsideUpdateColumn: true,
        columnsDoNotOverlap: true
      });
      await expectTextFits(changingRow.locator(".library-row-inline-action"));
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

    await page.getByRole("button", { name: "Targets" }).click();
    const targetsPage = page.getByRole("region", { name: "Targets", exact: true });
    await targetsPage.waitFor({ state: "visible" });

    const openCodeCard = page.getByRole("article", { name: "Target OpenCode" });
    await openCodeCard.waitFor({ state: "visible" });
    await expect.poll(() => openCodeCard.textContent()).toContain("Ready");
    await expect.poll(() => openCodeCard.textContent()).toContain("Not managed");
    await openCodeCard.getByRole("button", { name: "Show OpenCode diagnostics" }).click();
    await expect.poll(() => openCodeCard.textContent()).toContain(
      join(homeDir, ".config", "opencode")
    );
    await expect.poll(() => openCodeCard.textContent()).toContain("Config directory");
    await expect.poll(() => openCodeCard.textContent()).toContain("Writable");

    const codexCard = page.getByRole("article", { name: "Target Codex" });
    await codexCard.waitFor({ state: "visible" });
    await expect.poll(() => codexCard.textContent()).toContain("Ready");
    await codexCard.getByRole("button", { name: "Show Codex diagnostics" }).click();
    await expect.poll(() => codexCard.textContent()).toContain(join(homeDir, ".codex"));

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => page.getByRole("status").textContent()).toContain("Targets refreshed");
    await page.getByText("Targets refreshed").waitFor({ state: "hidden", timeout: 7000 });
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

    await page.getByRole("button", { name: "Targets", exact: true }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    const openCodeCard = page.getByRole("article", { name: "Target OpenCode" });
    await expect.poll(() => openCodeCard.textContent()).toContain("Missing");
    const captureCurrent = openCodeCard.getByRole("button", { name: "Create profile from OpenCode" });
    await expect.poll(() => captureCurrent.isDisabled()).toBe(true);
    expect(await captureCurrent.getAttribute("title")).toBe("OpenCode command is missing");
    await expect(readFile(join(opencodeDir, "AGENTS.md"), "utf8")).resolves.toBe(
      originalInstructions
    );
  }, 30_000);

  it("updates target cards after taking over OpenCode", async () => {
    const { page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    await page.getByRole("button", { name: "Targets" }).click();

    const openCodeCard = page.getByRole("article", { name: "Target OpenCode" });
    await openCodeCard.waitFor({ state: "visible" });
    await expect.poll(() => openCodeCard.textContent()).toContain("ManagementApplied");
    await expect.poll(() => openCodeCard.textContent()).toContain("Active profileUI OpenCode alpha");
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
      await page.getByRole("button", { name: "Targets" }).click();
      await page.getByRole("button", { name: "Refresh" }).click();
      const openCodeCard = page.getByRole("article", { name: "Target OpenCode" });
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
    await saveProfile(page);
    await page.getByRole("heading", { name: "Docs Writing v2" }).waitFor({
      state: "visible",
      timeout: 10_000
    });
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
      "Apply another profile or stop managing each Target"
    );
    expect(await deleteDialog.getByRole("button", { name: "Remove profile" }).count()).toBe(0);
    await deleteDialog.getByRole("button", { name: "Open Targets" }).click();
    await page.getByRole("heading", { name: "Targets" }).waitFor({ state: "visible" });

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

    await page.getByRole("button", { name: "Select apply target" }).click({ timeout: 5_000 });
    const targetMenu = page.getByRole("menu", { name: "Apply targets" });
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

    await expect.poll(() => cleanupGroup.textContent()).toContain("Auto-ready");
    await cleanupGroup.getByRole("button", { name: "View details target-only-reviewer" }).click();
    const detailsDialog = page.getByRole("dialog", {
      name: "Skill details target-only-reviewer"
    });
    await detailsDialog.waitFor({ state: "visible" });
    await expect.poll(() => detailsDialog.textContent()).toContain(
      join(opencodeDir, "skills", "target-only-reviewer")
    );
    await page.keyboard.press("Escape");
    await detailsDialog.waitFor({ state: "hidden" });
    await cleanupGroup
      .getByRole("button", { name: "Take over target-only-reviewer" })
      .click();
    await expect
      .poll(() => page.locator(".app-feedback").textContent(), { timeout: 5_000 })
      .toContain("Took over target-only-reviewer");
    await page
      .getByRole("group", { name: "Library item target-only-reviewer" })
      .waitFor({ state: "visible", timeout: 5_000 });
    await expect.poll(() => cleanupGroup.textContent()).toContain("Managed");
    await expect.poll(() => cleanupGroup.textContent()).not.toContain("Duplicate");
    await expect.poll(() => cleanupGroup.textContent()).not.toContain("Auto-ready");
    expect(
      await cleanupGroup.getByRole("button", { name: "Take over target-only-reviewer" }).count()
    ).toBe(0);
    expect(
      await cleanupGroup.getByRole("button", { name: "View details target-only-reviewer" }).count()
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
        join(opencodeDir, "skills", "target-only-reviewer", ".agentenv-owner.json"),
        "utf8"
      )
    ).resolves.toContain('"source": "skills-library/target-only-reviewer"');

    const managedRow = page.getByRole("group", { name: "Library item target-only-reviewer" });
    await managedRow
      .getByRole("button", { name: "More actions for target-only-reviewer" })
      .click();
    await page.getByRole("menuitem", { name: /Remove from library/ }).click();
    const removeDialog = page.getByRole("dialog", { name: "Delete library skill" });
    await expect.poll(() => removeDialog.textContent()).toContain("1 managed target install");
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
      fileExists(join(opencodeDir, "skills", "target-only-reviewer", ".agentenv-owner.json"))
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
      fileExists(join(opencodeDir, "skills", "target-only-reviewer", ".agentenv-owner.json"))
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
    await cleanupGroup.getByRole("button", { name: "Ignore group ui-alpha-skill" }).click();
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

    await page.getByRole("button", { name: "Targets", exact: true }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByText("Targets refreshed", { exact: true }).waitFor({ state: "visible" });
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

  it("shows polished skill row actions and update check feedback in the rendered app", async () => {
    const { page } = await launchApp();

    const sharedRow = page.getByRole("group", { name: "Library item shared-reviewer" });
    await sharedRow.waitFor({ state: "visible" });
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
      .toContain("No Target installs were affected");
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
    await page.getByRole("button", { name: "Select apply target" }).click();
    const targetMenu = page.getByRole("menu", { name: "Apply targets" });
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
    await rowMenu.locator(".info-tip").hover();
    const rowTip = page.getByRole("tooltip");
    await rowTip.waitFor({ state: "visible" });
    await expectInViewport(page, rowTip);
  }, 30_000);

  it("keeps the Profiles workbench contained at the default viewport", async () => {
    const { page } = await launchApp({ openCodeAlphaLibrarySkillCount: 8 });
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

    await page.getByRole("button", { name: "Select apply target" }).click();
    const defaultViewportTargetMenu = page.getByRole("menu", { name: "Apply targets" });
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
    expect(await workbench.evaluate((element) => getComputedStyle(element).gridTemplateColumns))
      .toMatch(/^220px /);
  }, 30_000);

  it("keeps core management actions usable at the minimum supported viewport", async () => {
    const { page } = await launchApp();
    await resizeAppWindow(page, 1180, 728);
    await selectProfile(page, "UI OpenCode alpha");

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
      expect(Math.round(saveBox!.height)).toBe(40);
      expect(Math.round(saveBox!.width)).toBe((page.viewportSize()?.width ?? 0) <= 1050 ? 92 : 104);

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
      expect(profileGeometry.gap).toBeGreaterThanOrEqual(6);
      expect(profileGeometry.gap).toBeLessThanOrEqual(10);
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

    await page.getByRole("button", { name: "Targets" }).click();
    for (const targetName of ["OpenCode", "Claude Code", "Codex"]) {
      await expectInViewport(page, page.getByRole("article", { name: `Target ${targetName}` }));
    }
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
      const skillsGeometry = await readGeometry("Library/Skills", "Import skills");

      const workspaces = [
        { button: "MCP Servers", heading: "Library/MCP Servers", action: "Add MCP server" },
        { button: "Profiles", heading: "Profiles", action: "New Profile" },
        { button: "Targets", heading: "Targets", action: "Refresh" },
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
          expect(new Set(actionGeometry.map((box) => box.y)).size).toBe(1);
          expect(new Set(actionGeometry.map((box) => box.height)).size).toBe(1);
          expect(Math.max(...actionGeometry.map((box) => box.right))).toBeLessThanOrEqual(
            dataSectionRight
          );
        }
      }
    }

    const profilePositions = await Promise.all([skillsButton.boundingBox(), profilesButton.boundingBox()]);
    expect(profilePositions[0]!.y).toBeLessThan(profilePositions[1]!.y);

    await navigation.getByRole("button", { name: "Targets", exact: true }).click();
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

    for (const workspace of ["Skills", "MCP Servers", "Profiles", "Targets", "Settings"]) {
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
    const { page } = await launchApp();
    await resizeAppWindow(page, 1180, 728);
    await selectProfile(page, "UI OpenCode alpha");

    await applyActionButton(page, "OpenCode").click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });

    expect(await previewDialog.evaluate((element) => element.scrollTop)).toBe(0);
    await expectInViewport(page, previewDialog.locator(".preview-header"));
    await expectInViewport(page, previewDialog.locator(".preview-actions"));
    const summaryGrid = previewDialog.locator(".preview-summary-grid");
    await expect.poll(() => summaryGrid.evaluate((element) => getComputedStyle(element).alignItems))
      .toBe("start");
    const summaryCardAlignment = await previewDialog
      .locator(".preview-summary-card")
      .evaluateAll((cards) => cards.map((card) => getComputedStyle(card).alignSelf));
    expect(summaryCardAlignment.length).toBeGreaterThan(0);
    expect(summaryCardAlignment.every((alignment) => alignment === "start")).toBe(true);

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
      expect(geometry.resourceRows.every((height) => height >= 51)).toBe(true);
      expect(geometry.summaryCardsFit).toBe(true);
    };

    await expectPreviewGeometry();
    await resizeAppWindow(page, 920, 620);
    await expectPreviewGeometry();
  }, 30_000);

  it("makes Targets a sequential management workflow with on-demand diagnostics", async () => {
    const { page } = await launchApp();
    await page.setViewportSize({ width: 1180, height: 728 });
    await page.getByRole("button", { name: "Targets", exact: true }).click();

    const openCodeCard = page.getByRole("article", { name: "Target OpenCode" });
    const claudeCard = page.getByRole("article", { name: "Target Claude Code" });
    const [openCodeBox, claudeBox] = await Promise.all([
      openCodeCard.boundingBox(),
      claudeCard.boundingBox()
    ]);
    expect(openCodeBox).not.toBeNull();
    expect(claudeBox).not.toBeNull();
    expect(claudeBox!.y).toBeGreaterThan(openCodeBox!.y);

    await openCodeCard
      .getByRole("button", { name: "Open OpenCode in Profiles" })
      .waitFor({ state: "visible" });
    const diagnostics = openCodeCard.getByRole("button", { name: "Show OpenCode diagnostics" });
    await diagnostics.click();
    await openCodeCard.getByRole("region", { name: "OpenCode diagnostics" }).waitFor({
      state: "visible"
    });

    expect(await page.getByRole("button", { name: "Activity", exact: true }).count()).toBe(0);
    const recoveryTrigger = page.getByRole("button", { name: /Recovery/ });
    await recoveryTrigger.click();
    const recoveryDialog = page.getByRole("dialog", { name: "Recovery" });
    await recoveryDialog.waitFor({ state: "visible" });
    await expectInViewport(page, recoveryDialog);
    await page.keyboard.press("Escape");
    await recoveryDialog.waitFor({ state: "hidden" });
    expect(await recoveryTrigger.evaluate((element) => document.activeElement === element)).toBe(true);

    const codexCard = page.getByRole("article", { name: "Target Codex" });
    await codexCard.getByRole("button", { name: "Open Codex in Profiles" }).click();
    await page.getByRole("region", { name: "Profiles", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "UI OpenCode alpha" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Apply", exact: true }).waitFor({ state: "visible" });
  }, 30_000);

  it("stops managing OpenCode while keeping deployed files and clearing ownership", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    const deployedInstructions = await readFile(join(opencodeDir, "AGENTS.md"), "utf8");

    await page.getByRole("button", { name: "Targets", exact: true }).click();
    const openCodeCard = page.getByRole("article", { name: "Target OpenCode" });
    await openCodeCard.getByRole("button", { name: "Show OpenCode diagnostics" }).click();
    await openCodeCard.getByRole("button", { name: "Stop managing OpenCode" }).click();

    const choiceDialog = page.getByRole("dialog", { name: "Stop managing Target" });
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

    await page.getByRole("button", { name: "Targets", exact: true }).click();
    const openCodeCard = page.getByRole("article", { name: "Target OpenCode" });
    await openCodeCard.getByRole("button", { name: "Show OpenCode diagnostics" }).click();
    await openCodeCard.getByRole("button", { name: "Stop managing OpenCode" }).click();

    const choiceDialog = page.getByRole("dialog", { name: "Stop managing Target" });
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
    await page.getByRole("button", { name: "MCP Servers", exact: true }).click();

    const addButton = page
      .locator(".library-page-header")
      .getByRole("button", { name: "Add MCP server" });
    expect(await addButton.count()).toBe(1);
    expect(
      await page
        .getByRole("region", { name: "MCP library" })
        .getByText("MCP Library", { exact: true })
        .count()
    ).toBe(0);
    expect(await page.getByRole("region", { name: "MCP server editor" }).count()).toBe(0);
    await addButton.click();
    const editor = page.getByRole("dialog", { name: "MCP server editor" });
    await editor.waitFor({ state: "visible" });
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
    expect(await saveButton.isEnabled()).toBe(true);
    expect(await saveButton.getAttribute("class")).toContain("is-primary");
    await expect
      .poll(() =>
        saveButton.evaluate((element) => getComputedStyle(element).backgroundColor)
      )
      .toBe("rgb(23, 105, 245)");
    expect(await applyButton.isDisabled()).toBe(true);
    expect(await applyButton.textContent()).toContain("Apply");

    await saveProfile(page);
    expect(await saveButton.isDisabled()).toBe(true);
    await expect.poll(() => applyButton.isEnabled()).toBe(true);
    await expect
      .poll(() =>
        applyButton.evaluate((element) => getComputedStyle(element).backgroundColor)
      )
      .toBe("rgb(23, 105, 245)");

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
    await page.getByRole("heading", { name: "Library/Skills" }).waitFor({
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
    await navigation.getByRole("button", { name: "Targets", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "Unsaved profile changes" });
    await guard.waitFor({ state: "visible", timeout: 5_000 });
    await guard.getByRole("button", { name: "Discard changes" }).click();
    await page.getByRole("heading", { name: "Targets" }).waitFor({
      state: "visible",
      timeout: 5_000
    });
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
    await expect.poll(() => importedRow.textContent()).toContain("Not tracked");
    await page.getByRole("button", { name: "Close import" }).click();
    await page.getByRole("dialog", { name: "Import skills" }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Check updates" }).click();
    await expect.poll(() => importedRow.textContent()).not.toContain("Check failed");
  }, 30_000);

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
      "back up this Target copy"
    );
    await page.getByRole("button", { name: "Import & manage", exact: true }).click();

    const markerPath = join(localSkillDir, ".agentenv-owner.json");
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
    expect(await cleanupGroup.getByText("Auto-ready", { exact: true }).count()).toBe(0);
    expect(
      await cleanupGroup.getByRole("button", { name: "Take over managed-after-import" }).count()
    ).toBe(0);
    expect(
      await cleanupGroup.getByRole("button", { name: "View details managed-after-import" }).count()
    ).toBe(1);
  }, 30_000);

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
    await expect.poll(() => safeGroup.textContent()).toContain("Auto-ready");
    await expect.poll(() => duplicateGroup.textContent()).toContain("Auto-ready");
    await expect.poll(() => conflictGroup.textContent()).toContain("Review");
    expect(
      await conflictGroup.getByRole("button", { name: "Resolve conflict manual-conflict-reviewer" }).count()
    ).toBe(1);
    await conflictGroup
      .getByRole("button", { name: "Resolve conflict manual-conflict-reviewer" })
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
          const status = row.querySelector<HTMLElement>(".cleanup-group-status")!.getBoundingClientRect();
          const main = row.querySelector<HTMLElement>(".resource-row__main")!.getBoundingClientRect();
          const actions = row.querySelector<HTMLElement>(".cleanup-group-actions")!.getBoundingClientRect();
          return {
            contained:
              status.left >= rowBox.left - 1 &&
              actions.right <= rowBox.right + 1 &&
              status.right <= main.left &&
              main.right <= actions.left,
            textFits: Array.from(row.querySelectorAll<HTMLElement>(".resource-row__main > *")).every(
              (item) => item.clientWidth <= main.width + 1
            )
          };
        });
        return {
          actionBelowCopy: autoAction.top >= headingCopy.bottom - 1,
          actionAfterCopy: autoAction.left >= headingCopy.right,
          actionContained: autoAction.right <= heading.getBoundingClientRect().right + 1,
          rows
        };
      });
      expect(geometry.actionContained).toBe(true);
      expect(stacked ? geometry.actionBelowCopy : geometry.actionAfterCopy).toBe(true);
      expect(geometry.rows.every((row) => row.contained && row.textFits)).toBe(true);
    };
    await assertCleanupLayout(false);
    await resizeAppWindow(page, 920, 620);
    await assertCleanupLayout(true);

    await duplicateGroup
      .getByRole("button", { name: "Take over auto-duplicate-reviewer" })
      .click();
    await expect
      .poll(() => fileExists(join(openCodeDuplicate, ".agentenv-owner.json")), { timeout: 10_000 })
      .toBe(true);
    await expect
      .poll(() => fileExists(join(codexDuplicate, ".agentenv-owner.json")), { timeout: 10_000 })
      .toBe(true);
    await expect.poll(() => duplicateGroup.textContent()).toContain("Managed");
    await expect
      .poll(() => duplicateGroup.getByText("Duplicate", { exact: true }).count())
      .toBe(0);
    expect(
      await duplicateGroup
        .getByRole("button", { name: "Take over auto-duplicate-reviewer" })
        .count()
    ).toBe(0);

    await page.getByRole("button", { name: /Take over \d+ skills/ }).click();
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
    await expect.poll(() => conflictGroup.textContent()).toContain("Review");
    await expect
      .poll(() => page.getByRole("button", { name: /Take over \d+ skills/ }).count())
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
    await expect.poll(() => group.textContent()).toContain("Managed externally by Skills CLI");
    await group.getByRole("button", { name: "Import copy skills-cli-reviewer" }).click();
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
      .getByRole("menuitemradio", { name: "Rocket" })
      .click();
    expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    await saveProfile(page);
    await expect(
      readJson<{ iconKey?: string }>(
        join(appDataRoot, "profiles", "ui-opencode-alpha", "profile.json")
      )
    ).resolves.toMatchObject({ iconKey: "rocket" });
  }, 30_000);

  it("adds and removes reusable MCP servers through the rendered MCP library", async () => {
    const { appDataRoot, page } = await launchApp();
    const mcpLibraryPath = join(appDataRoot, "mcp-library.json");

    await page.getByRole("button", { name: "MCP Servers" }).click();
    await page.getByRole("region", { name: "MCP library" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Add MCP server" }).click();
    await page.getByLabel("MCP library id").fill("local-search");
    await page.getByLabel("MCP library name").fill("Local Search");
    await page.getByLabel("MCP command").fill("node");
    await page.getByLabel("MCP args").fill("server.js\n--stdio");
    await page.getByLabel("MCP env").fill("SEARCH_TOKEN\nAGENTENV_CACHE_DIR");
    await page.getByRole("button", { name: "Save MCP server" }).click();

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

    await localSearch.getByRole("button", { name: "Edit local-search" }).click();
    await expect.poll(() => page.getByLabel("MCP library id").inputValue()).toBe("local-search");
    expect(await page.getByLabel("MCP library id").isDisabled()).toBe(true);
    await expect.poll(() => page.getByLabel("MCP args").inputValue()).toBe("server.js\n--stdio");
    await page.getByRole("button", { name: "Close MCP server editor" }).click();

    await page.getByRole("button", { name: "Add MCP server" }).click();
    await page.getByLabel("MCP library id").fill("local-search");
    await expect
      .poll(() => page.getByRole("dialog", { name: "MCP server editor" }).textContent())
      .toContain("This ID already exists");
    expect(await page.getByRole("button", { name: "Save MCP server" }).isDisabled()).toBe(true);
    await page.keyboard.press("Escape");

    await localSearch.getByRole("button", { name: "Remove local-search" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete MCP server" });
    await deleteDialog.waitFor({ state: "visible" });
    await expect.poll(() => deleteDialog.textContent()).toContain("Local Search");
    await deleteDialog.getByRole("button", { name: "Delete server" }).click();
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
    const { opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    await addLibrarySkillToProfile(page);
    await page
      .getByRole("listitem", { name: "Profile skill shared-reviewer" })
      .waitFor({ state: "visible" });
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    const installedSkillMd = join(
      opencodeDir,
      "skills",
      "shared-reviewer",
      "SKILL.md"
    );
    await expect(readFile(installedSkillMd, "utf8")).resolves.toContain(
      "Review code changes before applying them."
    );
    expect((await lstat(installedSkillMd)).isSymbolicLink()).toBe(true);
    await expect(
      readFile(
        join(opencodeDir, "skills", "shared-reviewer", ".agentenv-owner.json"),
        "utf8"
      )
    ).resolves.toContain('"source": "skills-library/shared-reviewer"');
  }, 30_000);

  it("detects and applies updates after a library skill is installed on OpenCode", async () => {
    const { librarySkill, opencodeDir, page } = await launchApp();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Global skill sync method").selectOption("copy");
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
    const installActionGap = await updatedRow.evaluate((element) => {
      const installs = element.querySelector(".library-installs-cell")?.getBoundingClientRect();
      const actions = element.querySelector(".library-actions-cell")?.getBoundingClientRect();
      return installs && actions ? actions.left - installs.right : -1;
    });
    expect(installActionGap).toBeGreaterThanOrEqual(0);
    await updatedRow.getByRole("button", { name: "Sync install of shared-reviewer" }).click();
    await updatedRow.getByText("Synced").waitFor({ state: "visible" });
    await expect(readFile(installedSkillMd, "utf8")).resolves.toContain(
      "Use the installed update path."
    );
  }, 30_000);

  it("keeps Skill table columns and two-line metadata aligned across row actions", async () => {
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
        ".library-source-cell",
        ".library-version-cell",
        ".library-update-cell",
        ".library-usage-cell",
        ".library-installs-cell"
      ];
      const headerCells = head ? Array.from(head.children) as HTMLElement[] : [];
      const headerLefts = headerCells.slice(1, 6).map((cell) => cell.getBoundingClientRect().left);
      const rowMetrics = rows.map((row) => {
        const cells = cellSelectors.map((selector) => row?.querySelector<HTMLElement>(selector));
        const actions = row?.querySelector<HTMLElement>(".library-actions-cell");
        const installs = row?.querySelector<HTMLElement>(".library-installs-cell");
        const version = row?.querySelector<HTMLElement>(".library-version-cell");
        const primary = [
          version?.querySelector<HTMLElement>("strong"),
          row?.querySelector<HTMLElement>(".library-update-cell .resource-status"),
          row?.querySelector<HTMLElement>(".library-usage-cell .usage-summary"),
          row?.querySelector<HTMLElement>(".library-installs-cell .library-install-empty, .library-installs-cell .library-install-entry > span")
        ].filter((item): item is HTMLElement => Boolean(item));
        const rowBox = row?.getBoundingClientRect();
        const actionBox = actions?.getBoundingClientRect();
        const installBox = installs?.getBoundingClientRect();
        return {
          cellLefts: cells.map((cell) => cell?.getBoundingClientRect().left ?? -1),
          actionsLeft: actionBox?.left ?? -1,
          actionGap: actionBox && installBox ? actionBox.left - installBox.right : -1,
          childrenFit: Boolean(rowBox) && Array.from(row!.children).every((child) => {
            const box = child.getBoundingClientRect();
            return box.left >= rowBox!.left - 1 && box.right <= rowBox!.right + 1;
          }),
          primaryTops: primary.map((item) => item.getBoundingClientRect().top),
          versionChildLefts: version
            ? Array.from(version.children).map((child) => child.getBoundingClientRect().left)
            : [],
          statusOverflow: (() => {
            const label = row?.querySelector<HTMLElement>(".library-update-cell .resource-status > span");
            return label ? label.scrollWidth - label.clientWidth : 0;
          })()
        };
      });
      return {
        containerName: getComputedStyle(document.querySelector<HTMLElement>(".skill-library-panel")!).containerName,
        headerDisplay: head ? getComputedStyle(head).display : "missing",
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
      expect(row.actionGap).toBeGreaterThanOrEqual(9);
      expect(row.statusOverflow).toBeLessThanOrEqual(1);
      expect(Math.max(...row.primaryTops) - Math.min(...row.primaryTops)).toBeLessThanOrEqual(1);
      expect(Math.max(...row.versionChildLefts) - Math.min(...row.versionChildLefts)).toBeLessThanOrEqual(1);
    }
    expect(
      Math.abs(defaultGeometry.rowMetrics[0]!.actionsLeft - defaultGeometry.rowMetrics[1]!.actionsLeft)
    ).toBeLessThanOrEqual(1);

    await resizeAppWindow(page, 920, 620);
    const compactGeometry = await updateRow.evaluate((row) => {
      const actions = row.querySelector<HTMLElement>(".library-actions-cell")!.getBoundingClientRect();
      const update = row.querySelector<HTMLElement>(".library-update-cell")!.getBoundingClientRect();
      const installs = row.querySelector<HTMLElement>(".library-installs-cell")!.getBoundingClientRect();
      return {
        actionGap: actions.left - Math.max(update.right, installs.right),
        headerDisplay: getComputedStyle(document.querySelector<HTMLElement>(".skill-library-panel .library-table__head")!).display,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        versionDisplay: getComputedStyle(row.querySelector<HTMLElement>(".library-version-cell")!).display
      };
    });
    expect(compactGeometry.documentWidth).toBe(compactGeometry.viewportWidth);
    expect(compactGeometry.actionGap).toBeGreaterThanOrEqual(9);
    expect(compactGeometry.headerDisplay).toBe("none");
    expect(compactGeometry.versionDisplay).toBe("none");
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
    await page.getByRole("button", { name: "Create backup" }).click();
    await expect.poll(() => page.getByRole("status").textContent()).toContain(
      "Data backup created"
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
    await page.getByRole("button", { name: "Restore backup" }).click();
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

  it("creates and applies a managed Profile from the live OpenCode Target", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    await resizeAppWindow(page, 920, 620);
    await page.getByRole("button", { name: "Targets", exact: true }).click();
    const targetCard = page.getByRole("article", { name: "Target OpenCode" });
    const captureButton = targetCard.getByRole("button", { name: "Create profile from OpenCode" });
    await captureButton.click();

    let dialog = page.getByRole("dialog", { name: "Create profile from OpenCode" });
    await dialog.waitFor({ state: "visible" });
    await expect.poll(() => page.getByRole("region", { name: "Targets", exact: true }).isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(() => captureButton.evaluate((element) => document.activeElement === element)).toBe(true);

    await captureButton.click();
    dialog = page.getByRole("dialog", { name: "Create profile from OpenCode" });
    await dialog.getByRole("button", { name: "Review" }).click();

    dialog = page.getByRole("dialog", { name: "Review OpenCode takeover" });
    const impact = dialog.getByRole("region", { name: "Capture impact" });
    await expect.poll(() => impact.textContent()).toContain("target-only-reviewer");
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
    await dialog.getByRole("button", { name: "Create and take over" }).click();
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(() => page.locator(".app-feedback").textContent()).toContain(
      "OpenCode Current created and applied"
    );

    await expect(
      readFile(join(appDataRoot, "skills-library", "target-only-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("Migrate me into the shared library.");
    await expect(
      readFile(join(opencodeDir, "skills", "target-only-reviewer", ".agentenv-owner.json"), "utf8")
    ).resolves.toContain('"targetId": "opencode"');
    const manifests = await Promise.all(
      (await readdir(join(appDataRoot, "profiles"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => readJson<{ id: string; name: string }>(join(appDataRoot, "profiles", entry.name, "profile.json")))
    );
    const captured = manifests.find((manifest) => manifest.name === "OpenCode Current");
    expect(captured?.id).toBeTruthy();
    await expect(readJson<{ activeProfileId: string }>(join(appDataRoot, "target-states", "opencode.json")))
      .resolves.toMatchObject({ activeProfileId: captured?.id });
  }, 30_000);

  it("keeps capture actions visible with long, high-density review content", async () => {
    const { app: electronApp, page } = await launchApp();
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("profiles:preview-create-from-target");
      ipcMain.handle("profiles:preview-create-from-target", () => ({
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
            ? "1 compatibility copy preserved"
            : "A deliberately long path and description used to verify compact window containment"
        })),
        cleanupPaths: Array.from({ length: 4 }, (_, index) => `/tmp/old-copy-${index + 1}`),
        warnings: Array.from(
          { length: 6 },
          (_, index) => `dense-capture-resource-${index + 1}: compatibility copies stay in place until every installed consumer has an equivalent managed Skill`
        ),
        errors: []
      }));
    });
    await resizeAppWindow(page, 920, 620);
    await page.getByRole("button", { name: "Targets", exact: true }).click();
    await page
      .getByRole("article", { name: "Target OpenCode" })
      .getByRole("button", { name: "Create profile from OpenCode" })
      .click();
    await page.getByRole("dialog", { name: "Create profile from OpenCode" })
      .getByRole("button", { name: "Review" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Review OpenCode takeover" });
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
    for (const workspace of ["技能", "設定檔", "目標", "設定"]) {
      await page.getByRole("button", { name: workspace, exact: true }).click();
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
      };
      state.__agentEnvCopiedText = undefined;
      state.__agentEnvGitHubSignedIn = false;

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
        intervalSeconds: 10
      }));
      ipcMain.handle("github:poll-device-login", () => {
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

  it("disables a current Profile library skill and removes only its managed Target copy", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp({
      openCodeAlphaLibrarySkillCount: 1
    });
    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");

    const installedSkillDir = join(opencodeDir, "skills", "layout-skill-1");
    await expect(fileExists(join(installedSkillDir, "SKILL.md"))).resolves.toBe(true);

    await expandComposerSection(page, "Skills");
    const skillRow = page.getByRole("listitem", { name: "Profile skill layout-skill-1" });
    await skillRow.getByRole("switch", { name: "Disable layout-skill-1" }).click();
    expect(await page.getByRole("button", { name: "Save", exact: true }).isEnabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Apply", exact: true }).isDisabled()).toBe(true);
    await saveProfile(page);

    const savedAssets = await readJson<{
      skillRefs: Array<{ libraryId: string; targetName: string; enabled?: boolean }>;
    }>(join(appDataRoot, "profiles", "ui-opencode-alpha", "assets.json"));
    expect(savedAssets.skillRefs).toEqual([
      { libraryId: "layout-skill-1", targetName: "layout-skill-1", enabled: false }
    ]);

    await page.getByRole("button", { name: "Apply", exact: true }).click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    const resourceChanges = previewDialog.getByRole("region", { name: "Resource changes" });
    await resourceChanges.waitFor({ state: "visible" });
    await expect.poll(() => resourceChanges.textContent()).toContain("remove");
    await expect.poll(() => resourceChanges.textContent()).toContain("layout-skill-1");
    await previewDialog.getByRole("button", { name: "Apply profile" }).click();
    await previewDialog.waitFor({ state: "hidden" });

    await expect(fileExists(installedSkillDir)).resolves.toBe(false);
    await expect(fileExists(join(appDataRoot, "skills-library", "layout-skill-1", "SKILL.md")))
      .resolves.toBe(true);
  }, 30_000);

  it("shows profile-owned skill conflicts before applying from the rendered app", async () => {
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
    await editDialog.getByLabel("Target name").fill("target-only-reviewer");
    await editDialog.getByRole("button", { name: "Save" }).click();
    await editDialog.waitFor({ state: "hidden" });
    await saveProfile(page);

    await applyActionButton(page, "OpenCode").click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await page
      .getByText(`skill target already exists and is not AgentEnv-owned: ${join(
        opencodeDir,
        "skills",
        "target-only-reviewer"
      )}`)
      .waitFor({ state: "visible" });
    expect(await previewDialog.getByRole("button", { name: "Apply profile" }).isDisabled()).toBe(true);
  }, 30_000);

  it("imports and updates a GitHub-backed skill through the rendered app", async () => {
    const { app: electronApp, appDataRoot, githubFixtureRoot, page } = await launchApp();
    const sourceUrl = "https://github.com/acme/agent-skills/tree/main/skills/reviewer";

    await page.getByRole("button", { name: "Import skills" }).click();
    await page.getByLabel("GitHub skill URL").fill(sourceUrl);
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    const githubReviewer = page.getByRole("checkbox", { name: "Select GitHub Reviewer" });
    await githubReviewer.waitFor();
    expect(await githubReviewer.isChecked()).toBe(true);
    await page.getByLabel("Library ID for GitHub Reviewer").fill("github-reviewer");
    expect(await githubReviewer.isChecked()).toBe(true);
    const librarySkillMd = join(appDataRoot, "skills-library", "github-reviewer", "SKILL.md");
    await page.getByRole("button", { name: "Import 1" }).click();
    await expect.poll(() => fileExists(librarySkillMd), { timeout: 5_000 }).toBe(true);
    await page
      .getByRole("group", { name: "Library item github-reviewer" })
      .getByText("GitHub skill v1.")
      .waitFor({ state: "visible" });
    await page.getByRole("dialog", { name: "Import skills" }).waitFor({ state: "hidden" });

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
    await githubRow.getByRole("button", { name: "Open GitHub source for github-reviewer" }).click();
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
    const updateCheckSwitch = page.getByRole("switch", {
      name: "Track updates for github-reviewer"
    });
    await expect.poll(() => updateCheckSwitch.getAttribute("aria-checked")).toBe("true");
    await updateCheckSwitch.click();
    await expect.poll(() => githubRow.textContent()).toContain("Not tracked");
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
    await page.getByRole("switch", { name: "Track updates for github-reviewer" }).click();
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

    await page.getByRole("button", { name: "Import skills" }).click();
    await page
      .getByLabel("GitHub skill URL")
      .fill("https://github.com/acme/agent-skills/tree/main/skills/engineering");
    await page.getByRole("button", { name: "Scan", exact: true }).click();

    const apiDesign = page.getByRole("checkbox", { name: "Select API Design" });
    const releaseCheck = page.getByRole("checkbox", { name: "Select Release Check" });
    await apiDesign.waitFor({ state: "visible" });
    expect(await apiDesign.isChecked()).toBe(true);
    expect(await releaseCheck.isChecked()).toBe(true);
    await releaseCheck.uncheck();
    await page.getByRole("button", { name: "Import 1" }).click();

    await page.getByRole("dialog", { name: "Import skills" }).waitFor({ state: "hidden" });
    await page.getByRole("group", { name: "Library item api-design" }).waitFor({ state: "visible" });
    expect(await page.getByRole("group", { name: "Library item release-check" }).count()).toBe(0);
    await expect(
      readFile(join(appDataRoot, "skills-library", "api-design", "SKILL.md"), "utf8")
    ).resolves.toContain("Design stable APIs");
    await expect(
      readFile(join(appDataRoot, "skills-library", "release-check", "SKILL.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

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

    await page.getByRole("button", { name: "MCP Servers" }).click();
    await page.getByRole("region", { name: "MCP library" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Add MCP server" }).click();
    await page.getByLabel("MCP library id").fill("local-search");
    await page.getByLabel("MCP library name").fill("Local Search");
    await page.getByLabel("MCP command").fill("node");
    await page.getByLabel("MCP args").fill("server.js\n--stdio");
    await page.getByLabel("MCP env").fill("SEARCH_TOKEN");
    await page.getByRole("button", { name: "Save MCP server" }).click();
    await page
      .getByRole("group", { name: "MCP library item local-search" })
      .waitFor({ state: "visible" });

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "MCP Servers");
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
      "Target files changed after the rollback preview"
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
      .toContain("opencode Advanced config is target-specific and is not applied to Codex");
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
});
