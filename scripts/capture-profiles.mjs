import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright-core";

const projectRoot = resolve(import.meta.dirname, "..");
const defaultOutputDir = join(
  projectRoot,
  "docs",
  "product-audit",
  "2026-07-10-profiles-p0-redesign"
);

const parseArguments = (argumentsList) => {
  let suppliedReference;
  let suppliedOutput;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument !== "--reference" && argument !== "--output") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    if (argument === "--reference") {
      suppliedReference = resolve(value);
    } else {
      suppliedOutput = resolve(value);
    }
    index += 1;
  }
  return {
    outputDir: suppliedOutput ?? defaultOutputDir,
    suppliedReference
  };
};

const { outputDir, suppliedReference } = parseArguments(process.argv.slice(2));
const referencePath = join(outputDir, "reference.png");

const writeJson = async (path, value) => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const profileFixtures = [
  {
    id: "daily-coding",
    name: "Daily Coding",
    description: "Default environment for focused product development.",
    skills: ["react-best-practices", "git-workflow", "testing-strategies", "sql-optimization", "prompt-engineering", "security-checklist", "python-type-hints", "docs-review"],
    mcp: ["filesystem", "github", "postgres", "shared-docs"]
  },
  {
    id: "code-review",
    name: "Code Review",
    description: "Quality, correctness, and change-risk review.",
    skills: ["git-workflow", "testing-strategies", "security-checklist", "docs-review", "sql-optimization"],
    mcp: ["github", "shared-docs"]
  },
  {
    id: "product-design",
    name: "Product Design",
    description: "Product critique and implementation guidance.",
    skills: ["react-best-practices", "prompt-engineering", "docs-review", "testing-strategies", "git-workflow", "security-checklist"],
    mcp: ["filesystem", "github", "shared-docs"]
  },
  {
    id: "mcp-experiment",
    name: "MCP Experiment",
    description: "Sandbox for MCP integration experiments.",
    skills: ["testing-strategies", "security-checklist", "docs-review"],
    mcp: ["filesystem", "github", "postgres", "shared-docs"]
  }
];

const writeProfile = async (appDataRoot, fixture) => {
  const profileDir = join(appDataRoot, "profiles", fixture.id);
  await mkdir(profileDir, { recursive: true });
  await writeJson(join(profileDir, "profile.json"), {
    id: fixture.id,
    targetId: "opencode",
    name: fixture.name,
    description: fixture.description,
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  });
  await writeFile(
    join(profileDir, "AGENTS.md"),
    `# ${fixture.name}\n\nUse the shared AgentEnv resources for this workflow.\n`,
    "utf8"
  );
  await writeJson(join(profileDir, "opencode.jsonc"), {
    $schema: "https://opencode.ai/config.json",
    mcp: Object.fromEntries(
      fixture.mcp.slice(0, 2).map((name) => [
        `${name}-local`,
        { type: "remote", url: `https://example.com/${name}/mcp` }
      ])
    )
  });
  await writeJson(join(profileDir, "assets.json"), {
    ownedDirs: [],
    ownedFiles: [],
    skillRefs: fixture.skills.map((name) => ({ libraryId: name, targetName: name })),
    mcpRefs: fixture.mcp.map((name) => ({ libraryId: name, targetName: name })),
    disabledSkillPaths: []
  });
};

const writeLibrary = async (appDataRoot) => {
  const skillIds = [...new Set(profileFixtures.flatMap((profile) => profile.skills))];
  for (const id of skillIds) {
    const skillDir = join(appDataRoot, "skills-library", id);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${id}\ndescription: Shared ${id} workflow.\n---\n\n# ${id}\n`,
      "utf8"
    );
    if (id === "react-best-practices") {
      await writeJson(join(skillDir, ".agentenv-skill.json"), {
        sourceType: "github",
        source: "https://github.com/agentenv-community/agent-skills/tree/main/skills/react-best-practices",
        remoteRef: "main",
        remoteRevision: "7ce3f08",
        contentHash: "7ce3f08",
        updatedAt: "2026-07-12T00:00:00.000Z"
      });
    }
  }

  await writeJson(
    join(appDataRoot, "mcp-library.json"),
    ["filesystem", "github", "postgres", "shared-docs"].map((id) => ({
      id,
      name: id,
      transport: "http",
      url: `https://example.com/${id}/mcp`,
      args: [],
      env: {}
    }))
  );
};

