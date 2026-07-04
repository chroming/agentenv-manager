import { constants } from "node:fs";
import { access } from "node:fs/promises";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
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
      contentHash: "seed",
      updatedAt: "2026-07-02T00:00:00.000Z"
    });
    refs.push({ libraryId: id, targetName: id });
  }

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
  options: { openCodeAlphaLibrarySkillCount?: number; mcpLibraryCount?: number } = {}
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
    appDataRoot,
    homeDir,
    opencodeDir,
    codexDir,
    librarySkill,
    githubFixtureRoot,
    page
  };
};

const selectProfile = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "Profiles" }).click();
  await page.getByRole("region", { name: "Profiles", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("heading", { name }).waitFor({ state: "visible" });
};

const selectTarget = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "Select apply target" }).click();
  await page.getByRole("menuitemradio", { name }).click();
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

const expectInViewport = async (page: Page, locator: Locator) => {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
};

const expectTopmost = async (locator: Locator) => {
  const isTopmost = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const points = [
      [rect.left + rect.width / 2, rect.top + 18],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + rect.width / 2, rect.bottom - 18]
    ];

    return points.every(([x, y]) => {
      const target = document.elementFromPoint(x, y);
      return target === element || element.contains(target);
    });
  });

  expect(isTopmost).toBe(true);
};

const applyActionButton = (page: Page, targetName: "OpenCode" | "Codex") =>
  page
    .getByRole("button", { name: `Apply to ${targetName}` })
    .or(page.getByRole("button", { name: `Take over ${targetName}` }))
    .first();

