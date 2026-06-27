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
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
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

const writeMcpLibrary = async (appDataRoot: string) => {
  await writeJson(join(appDataRoot, "mcp-library.json"), [
    {
      id: "shared-docs",
      name: "Shared Docs",
      transport: "http",
      url: "https://example.com/shared-docs/mcp"
    }
  ]);
};

const launchApp = async () => {
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
  await writeGitHubFixtureSkill(githubFixtureRoot, "v1");
  await writeUnmanagedTargetSkill(opencodeDir);
  await writeMcpLibrary(appDataRoot);

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

const previewAndApply = async (page: Page, targetName: "OpenCode" | "Codex") => {
  await page.getByRole("button", { name: `Apply to ${targetName}` }).click();
  const previewDialog = page.getByRole("dialog", { name: "Preview" });
  await previewDialog.waitFor({ state: "visible" });
  await previewDialog.getByRole("button", { name: "Confirm" }).click();
  await previewDialog.waitFor({ state: "hidden" });
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
    expect(await page.getByRole("button", { name: "Apply to OpenCode" }).count()).toBe(1);
    expect(await page.getByRole("complementary", { name: "Activation" }).count()).toBe(0);
  }, 30_000);

  it("shows target readiness from installed commands and writable local paths", async () => {
    const { homeDir, page } = await launchApp();

    await page.getByRole("button", { name: "Targets" }).click();
    const targetsPage = page.getByRole("region", { name: "Targets", exact: true });
    await targetsPage.waitFor({ state: "visible" });

    const openCodeCard = page.getByRole("article", { name: "Target OpenCode" });
    await openCodeCard.waitFor({ state: "visible" });
    await expect.poll(() => openCodeCard.textContent()).toContain("Ready");
    await expect.poll(() => openCodeCard.textContent()).toContain(
      join(homeDir, ".config", "opencode")
    );
    await expect.poll(() => openCodeCard.textContent()).toContain("Config directory");
    await expect.poll(() => openCodeCard.textContent()).toContain("Writable");

    const codexCard = page.getByRole("article", { name: "Target Codex" });
    await codexCard.waitFor({ state: "visible" });
    await expect.poll(() => codexCard.textContent()).toContain("Ready");
    await expect.poll(() => codexCard.textContent()).toContain(join(homeDir, ".codex"));
  }, 30_000);

  it("creates, edits, duplicates, and deletes profiles through the rendered app", async () => {
    const { appDataRoot, page } = await launchApp();

    await page.getByRole("button", { name: "Profiles" }).click();
    await page.getByRole("button", { name: "Apply to OpenCode" }).waitFor({
      state: "visible",
      timeout: 10_000
    });
    await page.getByRole("button", { name: "Create profile" }).click({ timeout: 5_000 });
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

    await page.getByRole("button", { name: "Edit profile details" }).click({ timeout: 5_000 });
    const editDialog = page.getByRole("dialog", { name: "Edit profile" });
    await editDialog.waitFor({ state: "visible", timeout: 5_000 });
    await editDialog.getByLabel("Profile name").fill("Docs Writing v2");
    await editDialog.getByLabel("Description").fill("Updated writing workspace");
    await editDialog.getByRole("button", { name: "Save" }).click();
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

  it("imports an existing target skill into the shared library", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    await writeUnmanagedTargetSkill(
      opencodeDir,
      "late-target-reviewer",
      "Created after app launch and discovered by manual scan.",
      "skill"
    );

    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page.getByRole("button", { name: "Scan local Skills" }).click();
    await page
      .getByRole("group", { name: "Environment skill target-only-reviewer" })
      .waitFor({ state: "visible" });
    await page
      .getByRole("group", { name: "Environment skill late-target-reviewer" })
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
        .getByRole("group", { name: "Environment skill target-only-reviewer" })
        .textContent()
    ).toContain("Imported");
    await expect(
      readFile(join(appDataRoot, "skills-library", "target-only-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("Migrate me into the shared library.");

    await page.getByRole("button", { name: "Manage target-only-reviewer" }).click();
    await expect
      .poll(async () =>
        page.getByRole("group", { name: "Environment skill target-only-reviewer" }).textContent()
      )
      .toContain("Managed");
    await expect(
      readFile(
        join(opencodeDir, "skills", "target-only-reviewer", ".agentenv-owner.json"),
        "utf8"
      )
    ).resolves.toContain('"source": "skills-library/target-only-reviewer"');
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
    await page.getByLabel("MCP library id").fill("local-search");
    await page.getByLabel("MCP library name").fill("Local Search");
    await page.getByLabel("MCP command").fill("node");
    await page.getByLabel("MCP args").fill("server.js\n--stdio");
    await page.getByRole("button", { name: "Save MCP server" }).click();

    const localSearch = page.getByRole("group", { name: "MCP library item local-search" });
    await localSearch.waitFor({ state: "visible" });
    await expect.poll(() => localSearch.textContent()).toContain("node server.js --stdio");
    await expect
      .poll(async () => readJson<Array<{ id: string; command?: string; args?: string[] }>>(mcpLibraryPath))
      .toContainEqual(
        expect.objectContaining({
          id: "local-search",
          command: "node",
          args: ["server.js", "--stdio"]
        })
      );

    await localSearch.getByRole("button", { name: "Remove local-search" }).click();
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
    await page.getByRole("tab", { name: "Resources" }).click();
    await page.getByRole("button", { name: "Add library skill" }).click();
    await page
      .getByRole("group", { name: "Library skill agentenv-shared-reviewer" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Save" }).click();
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
    await page.getByRole("tab", { name: "Resources" }).click();
    await page.getByRole("button", { name: "Add library skill" }).click();
    await page.getByRole("button", { name: "Save" }).click();
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
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page.getByRole("button", { name: "Check updates" }).click();
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByText("Update available")
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Preview update shared-reviewer" }).click();
    await page
      .getByRole("region", { name: "Update preview for shared-reviewer" })
      .getByText("SKILL.md", { exact: true })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Apply update shared-reviewer" }).click();
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
    await page.getByRole("button", { name: "Skills", exact: true }).click();
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
    await page.getByRole("tab", { name: "Resources" }).click();
    await page.getByRole("button", { name: "Add library skill" }).click();
    await page.getByRole("button", { name: "Save" }).click();
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
    await page.getByRole("tab", { name: "Resources" }).click();
    await page.getByRole("button", { name: "Add library skill" }).click();
    await page.getByRole("button", { name: "Save" }).click();
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

  it("adds and removes a profile-owned skill from the rendered Resources editor", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    const profileSkillDir = join(appDataRoot, "profiles", "ui-opencode-alpha", "skills", "new-skill");
    await mkdir(profileSkillDir, { recursive: true });
    await writeFile(
      join(profileSkillDir, "SKILL.md"),
      "---\nname: UI New Skill\ndescription: Added from the Resources editor.\n---\n\n# UI New Skill\n",
      "utf8"
    );

    await selectProfile(page, "UI OpenCode alpha");
    await page.getByRole("tab", { name: "Resources" }).click();
    await page.getByRole("button", { name: "Add skill" }).click();
    await page
      .getByRole("group", { name: "Skill agentenv-new-skill" })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Save" }).click();
    await previewAndApply(page, "OpenCode");

    const installedSkillDir = join(opencodeDir, "skills", "agentenv-new-skill");
    await expect(readFile(join(installedSkillDir, "SKILL.md"), "utf8")).resolves.toContain(
      "Added from the Resources editor."
    );

    await page
      .getByRole("group", { name: "Skill agentenv-new-skill" })
      .getByRole("button", { name: "Remove" })
      .click();
    await page.getByRole("button", { name: "Save" }).click();
    await previewAndApply(page, "OpenCode");

    await expect(fileExists(installedSkillDir)).resolves.toBe(false);
  }, 30_000);

  it("shows profile-owned skill conflicts before applying from the rendered app", async () => {
    const { appDataRoot, opencodeDir, page } = await launchApp();
    const conflictSourceDir = join(
      appDataRoot,
      "profiles",
      "ui-opencode-alpha",
      "skills",
      "conflict-skill"
    );
    await mkdir(conflictSourceDir, { recursive: true });
    await writeFile(
      join(conflictSourceDir, "SKILL.md"),
      "---\nname: Conflict Skill\n---\n\n# Conflict\n",
      "utf8"
    );

    await selectProfile(page, "UI OpenCode alpha");
    await page.getByRole("tab", { name: "Resources" }).click();
    await page.getByRole("button", { name: "Add skill" }).click();
    const newSkill = page.getByRole("group", { name: "Skill agentenv-new-skill" });
    await newSkill.getByLabel("Source").fill("skills/conflict-skill");
    await newSkill.getByLabel("Target name").fill("target-only-reviewer");
    await page.getByRole("button", { name: "Save" }).click();

    await page.getByRole("button", { name: "Apply to OpenCode" }).click();
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
    await page.getByRole("button", { name: "Preview update github-reviewer" }).click();
    await page
      .getByRole("region", { name: "Update preview for github-reviewer" })
      .getByText("SKILL.md", { exact: true })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Apply update github-reviewer" }).click();
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
    await page.getByRole("tab", { name: "Resources" }).click();
    await page.getByRole("button", { name: "Advanced" }).click();
    await page
      .getByRole("textbox", { name: "Disabled Skill Paths" })
      .fill("/Users/example/.agents/skills/legacy-reviewer\n/Users/example/.agents/skills/noisy-helper");
    await page.getByRole("button", { name: "Save" }).click();
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
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Preview update shared-reviewer" }).click();
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

    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .waitFor({ state: "visible" });
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByRole("button", { name: "More actions for shared-reviewer" })
      .click();
    await page.getByLabel("Update source for shared-reviewer").fill(newSourceDir);
    await page.getByRole("button", { name: "Save source for shared-reviewer" }).click();
    await page
      .getByRole("group", { name: "Library item shared-reviewer" })
      .getByText(newSourceDir)
      .waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Preview update shared-reviewer" }).click();
    await page
      .getByRole("region", { name: "Update preview for shared-reviewer" })
      .getByText("SKILL.md", { exact: true })
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Apply update shared-reviewer" }).click();
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
    expect(betaConfig).toContain("user-managed");
    await expect(fileExists(join(opencodeDir, "agents", "ui-alpha-agent"))).resolves.toBe(
      false
    );
    await expect(fileExists(join(opencodeDir, "skills", "ui-beta-skill", "SKILL.md"))).resolves.toBe(
      true
    );

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