const prepareFixture = async (root) => {
  const appDataRoot = join(root, "app-data");
  const homeDir = join(root, "home");
  const binDir = join(root, "bin");
  const githubFixtureRoot = join(root, "github-fixtures");
  const opencodeDir = join(homeDir, ".config", "opencode");
  await mkdir(appDataRoot, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(opencodeDir, { recursive: true });

  for (const command of ["opencode", "codex", "claude"]) {
    const executable = join(binDir, command);
    await writeFile(executable, `#!/bin/sh\necho fake-${command}\n`, "utf8");
    await chmod(executable, 0o755);
  }

  await writeFile(join(opencodeDir, "AGENTS.md"), "# Existing OpenCode environment\n", "utf8");
  await writeJson(join(opencodeDir, "opencode.jsonc"), { shell: "/bin/zsh" });
  const cleanupSkillName = "cross-agent-review-workflow-with-a-long-name";
  const cleanupVariants = [
    {
      directory: join(opencodeDir, "skills", cleanupSkillName),
      description: "OpenCode review workflow with repository checks, release validation, and detailed reporting.",
      heading: "OpenCode review workflow"
    },
    {
      directory: join(homeDir, ".agents", "skills", cleanupSkillName),
      description: "Codex review workflow with security checks, migration validation, and detailed reporting.",
      heading: "Codex review workflow"
    }
  ];
  for (const variant of cleanupVariants) {
    await mkdir(variant.directory, { recursive: true });
    await writeFile(
      join(variant.directory, "SKILL.md"),
      `---\nname: Cross-agent Review Workflow With A Long Name\ndescription: ${variant.description}\n---\n\n# ${variant.heading}\n`,
      "utf8"
    );
  }
  const cleanupBackupDir = join(appDataRoot, "backups", "skill-cleanup", "cleanup-capture-1");
  await mkdir(cleanupBackupDir, { recursive: true });
  await writeJson(join(cleanupBackupDir, "manifest.json"), {
    id: "cleanup-capture-1",
    libraryId: "archived-cross-agent-review-workflow-with-a-long-name",
    libraryCreated: true,
    createdAt: "2026-07-13T08:30:00.000Z",
    operation: "cleanup",
    entries: [
      {
        sourcePath: join(opencodeDir, "skills", cleanupSkillName),
        backupPath: join(cleanupBackupDir, "locations", `0-${cleanupSkillName}`)
      },
      {
        sourcePath: join(homeDir, ".agents", "skills", cleanupSkillName),
        backupPath: join(cleanupBackupDir, "locations", `1-${cleanupSkillName}`)
      }
    ]
  });
  await writeJson(join(appDataRoot, "settings.json"), {
    skillSyncMethod: "copy",
    skillStorageLocation: "appData",
    skillAutoCheckEnabled: false,
    skillAutoCheckIntervalMinutes: 60
  });
  await Promise.all(profileFixtures.map((profile) => writeProfile(appDataRoot, profile)));
  await writeLibrary(appDataRoot);
  const githubSkillDir = join(
    githubFixtureRoot,
    "agentenv-community",
    "agent-skills",
    "main",
    "skills",
    "react-best-practices"
  );
  await mkdir(githubSkillDir, { recursive: true });
  await writeFile(
    join(githubSkillDir, "SKILL.md"),
    "---\nname: react-best-practices\ndescription: Shared react-best-practices workflow.\n---\n\n# react-best-practices\n",
    "utf8"
  );

  return { appDataRoot, binDir, githubFixtureRoot, homeDir };
};

const capturePage = async (
  page,
  path,
  { forceFullRepaint = false, preserveFocus = false, preservePointer = false } = {}
) => {
  await page.evaluate(async ({ shouldForceFullRepaint, shouldPreserveFocus }) => {
    await document.fonts?.ready;
    for (const animation of document.getAnimations()) {
      animation.finish();
    }
    if (!shouldPreserveFocus && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (shouldForceFullRepaint) {
      const previousVisibility = document.body.style.visibility;
      document.body.style.visibility = "hidden";
      document.body.getBoundingClientRect();
      document.body.style.visibility = previousVisibility;
    }
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  }, {
    shouldForceFullRepaint: forceFullRepaint,
    shouldPreserveFocus: preserveFocus
  });
  if (!preservePointer) {
    await page.mouse.move(2, 2);
  }
  await page.bringToFront();
  const windowHandle = await app.browserWindow(page);
  await windowHandle.evaluate(async (browserWindow) => {
    browserWindow.show();
    browserWindow.focus();
    browserWindow.moveTop();
    browserWindow.webContents.invalidate();
    await new Promise((resolveFrame) => setTimeout(resolveFrame, 200));
  });
  await page.screenshot({ path, animations: "disabled" });
};

const fileExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const setWindowSize = async (page, windowHandle, width, height) => {
  await windowHandle.evaluate((browserWindow, size) => {
    browserWindow.setAlwaysOnTop(true, "screen-saver");
    browserWindow.webContents.setBackgroundThrottling(false);
    browserWindow.setContentSize(size.width, size.height);
    browserWindow.center();
    browserWindow.show();
    browserWindow.focus();
    browserWindow.moveTop();
  }, { width, height });
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    document.body.style.visibility = "hidden";
    await new Promise(requestAnimationFrame);
    document.body.style.visibility = "visible";
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
};

const writeComparisonPage = async () => {
  const htmlPath = join(outputDir, "comparison.html");
  await writeFile(
    htmlPath,
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #eef2f7; color: #172033; font: 600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; }
      figure { margin: 0; min-width: 0; overflow: hidden; border: 1px solid #dce3ed; background: white; box-shadow: 0 6px 20px rgba(31, 49, 82, .08); }
      figcaption { height: 34px; display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid #e5eaf1; }
      .viewport { overflow: hidden; background: white; }
      img { display: block; width: 100%; height: auto; }
      body.full .viewport { height: 512px; }
      body.header .viewport { height: 190px; }
      body.composer .viewport { height: 360px; }
      body.composer img { transform: translateY(-150px); }
    </style>
  </head>
  <body>
    <main>
      <figure><figcaption>Reference</figcaption><div class="viewport"><img src="reference.png"></div></figure>
      <figure><figcaption>Implementation</figcaption><div class="viewport"><img src="implementation-1536x1024.png"></div></figure>
    </main>
    <script>document.body.className = new URLSearchParams(location.search).get("mode") || "full";</script>
  </body>
</html>`,
    "utf8"
  );
  return htmlPath;
};

const captureComparison = async (page, windowHandle, htmlPath, mode, fileName, height) => {
  await setWindowSize(page, windowHandle, 1536, height);
  await page.goto(`${pathToFileURL(htmlPath).href}?mode=${mode}`);
  await page.waitForLoadState("load");
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0)
  );
  await page.waitForTimeout(100);
  await capturePage(page, join(outputDir, fileName));
};

const writeCaptureManifest = async () => {
  const entries = await readdir(outputDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".png")) {
      continue;
    }
    const content = await readFile(join(outputDir, entry.name));
    files.push({
      file: entry.name,
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex")
    });
  }
  await writeJson(join(outputDir, "capture-manifest.json"), {
    generatedAt: new Date().toISOString(),
    viewports: ["1180x728", "920x620"],
    files
  });
};

await mkdir(outputDir, { recursive: true });
if (suppliedReference && suppliedReference !== referencePath) {
  await copyFile(suppliedReference, referencePath);
}

const fixtureRoot = await mkdtemp(join(tmpdir(), "agentenv-profiles-capture-"));
let app;
try {
  const { appDataRoot, binDir, githubFixtureRoot, homeDir } = await prepareFixture(fixtureRoot);
  app = await electron.launch({
    executablePath: electronPath,
    args: [join(projectRoot, "out", "main", "main.js")],
    env: {
      ...process.env,
      AGENTENV_AUTOMATION: "1",
      AGENTENV_DATA_ROOT: appDataRoot,
      AGENTENV_FAKE_HOME: join(fixtureRoot, "fake-home"),
      AGENTENV_GITHUB_FIXTURE_ROOT: githubFixtureRoot,
      AGENTENV_HOME: homeDir,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
    }
  });

  const page = await app.firstWindow();
  const windowHandle = await app.browserWindow(page);
  await page.waitForLoadState("domcontentloaded");
  await setWindowSize(page, windowHandle, 1180, 728);
  await page.getByRole("region", { name: "Skill library", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("group", { name: "Library item react-best-practices" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-1180x728.png"));
  await page
    .getByRole("group", { name: "Library item react-best-practices" })
    .getByRole("button", { name: "Change icon for react-best-practices" })
    .click();
  await page.getByRole("menu", { name: "Icons for react-best-practices" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-icon-picker-1180x728.png"));
  await page.keyboard.press("Escape");
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "skills-920x620.png"));
  const githubSource = page.getByLabel("Full source for react-best-practices");
  await githubSource.scrollIntoViewIfNeeded();
  await githubSource.hover();
  await page
    .getByRole("tooltip")
    .filter({ hasText: "agentenv-community/agent-skills" })
    .waitFor({ state: "visible" });
  await capturePage(
    page,
    join(outputDir, "skills-source-tooltip-920x620.png"),
    { preservePointer: true }
  );
  await page.mouse.move(2, 2);

  await page.getByRole("button", { name: "Import skills" }).click();
  const importDialog = page.getByRole("dialog", { name: "Import skills" });
  await importDialog.waitFor({ state: "visible" });
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "skills-import-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "skills-import-920x620.png"));
  await importDialog.getByRole("button", { name: "Close import" }).click();
  await importDialog.waitFor({ state: "hidden" });

  const skillActionsButton = page.getByRole("button", {
    name: "More actions for react-best-practices"
  });
  await skillActionsButton.click();
  await page.getByRole("menu", { name: "Actions for react-best-practices" }).waitFor({
    state: "visible"
  });
  await capturePage(page, join(outputDir, "skills-actions-920x620.png"));
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Scan local" }).click();
  const cleanupGroup = page.getByRole("group", {
    name: "Cleanup group cross-agent-review-workflow-with-a-long-name"
  });
  await cleanupGroup.waitFor({ state: "visible", timeout: 5_000 });
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "skills-cleanup-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "skills-cleanup-920x620.png"));
  const cleanupLocations = cleanupGroup.getByLabel(
    "Full cleanup locations cross-agent-review-workflow-with-a-long-name"
  );
  await cleanupLocations.hover();
  await page.getByRole("tooltip").waitFor({ state: "visible", timeout: 5_000 });
  await capturePage(
    page,
    join(outputDir, "skills-cleanup-tooltip-920x620.png"),
    { preservePointer: true }
  );
  await page.mouse.move(2, 2);
  await cleanupGroup
    .getByRole("button", {
      name: "Resolve conflict cross-agent-review-workflow-with-a-long-name"
    })
    .click();
  const cleanupDialog = page.getByRole("dialog", { name: "Review skill cleanup" });
  await cleanupDialog.waitFor({ state: "visible", timeout: 5_000 });
  await capturePage(page, join(outputDir, "skills-cleanup-review-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "skills-cleanup-review-1180x728.png"));
  await page.keyboard.press("Escape");
  await cleanupDialog.waitFor({ state: "hidden", timeout: 5_000 });
  await page
    .getByRole("region", { name: "Environment skills" })
    .waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("button", { name: "Close library tool" }).click();

  const captureWorkspace = async (buttonName, filePrefix, readyLocator) => {
    await page.getByRole("button", { name: buttonName, exact: true }).click();
    await readyLocator().waitFor({ state: "visible" });
    await setWindowSize(page, windowHandle, 1180, 728);
    await capturePage(page, join(outputDir, `${filePrefix}-1180x728.png`));
    await setWindowSize(page, windowHandle, 920, 620);
    await capturePage(page, join(outputDir, `${filePrefix}-920x620.png`));
  };

  await captureWorkspace(
    "MCP Servers",
    "mcp-servers",
    () => page.getByRole("region", { name: "MCP library" })
  );
  await page.getByRole("button", { name: "Add MCP server" }).click();
  const mcpEditor = page.getByRole("dialog", { name: "MCP server editor" });
  await mcpEditor.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "mcp-editor-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "mcp-editor-1180x728.png"));
  await page.keyboard.press("Escape");
  await mcpEditor.waitFor({ state: "hidden" });
  await captureWorkspace(
    "Profiles",
    "profiles",
    () => page.getByRole("region", { name: "Profiles", exact: true })
  );
  await page
    .getByRole("group", { name: "Profile Code Review" })
    .getByRole("button", { name: "Change icon for profile code-review" })
    .click();
  await page.getByRole("menu", { name: "Icons for Code Review" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "profile-icon-picker-920x620.png"));
  await page.keyboard.press("Escape");
  for (const sectionName of ["Instructions", "Skills", "MCP Servers", "Advanced"]) {
    await page
      .locator(`[data-profile-composer-id="${sectionName === "MCP Servers" ? "mcp" : sectionName.toLowerCase()}"]`)
      .getByRole("button", { name: sectionName, exact: true })
      .click();
    await page
      .locator(`[data-profile-composer-id="${sectionName === "MCP Servers" ? "mcp" : sectionName.toLowerCase()}"] .profile-composer-section__panel`)
      .waitFor({ state: "visible" });
    await capturePage(
      page,
      join(outputDir, `profile-${sectionName.toLowerCase().replace(" ", "-")}-920x620.png`),
      sectionName === "Advanced" ? { forceFullRepaint: true } : undefined
    );
  }
  await setWindowSize(page, windowHandle, 1180, 728);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const previewDialog = page.getByRole("dialog", { name: "Preview" });
  await previewDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "apply-preview-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "apply-preview-920x620.png"));
  await previewDialog.getByRole("button", { name: "Apply profile" }).click();
  await previewDialog.waitFor({ state: "hidden" });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("region", { name: "Skill library", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("region", { name: "Profiles", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /^Code Review/ }).click();
  await page.getByRole("heading", { name: "Code Review" }).waitFor({ state: "visible" });
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "profiles-applied-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "profiles-applied-1180x728.png"));
  await captureWorkspace(
    "Targets",
    "targets",
    () => page.getByRole("region", { name: "Targets", exact: true })
  );
  await page
    .getByRole("article", { name: "Target OpenCode" })
    .getByRole("button", { name: "Create profile from OpenCode" })
    .click();
  const targetCaptureDialog = page.getByRole("dialog", { name: "Create profile from OpenCode" });
  await targetCaptureDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "target-capture-setup-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "target-capture-setup-1180x728.png"));
  await targetCaptureDialog.getByRole("button", { name: "Review" }).click();
  const targetCaptureReview = page.getByRole("dialog", { name: "Review OpenCode takeover" });
  await targetCaptureReview.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "target-capture-review-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "target-capture-review-920x620.png"));
  await page.keyboard.press("Escape");
  await targetCaptureReview.waitFor({ state: "hidden" });
  await captureWorkspace(
    "Settings",
    "settings",
    () => page.getByRole("region", { name: "Settings", exact: true })
  );

  await setWindowSize(page, windowHandle, 1536, 1024);
  await page.getByRole("button", { name: "Profiles" }).click();
  await page.getByRole("button", { name: /Daily Coding/ }).click();
  await page.getByRole("heading", { name: "Daily Coding" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Select apply target" }).click();
  await page.waitForTimeout(250);
  await capturePage(page, join(outputDir, "implementation-1536x1024.png"));

  await page.keyboard.press("Escape");
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "implementation-1180x728.png"));

  if (await fileExists(referencePath)) {
    const htmlPath = await writeComparisonPage();
    await captureComparison(page, windowHandle, htmlPath, "full", "comparison.png", 570);
    await captureComparison(page, windowHandle, htmlPath, "header", "header-comparison.png", 250);
    await captureComparison(page, windowHandle, htmlPath, "composer", "composer-comparison.png", 420);
  }
  await writeCaptureManifest();
} finally {
  await app?.close();
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log(outputDir);