const previewAndApply = async (page: Page, targetName: "OpenCode" | "Codex") => {
  await applyActionButton(page, targetName).click();
  const previewDialog = page.getByRole("dialog", { name: "Preview" });
  await previewDialog.waitFor({ state: "visible" });
  await previewDialog.getByRole("button", { name: "Confirm" }).click();
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

    await page.getByRole("button", { name: "Import Skill" }).click();
    await page
      .getByLabel("GitHub skill URL")
      .fill("https://github.com/acme/agent-skills/tree/main/skills/reviewer");
    expect(await page.getByRole("button", { name: "Import from GitHub" }).isEnabled()).toBe(true);

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
  }, 30_000);

  it("updates target cards after taking over OpenCode", async () => {
    const { page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    await page.getByRole("button", { name: "Targets" }).click();

    const openCodeCard = page.getByRole("article", { name: "Target OpenCode" });
    await openCodeCard.waitFor({ state: "visible" });
    await expect.poll(() => openCodeCard.textContent()).toContain("Managed by AgentEnv");
    await expect.poll(() => openCodeCard.textContent()).toContain("Active profileUI OpenCode alpha");
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
    await editDialog.getByRole("button", { name: "Save", exact: true }).click();
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
    await deleteDialog.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("heading", { name: "Docs Writing v2" }).waitFor({
      state: "visible",
      timeout: 10_000
    });
    expect(await findProfileByName(appDataRoot, "Docs Writing v2 Copy")).toBeUndefined();
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
    const targetMenu = page.getByRole("menu", { name: "Profile targets" });
    await targetMenu.waitFor({ state: "visible", timeout: 5_000 });
    await page.mouse.click(240, 120);
    await targetMenu.waitFor({ state: "hidden", timeout: 5_000 });

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Import Skill" }).click({ timeout: 5_000 });
    const importDrawer = page.getByRole("region", { name: "GitHub skill import" });
    await importDrawer.waitFor({ state: "visible", timeout: 5_000 });
    await page.mouse.click(240, 120);
    await importDrawer.waitFor({ state: "hidden", timeout: 5_000 });
  }, 30_000);

  it("imports an existing target skill into the shared library", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    await writeUnmanagedTargetSkill(
      opencodeDir,
      "late-target-reviewer",
      "Created after app launch and discovered by manual scan.",
      "skill"
    );

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local Skills" }).click();
    await page
      .getByRole("group", { name: "Cleanup group target-only-reviewer" })
      .waitFor({ state: "visible" });
    await page
      .getByRole("group", { name: "Cleanup group late-target-reviewer" })
      .waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Import target-only-reviewer" }).click();
    await page
      .getByRole("group", { name: "Library item target-only-reviewer" })
      .waitFor({ state: "visible" });

    expect(await page.getByText("Existing target skill ready to migrate.").count()).toBeGreaterThan(
      0
    );
    expect(
      await page
        .getByRole("group", { name: "Cleanup group target-only-reviewer" })
        .textContent()
    ).toContain("Imported");
    await expect(
      readFile(join(appDataRoot, "skills-library", "target-only-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("Migrate me into the shared library.");

    await page.getByRole("button", { name: "Manage target-only-reviewer" }).click();
    await expect
      .poll(async () =>
        page.getByRole("group", { name: "Cleanup group target-only-reviewer" }).textContent()
      )
      .toContain("Managed");
    await expect(
      readFile(
        join(opencodeDir, "skills", "target-only-reviewer", ".agentenv-owner.json"),
        "utf8"
      )
    ).resolves.toContain('"source": "skills-library/target-only-reviewer"');
  }, 30_000);

  it("keeps ignored local skill groups visible and blocks conflicting profile apply", async () => {
    const { opencodeDir, page } = await launchApp();
    await writeUnmanagedTargetSkill(
      opencodeDir,
      "ui-alpha-skill",
      "Local copy intentionally left unmanaged."
    );

    await openSkillLibrary(page);
    await page.getByRole("button", { name: "Scan local Skills" }).click();
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
      .poll(() => previewDialog.getByRole("button", { name: "Confirm" }).isDisabled())
      .toBe(true);
  }, 30_000);

  it("blocks profile apply when the managed OpenCode environment drifted outside AgentEnv", async () => {
    const { opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await previewAndApply(page, "OpenCode");
    await writeFile(join(opencodeDir, "AGENTS.md"), "# Changed outside AgentEnv\n", "utf8");

    await applyActionButton(page, "OpenCode").click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });
    await expect
      .poll(() => previewDialog.textContent())
      .toContain("OpenCode instructions changed outside AgentEnv");
    await expect
      .poll(() => previewDialog.getByRole("button", { name: "Confirm" }).isDisabled())
      .toBe(true);
  }, 30_000);

  it("shows polished skill row actions and update check feedback in the rendered app", async () => {
    const { page } = await launchApp();

    const sharedRow = page.getByRole("group", { name: "Library item shared-reviewer" });
    await sharedRow.waitFor({ state: "visible" });
    await sharedRow.getByRole("button", { name: "More actions for shared-reviewer" }).click();
    const popover = page.getByRole("menu", { name: "Actions for shared-reviewer" });
    await popover.waitFor({ state: "visible" });
    await popover
      .getByRole("menuitem", { name: /Check update|Preview update/ })
      .waitFor({ state: "visible" });

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

    await page.mouse.click(240, 120);
    await popover.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Check updates" }).click();
    await expect
      .poll(() => page.getByRole("status").textContent())
      .toMatch(/up to date|update.*available|failed/i);
  }, 30_000);

  it("deletes a skill from the shared library through the rendered app", async () => {
    const { appDataRoot, page } = await launchApp();

    const sharedRow = page.getByRole("group", { name: "Library item shared-reviewer" });
    await sharedRow.waitFor({ state: "visible" });
    await sharedRow.getByRole("button", { name: "More actions for shared-reviewer" }).click();
    await page.getByRole("menuitem", { name: /Delete from library/ }).click();

    const deleteDialog = page.getByRole("dialog", { name: "Delete library skill" });
    await deleteDialog.waitFor({ state: "visible" });
    await expect.poll(() => deleteDialog.textContent()).toContain("Installed target copies are not removed");
    await deleteDialog.getByRole("button", { name: "Delete skill" }).click();

    await sharedRow.waitFor({ state: "hidden" });
    await expect
      .poll(() => page.getByRole("status").textContent())
      .toContain("Deleted shared-reviewer from library");
    await expect(fileExists(join(appDataRoot, "skills-library", "shared-reviewer"))).resolves.toBe(false);
  }, 30_000);

  it("keeps menus, dialogs, and info tips inside the visible app window", async () => {
    const { page } = await launchApp();
    await page.setViewportSize({ width: 1180, height: 760 });

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
    const targetMenu = page.getByRole("menu", { name: "Profile targets" });
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
    await skillPicker.locator(".info-tip").hover();
    const pickerTip = page.getByRole("tooltip");
    await pickerTip.waitFor({ state: "visible" });
    await expectInViewport(page, pickerTip);
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
    const readiness = page.locator(".profile-readiness-strip");
    const workbench = page.locator(".profile-workbench");
    const profileIndex = page.locator(".profile-index");
    const editor = page.locator(".profile-editor-surface");
    const composer = page.getByRole("region", { name: "Profile composer" });

    await expectInViewport(page, header);
    await expectInViewport(page, readiness);
    await expectInViewport(page, workbench);

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

    const initialOverflow = await Promise.all(
      [profileIndex, editor].map((locator) =>
        locator.evaluate((element) => ({
          overflowY: getComputedStyle(element).overflowY,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight
        }))
      )
    );
    expect(["auto", "scroll"]).toContain(initialOverflow[0].overflowY);
    expect(initialOverflow[1].overflowY).toBe("hidden");
    for (const metrics of initialOverflow) {
      expect(metrics.clientHeight).toBeGreaterThan(0);
    }

    await page.getByRole("button", { name: "Select apply target" }).click();
    const defaultViewportTargetMenu = page.getByRole("menu", { name: "Profile targets" });
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
    expect(advancedComposerBox!.y + advancedComposerBox!.height).toBeLessThanOrEqual(
      advancedEditorBox!.y + advancedEditorBox!.height
    );
    for (const sectionName of ["Instructions", "Skills", "MCP Servers", "Advanced"] as const) {
      await expectInViewport(
        page,
        composer.getByRole("button", { name: sectionName, exact: true })
      );
    }
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
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(
      editorBox!.y + editorBox!.height
    );
    for (const sectionName of ["Instructions", "Skills", "MCP Servers", "Advanced"] as const) {
      await expectInViewport(
        page,
        composer.getByRole("button", { name: sectionName, exact: true })
      );
    }
    await expectInViewport(page, header);
    await expectInViewport(page, readiness);
    await expectInViewport(page, workbench);

    const expandedMetrics = await editor.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight
    }));
    const expandedPanel = page.locator(
      '[data-profile-composer-id="skills"] .profile-composer-section__panel'
    );
    const panelMetrics = await expandedPanel.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(expandedMetrics.overflowY).toBe("hidden");
    expect(["auto", "scroll"]).toContain(panelMetrics.overflowY);
    expect(panelMetrics.scrollHeight).toBeGreaterThan(panelMetrics.clientHeight);
    expect(expandedMetrics.documentHeight).toBe(expandedMetrics.viewportHeight);
  }, 30_000);

  it("keeps navigation order and workspace width stable across primary pages", async () => {
    const { page } = await launchApp();
    await page.setViewportSize({ width: 1180, height: 728 });

    const navigation = page.getByRole("complementary", { name: "Global navigation" });
    const skillsButton = navigation.getByRole("button", { name: "Skills", exact: true });
    const profilesButton = navigation.getByRole("button", { name: "Profiles", exact: true });
    const libraryPositions = await Promise.all([skillsButton.boundingBox(), profilesButton.boundingBox()]);
    expect(libraryPositions[0]).not.toBeNull();
    expect(libraryPositions[1]).not.toBeNull();
    expect(libraryPositions[0]!.y).toBeLessThan(libraryPositions[1]!.y);

    await profilesButton.click();
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

  it("opens the apply preview at its summary instead of scrolling to the footer", async () => {
    const { page } = await launchApp();
    await page.setViewportSize({ width: 1180, height: 728 });
    await selectProfile(page, "UI OpenCode alpha");

    await applyActionButton(page, "OpenCode").click();
    const previewDialog = page.getByRole("dialog", { name: "Preview" });
    await previewDialog.waitFor({ state: "visible" });

    expect(await previewDialog.evaluate((element) => element.scrollTop)).toBe(0);
    await expectInViewport(page, previewDialog.locator(".preview-header"));
    await expectInViewport(page, previewDialog.locator(".preview-actions"));
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
    await page.getByRole("region", { name: "Recovery" }).waitFor({ state: "visible" });

    const codexCard = page.getByRole("article", { name: "Target Codex" });
    await codexCard.getByRole("button", { name: "Open Codex in Profiles" }).click();
    await page.getByRole("region", { name: "Profiles", exact: true }).waitFor({ state: "visible" });
    await page.getByText("No profile selected", { exact: true }).waitFor({ state: "visible" });
  }, 30_000);

  it("opens MCP creation from a clear page action", async () => {
    const { page } = await launchApp();
    await page.getByRole("button", { name: "MCP Servers", exact: true }).click();

    expect(await page.getByRole("region", { name: "MCP server editor" }).count()).toBe(0);
    await page.getByRole("button", { name: "Add MCP server" }).click();
    const editor = page.getByRole("dialog", { name: "MCP server editor" });
    await editor.waitFor({ state: "visible" });
    await page.mouse.click(220, 420);
    await editor.waitFor({ state: "detached" });

    const addButton = page.getByRole("button", { name: "Add MCP server" });
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
    await saveProfile(page);

    await expect(
      readFile(join(appDataRoot, "profiles", "ui-opencode-alpha", "AGENTS.md"), "utf8")
    ).resolves.toBe("# Updated through collapsed Composer\n");
  }, 30_000);

  it("imports a local skill folder from the Import Skill drawer", async () => {
    const { appDataRoot, page } = await launchApp();
    await page.setViewportSize({ width: 1180, height: 760 });
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

    await page.getByRole("button", { name: "Import Skill" }).click();
    await page.getByRole("button", { name: "Choose local skill folder" }).waitFor({
      state: "visible"
    });
    await expect
      .poll(
        () =>
          page.locator(".library-drawer").evaluate((element) => ({
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight
          })),
        { timeout: 5_000 }
      )
      .toMatchObject({
        clientHeight: expect.any(Number),
        scrollHeight: expect.any(Number)
      });
    const drawerMetrics = await page.locator(".library-drawer").evaluate((element) => ({
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
    await page.getByRole("button", { name: "Import local skill" }).click();
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
    await page.getByLabel("MCP env").fill("SEARCH_TOKEN\nCACHE_DIR=AGENTENV_CACHE_DIR");
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
            CACHE_DIR: "AGENTENV_CACHE_DIR",
            SEARCH_TOKEN: "SEARCH_TOKEN"
          }
        })
      );

    await localSearch.getByRole("button", { name: "Edit local-search" }).click();
    await expect.poll(() => page.getByLabel("MCP library id").inputValue()).toBe("local-search");
    await expect.poll(() => page.getByLabel("MCP args").inputValue()).toBe("server.js\n--stdio");
    await page.getByRole("button", { name: "Close MCP server editor" }).click();

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
    const { librarySkill, opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    await addLibrarySkillToProfile(page);
    await page
      .getByRole("group", { name: "Library skill agentenv-shared-reviewer" })
      .waitFor({ state: "visible" });
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    const installedSkillMd = join(
      opencodeDir,
      "skills",
      "agentenv-shared-reviewer",
      "SKILL.md"
    );
    await expect(readFile(installedSkillMd, "utf8")).resolves.toContain(
      "Review code changes before applying them."
    );
    expect((await lstat(installedSkillMd)).isSymbolicLink()).toBe(true);
    await expect(readlink(installedSkillMd)).resolves.toBe(
      join(librarySkill.libraryDir, "SKILL.md")
    );
    await expect(
      readFile(
        join(opencodeDir, "skills", "agentenv-shared-reviewer", ".agentenv-owner.json"),
        "utf8"
      )
    ).resolves.toContain('"source": "skills-library/shared-reviewer"');
  }, 30_000);

  it("detects and applies updates after a library skill is installed on OpenCode", async () => {
    const { librarySkill, opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    await addLibrarySkillToProfile(page);
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    const installedSkillMd = join(opencodeDir, "skills", "agentenv-shared-reviewer", "SKILL.md");
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
      .getByText("Update available")
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Update shared-reviewer" }).click();
    await expect.poll(() => page.getByRole("status").textContent()).toContain("Updated shared-reviewer");
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByText("Installed update guidance.")
      .waitFor({ state: "visible" });

    await expect(readFile(installedSkillMd, "utf8")).resolves.toContain(
      "Use the installed update path."
    );
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
      .getByText("Update available")
      .waitFor({ state: "visible" });
    await page
      .getByRole("group", { name: "Library item batch-helper" })
      .getByText("Update available")
      .waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Update all skills" }).click();
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

    const installedSkillMd = join(opencodeDir, "skills", "agentenv-shared-reviewer", "SKILL.md");
    await expect(readFile(installedSkillMd, "utf8")).resolves.toContain(
      "Review code changes before applying them."
    );
    expect((await lstat(installedSkillMd)).isSymbolicLink()).toBe(false);
  }, 30_000);

  it("moves the shared skill library storage through Settings and installs from the new location", async () => {
    const { appDataRoot, homeDir, opencodeDir, page } = await launchApp();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Global skill storage location").selectOption("agents");
    const movedSkillMd = join(homeDir, ".agents", "skills", "shared-reviewer", "SKILL.md");
    await expect.poll(() => fileExists(movedSkillMd)).toBe(true);
    await expect(
      fileExists(join(appDataRoot, "skills-library", "shared-reviewer", "SKILL.md"))
    ).resolves.toBe(false);

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    await addLibrarySkillToProfile(page);
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    const installedSkillMd = join(opencodeDir, "skills", "agentenv-shared-reviewer", "SKILL.md");
    await expect(readlink(installedSkillMd)).resolves.toBe(movedSkillMd);
  }, 30_000);

  it("persists skill background update check settings from Settings", async () => {
    const { appDataRoot, page } = await launchApp();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Skill auto update check").selectOption("disabled");
    await expect
      .poll(() => page.getByLabel("Skill auto update check").inputValue())
      .toBe("disabled");
    await page.getByLabel("Skill auto update check").selectOption("enabled");
    await page.getByLabel("Skill auto check interval minutes").fill("15");
    await expect
      .poll(async () =>
        JSON.parse(await readFile(join(appDataRoot, "settings.json"), "utf8"))
      )
      .toMatchObject({
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 15
      });
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
      .getByRole("group", { name: "Skill ui-alpha-skill" })
      .getByRole("button", { name: "Remove" })
      .click();
    await saveProfile(page);
    await previewAndApply(page, "OpenCode");

    await expect(fileExists(installedSkillDir)).resolves.toBe(false);
  }, 30_000);

  it("shows profile-owned skill conflicts before applying from the rendered app", async () => {
    const { opencodeDir, page } = await launchApp();

    await selectProfile(page, "UI OpenCode alpha");
    await expandComposerSection(page, "Skills");
    const alphaSkill = page.getByRole("group", { name: "Skill ui-alpha-skill" });
    await alphaSkill.getByLabel("Target name").fill("target-only-reviewer");
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
    expect(await previewDialog.getByRole("button", { name: "Confirm" }).isDisabled()).toBe(true);
  }, 30_000);

  it("imports and updates a GitHub-backed skill through the rendered app", async () => {
    const { appDataRoot, githubFixtureRoot, page } = await launchApp();
    const sourceUrl = "https://github.com/acme/agent-skills/tree/main/skills/reviewer";

    await page.getByRole("button", { name: "Import Skill" }).click();
    await page.getByLabel("GitHub skill URL").fill(sourceUrl);
    await page.getByLabel("GitHub skill library id").fill("github-reviewer");
    const librarySkillMd = join(appDataRoot, "skills-library", "github-reviewer", "SKILL.md");
    await page.getByRole("button", { name: "Import from GitHub" }).click();
    await expect.poll(() => fileExists(librarySkillMd), { timeout: 5_000 }).toBe(true);
    await page
      .getByRole("group", { name: "Library item github-reviewer" })
      .getByText("GitHub skill v1.")
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Close library tool" }).click();
    await page
      .getByRole("region", { name: "GitHub skill import" })
      .waitFor({ state: "hidden" });

    await expect(readFile(librarySkillMd, "utf8")).resolves.toContain("v1 guidance from GitHub.");
    await expect(
      readFile(
        join(appDataRoot, "skills-library", "github-reviewer", "references", "guide.md"),
        "utf8"
      )
    ).resolves.toBe("# Guide v1\n");

    await writeGitHubFixtureSkill(githubFixtureRoot, "v2");
    await page.getByRole("button", { name: "Check updates" }).click();
    await page
      .getByRole("group", { name: "Library item github-reviewer" })
      .getByText("Update available")
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Update github-reviewer" }).click();
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
      .getByRole("region", { name: "Update preview for shared-reviewer" })
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

    await page.getByRole("button", { name: "Update shared-reviewer" }).click();
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
      '"SEARCH_TOKEN": "SEARCH_TOKEN"'
    );
  }, 30_000);

  it("switches OpenCode profiles through the rendered app and restores from history", async () => {
    const { opencodeDir, page } = await launchApp();

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
    await page.getByRole("button", { name: /Preview rollback/ }).first().click();
    await page.getByRole("button", { name: "Restore backup" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Restore backup" }).click();
    await page.getByRole("button", { name: "Restore backup" }).waitFor({ state: "hidden" });
    await expect(readFile(join(opencodeDir, "AGENTS.md"), "utf8")).resolves.toContain(
      "Active UI profile: alpha"
    );
    await expect(fileExists(join(opencodeDir, "agents", "ui-beta-agent"))).resolves.toBe(
      false
    );
  }, 30_000);

  it("switches Codex profiles through the rendered app without touching auth", async () => {
    const { codexDir, homeDir, page } = await launchApp();

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
      readFile(join(homeDir, ".agents", "skills", "ui-codex-beta-skill", "SKILL.md"), "utf8")
    ).resolves.toContain("beta Codex skill prompt");
  }, 30_000);
});
