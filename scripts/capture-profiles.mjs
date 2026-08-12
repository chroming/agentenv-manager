import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  rename,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import electronPath from "electron";
import { _electron as electron } from "playwright-core";
import { assertCurrentBuild } from "./build-fingerprint.mjs";

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
const execFile = promisify(execFileCallback);
const capturedBuild = await assertCurrentBuild(projectRoot);
const captureFixtureTimestamp = new Date("2026-07-15T13:40:57.000Z");

const writeJson = async (path, value) => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const normalizeFixtureTimes = async (path) => {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      await normalizeFixtureTimes(entryPath);
    } else if (entry.isFile()) {
      await utimes(entryPath, captureFixtureTimestamp, captureFixtureTimestamp);
    }
  }
  await utimes(path, captureFixtureTimestamp, captureFixtureTimestamp);
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

const repositorySource = "https://github.com/agentenv-community/agent-skills.git";
const repositorySourceScopes = {
  "react-best-practices": {
    id: "source-react-best-practices",
    directory: "skills/react-best-practices"
  },
  "git-workflow": {
    id: "source-git-workflow",
    directory: "skills/git-workflow"
  }
};

const sourceCollectionFor = (skillId) => {
  const source = repositorySourceScopes[skillId];
  return {
    formatVersion: 1,
    sourceId: source.id,
    canonicalLink: `https://github.com/agentenv-community/agent-skills/tree/main/${source.directory}`,
    repository: repositorySource,
    ref: "main",
    directory: source.directory,
    sourceSubpath: ""
  };
};

const writeProfile = async (appDataRoot, fixture) => {
  const profileDir = join(appDataRoot, "profiles", fixture.id);
  await mkdir(profileDir, { recursive: true });
  await writeJson(join(profileDir, "profile.json"), {
    id: fixture.id,
    name: fixture.name,
    description: fixture.description,
    preferredTargetId: "opencode",
    createdFromTargetId: "opencode",
    version: 2
  });
  await writeFile(
    join(profileDir, "INSTRUCTIONS.md"),
    `# ${fixture.name}\n\nUse the shared AgentEnv resources for this workflow.\n`,
    "utf8"
  );
  await writeJson(join(profileDir, "resources.json"), {
    skills: fixture.skills.map((name) => ({
      libraryId: name,
      targetName: name,
      enabled: true
    })),
    mcpByTarget: {
      opencode: {
        mode: "manage",
        selections: fixture.mcp.map((name, index) => ({
          name,
          enabled: index !== 2
        }))
      }
    }
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
      await mkdir(join(skillDir, "references"), { recursive: true });
      await mkdir(join(skillDir, "scripts"), { recursive: true });
      await writeFile(
        join(skillDir, "references", "checklist.md"),
        "# Review checklist\n\n- Confirm the rendered state.\n",
        "utf8"
      );
      await writeFile(
        join(skillDir, "scripts", "inspect.ts"),
        "export const inspect = (path: string) => path.trim();\n",
        "utf8"
      );
      await writeJson(join(skillDir, "settings.json"), {
        include: ["src/**/*.tsx"],
        strict: true
      });
      await writeJson(join(skillDir, ".agentenv-skill.json"), {
        sourceType: "github",
        source: "https://github.com/agentenv-community/agent-skills/tree/main/skills/react-best-practices",
        remoteRef: "main",
        remoteRevision: "7ce3f08",
        contentHash: "7ce3f08",
        updateCheckEnabled: true,
        updatePolicy: "tracked",
        sourceCollection: sourceCollectionFor(id),
        updatedAt: "2026-07-12T00:00:00.000Z"
      });
    } else if (id === "git-workflow") {
      await writeJson(join(skillDir, ".agentenv-skill.json"), {
        sourceType: "github",
        source: "https://github.com/agentenv-community/agent-skills/tree/main/skills/git-workflow",
        remoteRef: "main",
        remoteRevision: "913619b",
        contentHash: "913619b",
        updateCheckEnabled: true,
        updatePolicy: "tracked",
        sourceCollection: sourceCollectionFor(id),
        updatedAt: "2026-07-11T00:00:00.000Z"
      });
    } else if (id === "python-type-hints") {
      await writeJson(join(skillDir, ".agentenv-skill.json"), {
        globallyEnabled: false,
        updateCheckEnabled: false
      });
    }
  }

};

const prepareFixture = async (root) => {
  const appDataRoot = join(root, "app-data");
  const homeDir = join(root, "home");
  const binDir = join(root, "bin");
  const githubFixtureRoot = join(root, "github-fixtures");
  const projectSkillRoot = join(root, "project-workspace");
  const workspaceRoot = join(homeDir, "Projects", "release-console");
  const opencodeDir = join(homeDir, ".config", "opencode");
  const codexDir = join(homeDir, ".codex");
  await mkdir(appDataRoot, { recursive: true });
  await writeJson(join(appDataRoot, "agentenv-data.json"), { formatVersion: 2 });
  await mkdir(binDir, { recursive: true });
  await mkdir(opencodeDir, { recursive: true });
  await mkdir(codexDir, { recursive: true });
  await mkdir(join(workspaceRoot, ".agents", "skills", "release-safety"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "AGENTS.md"),
    "# Release Console\n\nKeep release changes reviewable and reversible.\n",
    "utf8"
  );
  await writeFile(
    join(workspaceRoot, ".agents", "skills", "release-safety", "SKILL.md"),
    "---\nname: Release Safety\ndescription: Check a release before publishing.\nversion: 1.0.0\n---\n\n# Release Safety\n",
    "utf8"
  );
  await writeJson(join(appDataRoot, "projects.json"), {
    formatVersion: 1,
    projects: [{
      id: "project-release-console",
      name: "Release Console",
      rootPath: workspaceRoot,
      createdAt: captureFixtureTimestamp.toISOString(),
      lastOpenedAt: captureFixtureTimestamp.toISOString(),
      lastAgentId: "opencode"
    }]
  });
  const conversationSessionDir = join(
    codexDir,
    "sessions",
    "2026",
    "07",
    "25"
  );
  await mkdir(conversationSessionDir, { recursive: true });
  await writeFile(
    join(
      conversationSessionDir,
      "rollout-2026-07-25T09-00-00-000Z-11111111-1111-4111-8111-111111111111.jsonl"
    ),
    [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "11111111-1111-4111-8111-111111111111",
          cwd: "/work/agentenv-manager",
          timestamp: "2026-07-25T09:00:00.000Z"
        }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "conversation-user-1",
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: "Review the Agent environment before release"
          }]
        }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "conversation-assistant-1",
          type: "message",
          role: "assistant",
          content: [{
            type: "output_text",
            text: "## Release review\n\nThe Profile is saved and ready for a final Apply preview.\n\n```text\nPreview -> backup -> apply -> verify\n```"
          }]
        }
      })
    ].map((entry) => `${entry}\n`).join(""),
    "utf8"
  );
  for (const [timestamp, id, prompt, response] of [
    [
      "2026-07-25T08:30:00.000Z",
      "22222222-2222-4222-8222-222222222222",
      "Compare release notes before publishing",
      "The release notes match the saved Profile changes."
    ],
    [
      "2026-07-25T08:00:00.000Z",
      "33333333-3333-4333-8333-333333333333",
      "Check Workspace Skill ownership",
      "The Workspace Skill remains project-owned."
    ]
  ]) {
    await writeFile(
      join(conversationSessionDir, `rollout-${timestamp.replaceAll(":", "-")}-${id}.jsonl`),
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id, cwd: "/work/agentenv-manager", timestamp }
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            id: `${id}-user`,
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: prompt }]
          }
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            id: `${id}-assistant`,
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: response }]
          }
        })
      ].map((entry) => `${entry}\n`).join(""),
      "utf8"
    );
  }

  for (const command of ["opencode", "codex", "claude", "traecli"]) {
    const executable = join(binDir, command);
    await writeFile(executable, `#!/bin/sh\necho fake-${command}\n`, "utf8");
    await chmod(executable, 0o755);
  }

  await writeFile(join(opencodeDir, "AGENTS.md"), "# Existing OpenCode environment\n", "utf8");
  await writeJson(join(opencodeDir, "opencode.jsonc"), {
    shell: "/bin/zsh",
    mcp: Object.fromEntries(
      ["filesystem", "github", "postgres", "shared-docs"].map(
        (name, index) => [
          name,
          {
            type: "remote",
            url: `https://example.com/${name}/mcp`,
            enabled: index !== 2
          }
        ]
      )
    )
  });
  const cleanupSkillName = "cross-agent-review-workflow-with-a-long-name";
  const cleanupVariants = [
    {
      directory: join(opencodeDir, "skills", cleanupSkillName),
      description: "OpenCode review workflow with repository checks, release validation, and detailed reporting.",
      heading: "OpenCode review workflow"
    },
    {
      directory: join(codexDir, "skills", cleanupSkillName),
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
  const readyCleanupSkillName = "ready-local-cleanup";
  const readyCleanupSkillDir = join(opencodeDir, "skills", readyCleanupSkillName);
  await mkdir(readyCleanupSkillDir, { recursive: true });
  await writeFile(
    join(readyCleanupSkillDir, "SKILL.md"),
    "---\nname: Ready Local Cleanup\ndescription: A safe local copy ready for reviewed cleanup.\n---\n\n# Ready Local Cleanup\n",
    "utf8"
  );
  const sharedSkillName = "shared-compatibility-reviewer";
  const sharedSkillDir = join(homeDir, ".agents", "skills", sharedSkillName);
  await mkdir(sharedSkillDir, { recursive: true });
  await writeFile(
    join(sharedSkillDir, "SKILL.md"),
    "---\nname: Shared Compatibility Reviewer\ndescription: Shared today and ready for a deliberate per-Target migration.\n---\n\n# Shared Compatibility Reviewer\n",
    "utf8"
  );
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
        sourcePath: join(codexDir, "skills", cleanupSkillName),
        backupPath: join(cleanupBackupDir, "locations", `1-${cleanupSkillName}`)
      }
    ]
  });
  const sharedMigrationBackupId = "cleanup-retire-shared-capture";
  const sharedMigrationBackupDir = join(
    appDataRoot,
    "backups",
    "skill-cleanup",
    sharedMigrationBackupId
  );
  await mkdir(sharedMigrationBackupDir, { recursive: true });
  await writeJson(join(sharedMigrationBackupDir, "manifest.json"), {
    formatVersion: 2,
    id: sharedMigrationBackupId,
    libraryId: sharedSkillName,
    libraryCreated: false,
    createdAt: "2026-07-14T08:30:00.000Z",
    operation: "retire",
    status: "complete",
    expectedPaths: [],
    mutationHashes: [],
    entries: []
  });
  await writeJson(join(appDataRoot, "settings.json"), {
    skillSyncMethod: "copy",
    skillManagementFormatVersion: 1,
    skillStorageLocation: "appData",
    skillAutoCheckEnabled: false,
    skillAutoCheckIntervalMinutes: 60,
    enabledTargetIds: [],
    agentDiscoveryReviewedIds: [],
    projectSkillRoots: [projectSkillRoot]
  });
  const projectSkillDir = join(projectSkillRoot, "automation", "release-safety-review");
  await mkdir(projectSkillDir, { recursive: true });
  await writeFile(
    join(projectSkillDir, "SKILL.md"),
    "---\nname: Release Safety Review\ndescription: Review release readiness from this project without modifying its checkout.\nversion: 2.4.0\n---\n\n# Release Safety Review\n",
    "utf8"
  );
  await Promise.all(profileFixtures.map((profile) => writeProfile(appDataRoot, profile)));
  await writeLibrary(appDataRoot);
  await writeJson(join(appDataRoot, "skill-sources.json"), {
    formatVersion: 1,
    sources: Object.values(repositorySourceScopes).map((source) => ({
      formatVersion: 1,
      id: source.id,
      canonicalLink: `https://github.com/agentenv-community/agent-skills/tree/main/${source.directory}`,
      repository: repositorySource,
      ref: "main",
      directory: source.directory,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z"
    }))
  });
  const sharedLibraryDir = join(appDataRoot, "skills-library", sharedSkillName);
  await mkdir(sharedLibraryDir, { recursive: true });
  await copyFile(join(sharedSkillDir, "SKILL.md"), join(sharedLibraryDir, "SKILL.md"));
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
  await mkdir(join(githubSkillDir, "references"), { recursive: true });
  await mkdir(join(githubSkillDir, "scripts"), { recursive: true });
  await writeFile(
    join(githubSkillDir, "references", "checklist.md"),
    "# Review checklist\n\n- Confirm the rendered state.\n",
    "utf8"
  );
  await writeFile(
    join(githubSkillDir, "scripts", "inspect.ts"),
    "export const inspect = (path: string) => path.trim();\n",
    "utf8"
  );
  await writeJson(join(githubSkillDir, "settings.json"), {
    include: ["src/**/*.tsx"],
    strict: true
  });
  const gitWorkflowFixtureDir = join(
    githubFixtureRoot,
    "agentenv-community",
    "agent-skills",
    "main",
    "skills",
    "git-workflow"
  );
  await mkdir(gitWorkflowFixtureDir, { recursive: true });
  await writeFile(
    join(gitWorkflowFixtureDir, "SKILL.md"),
    "---\nname: git-workflow\ndescription: Shared git workflow.\n---\n\n# git-workflow\n",
    "utf8"
  );

  const gitFixtureRepo = join(root, "git-repository", "agent-skills");
  for (const skillId of Object.keys(repositorySourceScopes)) {
    const skillDir = join(gitFixtureRepo, "skills", skillId);
    await mkdir(skillDir, { recursive: true });
    await copyFile(
      join(githubFixtureRoot, "agentenv-community", "agent-skills", "main", "skills", skillId, "SKILL.md"),
      join(skillDir, "SKILL.md")
    );
  }
  await execFile("git", ["init"], { cwd: gitFixtureRepo });
  await execFile("git", ["checkout", "-b", "main"], { cwd: gitFixtureRepo });
  await execFile("git", ["config", "user.name", "AgentEnv Visual Test"], { cwd: gitFixtureRepo });
  await execFile("git", ["config", "user.email", "visual-test@agentenv.local"], { cwd: gitFixtureRepo });
  await execFile("git", ["add", "."], { cwd: gitFixtureRepo });
  await execFile("git", ["commit", "-m", "visual fixture"], {
    cwd: gitFixtureRepo,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: captureFixtureTimestamp.toISOString(),
      GIT_COMMITTER_DATE: captureFixtureTimestamp.toISOString()
    }
  });
  const workspaceSyncRemote = join(root, "workspace-sync.git");
  await execFile("/usr/bin/git", ["init", "--bare", workspaceSyncRemote]);
  await normalizeFixtureTimes(appDataRoot);
  await normalizeFixtureTimes(homeDir);
  await normalizeFixtureTimes(projectSkillRoot);
  await normalizeFixtureTimes(workspaceRoot);
  await normalizeFixtureTimes(githubFixtureRoot);

  return {
    appDataRoot,
    binDir,
    gitFixtureRepo,
    githubFixtureRoot,
    homeDir,
    projectSkillRoot,
    workspaceRoot,
    workspaceSyncRemote
  };
};

const capturePage = async (
  page,
  path,
  { preserveFocus = false, preservePointer = false } = {}
) => {
  const expectedSize = path.match(/-(\d+)x(\d+)\.png$/);
  if (expectedSize) {
    const viewport = page.viewportSize();
    if (
      viewport?.width !== Number(expectedSize[1]) ||
      viewport?.height !== Number(expectedSize[2])
    ) {
      throw new Error(
        `Capture filename ${path} does not match the ${viewport?.width ?? "unknown"}x${viewport?.height ?? "unknown"} viewport`
      );
    }
  }
  await page.evaluate(async ({ shouldPreserveFocus }) => {
    document.documentElement.dataset.agentenvCapture = "true";
    let captureStyle = document.getElementById("agentenv-capture-style");
    if (!captureStyle) {
      captureStyle = document.createElement("style");
      captureStyle.id = "agentenv-capture-style";
      captureStyle.textContent = `
        html[data-agentenv-capture] .global-sidebar,
        html[data-agentenv-capture] .page-header.ui-page-header,
        html[data-agentenv-capture] .window-drag-strip {
          -webkit-app-region: no-drag;
        }
      `;
      document.head.append(captureStyle);
    }
    await document.fonts?.ready;
    for (const animation of document.getAnimations()) {
      try {
        animation.finish();
      } catch {
        animation.pause();
        animation.currentTime = 0;
      }
    }
    if (!shouldPreserveFocus && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  }, {
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
  try {
    await page.screenshot({ path, animations: "disabled" });
  } finally {
    await page.evaluate(() => {
      delete document.documentElement.dataset.agentenvCapture;
    });
  }
};

const captureRegion = async (page, locator, path, { widthLocator } = {}) => {
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await document.fonts?.ready;
    for (const animation of document.getAnimations()) {
      try {
        animation.finish();
      } catch {
        animation.pause();
        animation.currentTime = 0;
      }
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });
  await page.mouse.move(2, 2);
  if (!widthLocator) {
    await locator.screenshot({ path, animations: "disabled" });
    return;
  }
  const widthBox = await widthLocator.boundingBox();
  if (!widthBox) {
    throw new Error(`Could not measure stable capture region for ${path}`);
  }
  const previousInlineSize = await locator.evaluate((element, width) => {
    const previous = element.style.inlineSize;
    element.style.inlineSize = `${width}px`;
    return previous;
  }, widthBox.width);
  try {
    await locator.screenshot({ path, animations: "disabled" });
  } finally {
    await locator.evaluate((element, previous) => {
      element.style.inlineSize = previous;
    }, previousInlineSize);
  }
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
    build: {
      sourceFingerprint: capturedBuild.source.sha256,
      artifactFingerprint: capturedBuild.artifact.sha256,
      generatedAt: capturedBuild.generatedAt
    },
    viewports: ["1180x728", "920x620"],
    files
  });
};

await mkdir(outputDir, { recursive: true });
for (const entry of await readdir(outputDir, { withFileTypes: true })) {
  if (
    entry.isFile() &&
    entry.name !== "reference.png" &&
    (entry.name.endsWith(".png") || entry.name === "capture-manifest.json")
  ) {
    await rm(join(outputDir, entry.name), { force: true });
  }
}
if (suppliedReference && suppliedReference !== referencePath) {
  await copyFile(suppliedReference, referencePath);
}

const fixtureRoot = resolve(
  process.env.AGENTENV_CAPTURE_FIXTURE_ROOT ??
    join(tmpdir(), "agentenv-profiles-capture-fixture")
);
const fixtureRelativePath = fixtureRoot.slice(resolve(tmpdir()).length);
if (
  !fixtureRelativePath.startsWith("/") ||
  fixtureRelativePath.includes("../")
) {
  throw new Error("Capture fixture root must stay inside the system temporary directory.");
}
await rm(fixtureRoot, { recursive: true, force: true });
await mkdir(fixtureRoot, { recursive: true });
let app;
try {
  const {
    appDataRoot,
    binDir,
    gitFixtureRepo,
    githubFixtureRoot,
    homeDir,
    projectSkillRoot,
    workspaceSyncRemote
  } = await prepareFixture(fixtureRoot);
  app = await electron.launch({
    executablePath: electronPath,
    args: [
      "--disable-gpu",
      "--force-device-scale-factor=1",
      `--user-data-dir=${join(fixtureRoot, "electron-user-data")}`,
      join(projectRoot, "out", "main", "main.js")
    ],
    env: {
      ...process.env,
      AGENTENV_AUTOMATION: "1",
      AGENTENV_AUTOMATION_BACKGROUND_DELAY_MS: "4000",
      AGENTENV_DATA_ROOT: appDataRoot,
      AGENTENV_FAKE_HOME: join(fixtureRoot, "fake-home"),
      AGENTENV_GITHUB_FIXTURE_ROOT: githubFixtureRoot,
      AGENTENV_HOME: homeDir,
      GIT_ALLOW_PROTOCOL: "file:https:ssh",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(gitFixtureRepo).toString()}.insteadOf`,
      GIT_CONFIG_VALUE_0: repositorySource,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
    }
  });

  const page = await app.firstWindow();
  const windowHandle = await app.browserWindow(page);
  await page.waitForLoadState("domcontentloaded");
  const agentDiscoveryDialog = page.getByRole("dialog", { name: "Choose Agents" });
  await agentDiscoveryDialog.waitFor({ state: "visible" });
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "agents-first-run-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "agents-first-run-920x620.png"));
  await agentDiscoveryDialog
    .getByRole("button", { name: /^Enable \d+ Agents$/ })
    .click();
  const agentSetupDialog = page.getByRole("dialog", { name: "Agents enabled" });
  await agentSetupDialog.waitFor({ state: "visible" });
  await agentSetupDialog.getByRole("button", { name: "Set up later" }).click();
  await agentSetupDialog.waitFor({ state: "hidden" });
  await setWindowSize(page, windowHandle, 1180, 728);
  const agentsWorkspace = page.getByRole("region", { name: "Agents", exact: true });
  await agentsWorkspace.waitFor({ state: "visible" });
  await agentsWorkspace.getByRole("article", { name: "Agent OpenCode" }).waitFor({
    state: "visible"
  });
  await agentsWorkspace
    .getByText("Checking local Skills", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => undefined);
  await capturePage(page, join(outputDir, "agents-checking-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "agents-checking-920x620.png"));
  await app.evaluate(() => {
    delete process.env.AGENTENV_AUTOMATION_BACKGROUND_DELAY_MS;
  });
  await page.waitForFunction(() =>
    !document
      .querySelector(".environment-status-strip")
      ?.classList.contains("environment-status-strip--checking")
  );

  const sharedSkillDir = join(
    homeDir,
    ".agents",
    "skills",
    "shared-compatibility-reviewer"
  );
  await rm(sharedSkillDir, { recursive: true, force: true });
  await page.reload();
  await agentsWorkspace.locator(".target-page-summary").waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "agents-ready-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "agents-ready-1180x728.png"));
  await setWindowSize(page, windowHandle, 1440, 900);
  await capturePage(page, join(outputDir, "agents-ready-1440x900.png"));

  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await page.getByRole("heading", { name: "Workspaces", exact: true }).waitFor({
    state: "visible"
  });
  await page.getByRole("heading", { name: "Release Console", exact: true }).waitFor({
    state: "visible"
  });
  await page
    .locator(".project-detail__header .ui-inspector-header__copy > span")
    .evaluate((element) => {
      element.textContent = "~/Projects/release-console";
      element.setAttribute("title", "~/Projects/release-console");
    });
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "workspaces-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "workspaces-920x620.png"));
  await setWindowSize(page, windowHandle, 1440, 900);
  await capturePage(page, join(outputDir, "workspaces-1440x900.png"));
  await page.getByRole("button", { name: "Expand Skills", exact: true }).click();
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "workspaces-skills-expanded-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "workspaces-skills-expanded-1180x728.png"));
  await setWindowSize(page, windowHandle, 1440, 900);
  await capturePage(page, join(outputDir, "workspaces-skills-expanded-1440x900.png"));
  await page.getByRole("button", { name: "Expand Instructions", exact: true }).click();
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(
    page,
    join(outputDir, "workspaces-resources-multi-expanded-920x620.png")
  );
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(
    page,
    join(outputDir, "workspaces-resources-multi-expanded-1180x728.png")
  );
  await setWindowSize(page, windowHandle, 920, 620);
  await page.getByRole("button", { name: "Agents", exact: true }).click();

  const profilesDir = join(appDataRoot, "profiles");
  const heldProfilesDir = join(appDataRoot, "profiles-capture-hold");
  await rename(profilesDir, heldProfilesDir);
  await page.reload();
  await agentsWorkspace.getByText("Set up your first Agent", { exact: true }).waitFor({
    state: "visible"
  });
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "agents-setup-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "agents-setup-1180x728.png"));
  await rename(heldProfilesDir, profilesDir);

  await app.evaluate(() => {
    process.env.AGENTENV_AUTOMATION_SKILL_SCAN_FAILURE = "1";
  });
  await page.reload();
  await agentsWorkspace.getByText("Profile check unavailable", { exact: true }).waitFor({
    state: "visible"
  });
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "agents-unavailable-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "agents-unavailable-1180x728.png"));
  await app.evaluate(() => {
    delete process.env.AGENTENV_AUTOMATION_SKILL_SCAN_FAILURE;
  });

  await mkdir(sharedSkillDir, { recursive: true });
  await copyFile(
    join(appDataRoot, "skills-library", "shared-compatibility-reviewer", "SKILL.md"),
    join(sharedSkillDir, "SKILL.md")
  );
  await page.evaluate(() => window.agentEnv.setSharedSkillAreaMode("managed"));
  await page.reload();
  await agentsWorkspace.getByText("1 shared Skill needs review", { exact: true }).waitFor({
    state: "visible"
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Interface language").selectOption("zh_CN");
  await page.getByRole("heading", { name: "设置" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await agentsWorkspace.getByText("1 个共享 Skill 需要检查", { exact: true }).waitFor({
    state: "visible"
  });
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "agents-ready-zh-cn-920x620.png"));
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("界面语言").selectOption("zh_TW");
  await page.getByRole("heading", { name: "設定" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await agentsWorkspace.getByText("1 個共享 Skill 需要檢查", { exact: true }).waitFor({
    state: "visible"
  });
  await capturePage(page, join(outputDir, "agents-ready-zh-tw-920x620.png"));
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("介面語言").selectOption("en");
  await page.getByRole("heading", { name: "Settings" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await agentsWorkspace.getByText("1 shared Skill needs review", { exact: true }).waitFor({
    state: "visible"
  });
  await setWindowSize(page, windowHandle, 1180, 728);
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByRole("region", { name: "Skill library", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("group", { name: "Library item react-best-practices" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-1180x728.png"));
  await setWindowSize(page, windowHandle, 1440, 900);
  await capturePage(page, join(outputDir, "skills-1440x900.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  const hiddenAgents = page.getByRole("button", {
    name: /^Show hidden Agent list, \d+ items?$/
  });
  await hiddenAgents.hover();
  const hiddenAgentsPopover = page.getByRole("menu", { name: "Hidden Agents" })
    .filter({ hasText: "Antigravity" })
    .filter({ hasText: "Trae CLI" });
  await hiddenAgentsPopover.waitFor({ state: "visible" });
  await capturePage(
    page,
    join(outputDir, "sidebar-agent-overflow-1180x728.png"),
    { preservePointer: true }
  );
  await page
    .getByRole("group", { name: "Library item react-best-practices" })
    .hover();
  await hiddenAgentsPopover.waitFor({ state: "hidden" });
  await page
    .getByRole("group", { name: "Library item react-best-practices" })
    .getByRole("button", { name: "Change icon for react-best-practices" })
    .click();
  await page.getByRole("menu", { name: "Icons for react-best-practices" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-icon-picker-1180x728.png"));
  await page.keyboard.press("Escape");
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "skills-920x620.png"));
  await page.keyboard.press("Meta+k");
  const quickOpen = page.getByRole("dialog", { name: "Quick open" });
  await quickOpen.waitFor({ state: "visible" });
  await quickOpen.getByRole("combobox").fill("review");
  await capturePage(page, join(outputDir, "quick-open-920x620.png"), { preserveFocus: true });
  await page.keyboard.press("Escape");
  await page
    .getByRole("group", { name: "Library item react-best-practices" })
    .getByRole("button", { name: "react-best-practices", exact: true })
    .click();
  const fileBrowserDialog = page.getByRole("dialog", {
    name: "Files in react-best-practices"
  });
  await fileBrowserDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-file-browser-920x620.png"));
  await fileBrowserDialog.getByRole("button", { name: "Maximize preview" }).click();
  await capturePage(page, join(outputDir, "skills-file-browser-maximized-920x620.png"));
  await fileBrowserDialog.getByRole("button", { name: "Restore preview size" }).click();
  await fileBrowserDialog.getByRole("button", { name: "inspect.ts" }).click();
  await fileBrowserDialog.locator(".skill-file-preview > header code").getByText("typescript", {
    exact: true
  }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-file-browser-typescript-920x620.png"));
  await fileBrowserDialog.getByRole("button", { name: "Close" }).click();
  await fileBrowserDialog.waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "By source" }).click();
  await page.locator(".skill-source-group").nth(1).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-sources-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "skills-sources-1180x728.png"));
  await setWindowSize(page, windowHandle, 1440, 900);
  await capturePage(page, join(outputDir, "skills-sources-1440x900.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await page.getByRole("button", { name: "Expand source" }).first().click();
  await capturePage(page, join(outputDir, "skills-sources-expanded-920x620.png"));
  await page.getByRole("button", { name: /Source actions for/ }).first().click();
  await page.getByRole("menuitem", { name: "Rename source" }).click();
  await page.getByRole("dialog", { name: "Rename source" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-source-rename-920x620.png"));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  const sourceSelections = page.locator(".skill-source-list").getByRole("checkbox");
  await sourceSelections.nth(0).check();
  await sourceSelections.nth(1).check();
  await capturePage(page, join(outputDir, "skills-sources-selection-920x620.png"));
  await page.getByRole("button", { name: "Merge selected (2)", exact: true }).click();
  const sourceMergeDialog = page.getByRole("dialog", { name: "Confirm source merge" });
  await sourceMergeDialog.waitFor({ state: "visible" });
  await sourceMergeDialog.getByText("Checking merged source...").waitFor({ state: "hidden" });
  await capturePage(page, join(outputDir, "skills-source-merge-920x620.png"));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Exit merge selection" }).click();
  await page.getByRole("tab", { name: "Skill list" }).click();
  await page.getByRole("tab", { name: /Disabled/ }).click();
  await capturePage(page, join(outputDir, "skills-disabled-920x620.png"));
  await page.getByRole("tab", { name: /Enabled/ }).click();
  const skillSearch = page.getByRole("textbox", { name: "Search skills" });
  await skillSearch.fill("no-such-skill");
  await capturePage(page, join(outputDir, "skills-empty-920x620.png"));
  await skillSearch.fill("");
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
  await writeFile(
    join(
      githubFixtureRoot,
      "agentenv-community",
      "agent-skills",
      "main",
      "skills",
      "react-best-practices",
      "SKILL.md"
    ),
    "---\nname: react-best-practices\ndescription: Updated React review guidance.\n---\n\n# react-best-practices\n\nReview the available update before applying it.\n",
    "utf8"
  );
  const checkUpdatesButton = page.getByRole("button", { name: "Check updates" });
  await checkUpdatesButton.click();
  const checkUpdatesHandle = await checkUpdatesButton.elementHandle();
  await page.waitForFunction(
    (button) => button?.getAttribute("aria-busy") === "false",
    checkUpdatesHandle,
    { timeout: 15_000 }
  );
  await page
    .getByRole("group", { name: "Library item react-best-practices" })
    .getByRole("button", { name: "Update react-best-practices" })
    .waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(5_200);
  await capturePage(page, join(outputDir, "skills-update-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "skills-update-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await page.getByRole("tab", { name: "By source" }).click();
  const updatedSourceGroup = page.locator(".skill-source-group").filter({
    hasText: "react-best-practices"
  }).first();
  await updatedSourceGroup.getByRole("button", { name: /Source actions for/ }).click();
  const checkSourceMenuItem = page.getByRole("menuitem", { name: "Check source" });
  await checkSourceMenuItem.click();
  await updatedSourceGroup.locator(".skill-source-status-label")
    .filter({ hasText: "Update available" })
    .waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-sources-update-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "skills-sources-update-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await page.getByRole("tab", { name: "Skill list" }).click();
  await page
    .getByRole("group", { name: "Library item react-best-practices" })
    .getByRole("button", { name: "Update react-best-practices" })
    .click();
  const skillUpdateDialog = page.getByRole("dialog", {
    name: "Update preview for react-best-practices"
  });
  await skillUpdateDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-update-review-920x620.png"));
  await skillUpdateDialog.getByRole("button", { name: "Maximize preview" }).click();
  const skillUpdateWorkspace = page.getByRole("dialog", { name: "Full-screen preview" });
  await skillUpdateWorkspace.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-update-review-maximized-920x620.png"));
  await page.keyboard.press("Escape");
  await skillUpdateWorkspace.waitFor({ state: "hidden" });
  await skillUpdateDialog.getByRole("button", { name: "Cancel" }).click();
  await skillUpdateDialog.waitFor({ state: "hidden" });
  await page.locator(".app-feedback--success, .app-feedback--info").waitFor({
    state: "hidden",
    timeout: 8_000
  });

  await page.getByRole("button", { name: "Import skills" }).click();
  const importDialog = page.getByRole("dialog", { name: "Import skills" });
  await importDialog.waitFor({ state: "visible" });
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "skills-import-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "skills-import-920x620.png"));
  await app.evaluate(
    ({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
        bookmarks: []
      });
    },
    projectSkillRoot
  );
  await importDialog.getByRole("button", { name: "Choose local Skill source" }).click();
  await importDialog.locator(".project-skill-row").first().waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-import-projects-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "skills-import-projects-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await importDialog.getByRole("tab", { name: "Repository" }).click();
  await capturePage(page, join(outputDir, "skills-import-github-920x620.png"));
  await importDialog.getByText("Advanced", { exact: true }).click();
  await capturePage(page, join(outputDir, "skills-import-repository-advanced-920x620.png"));
  await importDialog.getByLabel("Repository address").fill(gitFixtureRepo);
  await importDialog.getByRole("button", { name: "Scan", exact: true }).click();
  await importDialog.locator(".github-candidate-row").first().waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-import-results-920x620.png"));
  await importDialog.getByRole("button", { name: "Close", exact: true }).click();
  await importDialog.waitFor({ state: "hidden" });

  const skillActionsButton = page.getByRole("button", {
    name: "More actions for react-best-practices"
  });
  await skillActionsButton.click();
  await page.getByRole("menu", { name: "Actions for react-best-practices" }).waitFor({
    state: "visible"
  });
  await capturePage(page, join(outputDir, "skills-actions-920x620.png"));
  await page.getByRole("menuitem", { name: "Disable globally" }).click();
  const disableSkillDialog = page.getByRole("dialog", { name: "Disable library skill" });
  await disableSkillDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-disable-confirmation-920x620.png"));
  await page.keyboard.press("Escape");
  await skillActionsButton.click();
  await page.getByRole("menuitem", { name: "Update settings" }).click();
  const updateSettingsDialog = page.getByRole("dialog", {
    name: "Update settings for react-best-practices"
  });
  await updateSettingsDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-update-settings-920x620.png"));
  await page.keyboard.press("Escape");
  await skillActionsButton.click();
  await page.getByRole("menuitem", { name: "Remove from library" }).click();
  const deleteSkillDialog = page.getByRole("dialog", { name: "Delete library skill" });
  await deleteSkillDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "skills-delete-confirmation-920x620.png"));
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Local Skills" }).click();
  const cleanupGroup = page.getByRole("group", {
    name: "Cleanup group cross-agent-review-workflow-with-a-long-name"
  });
  await cleanupGroup.waitFor({ state: "visible", timeout: 5_000 });
  const cleanupAction = page.getByRole("button", { name: /Manage \d+ eligible Skills/ });
  await page
    .getByRole("group", { name: "Cleanup group ready-local-cleanup" })
    .waitFor({ state: "visible", timeout: 5_000 });
  await cleanupAction.waitFor({ state: "visible", timeout: 5_000 });
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "skills-cleanup-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "skills-cleanup-920x620.png"));
  const sharedCleanupGroup = page.getByRole("group", {
    name: "Cleanup group shared-compatibility-reviewer"
  });
  await sharedCleanupGroup.waitFor({ state: "visible", timeout: 5_000 });
  await cleanupAction.click();
  const sharedCleanupReview = page.getByRole("dialog", {
    name: "Manage eligible local Skills"
  });
  await sharedCleanupReview.waitFor({ state: "visible", timeout: 5_000 });
  await capturePage(page, join(outputDir, "skills-cleanup-shared-review-920x620.png"));
  await page.keyboard.press("Escape");
  await sharedCleanupReview.waitFor({ state: "hidden", timeout: 5_000 });
  const cleanupSummary = cleanupGroup.getByLabel(
    "Full cleanup summary cross-agent-review-workflow-with-a-long-name"
  );
  await cleanupSummary.hover();
  await page.waitForTimeout(380);
  if (await page.getByRole("tooltip").count()) {
    await capturePage(
      page,
      join(outputDir, "skills-cleanup-tooltip-920x620.png"),
      { preservePointer: true }
    );
  }
  await page.mouse.move(2, 2);
  await cleanupGroup
    .getByRole("button", {
      name: "Add to Library cross-agent-review-workflow-with-a-long-name"
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
    .getByRole("region", { name: "Local Skills Manager" })
    .waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("button", { name: "Review shared folder" }).click();
  const sharedSkillsManager = page.getByRole("region", { name: "Shared Skills" });
  await sharedSkillsManager.waitFor({ state: "visible", timeout: 5_000 });
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "skills-shared-folder-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "skills-shared-folder-1180x728.png"));
  await page.getByRole("button", { name: "Close library tool" }).click();

  await page.evaluate(() => window.agentEnv.setSharedSkillAreaMode("profiles-only"));
  await page.reload();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByRole("button", { name: "Local Skills" }).click();
  await page.getByRole("region", { name: "Local Skills Manager" })
    .waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("button", { name: "Review shared folder" }).click();
  await page.getByRole("region", { name: "Shared Skills" })
    .waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("button", { name: "Restore shared setup…" })
    .waitFor({ state: "visible", timeout: 5_000 });
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(
    page,
    join(outputDir, "skills-shared-folder-profiles-only-920x620.png")
  );
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(
    page,
    join(outputDir, "skills-shared-folder-profiles-only-1180x728.png")
  );
  await page.getByRole("button", { name: "Close library tool" }).click();

  const captureWorkspace = async (buttonName, filePrefix, readyLocator, prepare) => {
    await page.getByRole("button", { name: buttonName, exact: true }).click();
    await readyLocator().waitFor({ state: "visible" });
    await prepare?.();
    await setWindowSize(page, windowHandle, 1180, 728);
    await capturePage(page, join(outputDir, `${filePrefix}-1180x728.png`));
    await setWindowSize(page, windowHandle, 1440, 900);
    await capturePage(page, join(outputDir, `${filePrefix}-1440x900.png`));
    await setWindowSize(page, windowHandle, 920, 620);
    await capturePage(page, join(outputDir, `${filePrefix}-920x620.png`));
  };

  const selectCaptureProfile = async (name) => {
    await page.getByRole("button", { name: "Choose Profile", exact: true }).click();
    const switcher = page.getByRole("dialog", { name: "Choose Profile", exact: true });
    await switcher.getByRole("option", { name: `Profile ${name}`, exact: true }).click();
    await page
      .locator(".profile-switcher--hero .ui-object-switcher__trigger-title")
      .filter({ hasText: name })
      .waitFor({ state: "visible" });
  };

  const waitForProfileTitle = async (name) => {
    await page
      .locator(".profile-switcher--hero .ui-object-switcher__trigger-title")
      .filter({ hasText: name })
      .waitFor({ state: "visible" });
  };

  const ensureComposerExpanded = async (name) => {
    const id = name === "MCPs" ? "mcp" : name.toLowerCase();
    const section = page.locator(`[data-profile-composer-id="${id}"]`);
    const trigger = section.getByRole("button", { name, exact: true });
    if (await trigger.getAttribute("aria-expanded") !== "true") {
      await trigger.click();
    }
    await section.locator(".ui-resource-disclosure__panel").waitFor({ state: "visible" });
    return section;
  };

  const showOnlyComposerSection = async (name) => {
    for (const candidate of ["Instructions", "Skills", "MCPs"]) {
      const id = candidate === "MCPs" ? "mcp" : candidate.toLowerCase();
      const section = page.locator(`[data-profile-composer-id="${id}"]`);
      const trigger = section.getByRole("button", { name: candidate, exact: true });
      const expanded = await trigger.getAttribute("aria-expanded") === "true";
      if (candidate !== name && expanded) await trigger.click();
    }
    const section = await ensureComposerExpanded(name);
    await section.scrollIntoViewIfNeeded();
    return section;
  };

  await captureWorkspace(
    "Profiles",
    "profiles",
    () => page.getByRole("region", { name: "Profiles", exact: true }),
    async () => {
      await selectCaptureProfile("Code Review");
    }
  );

  await selectCaptureProfile("Daily Coding");
  await app.evaluate(() => {
    process.env.AGENTENV_TEST_PROFILE_READ_DELAY_ID = "code-review";
    process.env.AGENTENV_TEST_PROFILE_READ_DELAY_MS = "350";
  });
  await selectCaptureProfile("Code Review");
  const loadingProfile = page.getByRole("status", { name: "Loading Profile Code Review" });
  await loadingProfile.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "profile-loading-920x620.png"));
  await waitForProfileTitle("Code Review");
  await loadingProfile.waitFor({ state: "hidden" });
  await app.evaluate(() => {
    delete process.env.AGENTENV_TEST_PROFILE_READ_DELAY_ID;
    delete process.env.AGENTENV_TEST_PROFILE_READ_DELAY_MS;
  });

  await page.getByRole("button", { name: "Choose Profile" }).click();
  await page
    .getByRole("dialog", { name: "Choose Profile" })
    .getByRole("button", { name: "New Profile" })
    .click();
  const sparseProfileDialog = page.getByRole("dialog", { name: "New Profile" });
  await sparseProfileDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "profile-create-920x620.png"));
  await sparseProfileDialog.getByLabel("Profile name").fill("Sparse Capture");
  await sparseProfileDialog
    .getByLabel("Description")
    .fill("Visual fixture for sparse resource states.");
  await sparseProfileDialog.getByRole("button", { name: "Create" }).click();
  await waitForProfileTitle("Sparse Capture");
  const sparseSkillsSection = await ensureComposerExpanded("Skills");
  await capturePage(page, join(outputDir, "profile-skills-empty-920x620.png"));

  await sparseSkillsSection.getByRole("button", { name: "Add Skill", exact: true }).click();
  const sparseSkillPicker = page.getByRole("dialog", { name: "Add library skills" });
  await sparseSkillPicker.waitFor({ state: "visible" });
  await sparseSkillPicker.getByLabel("git-workflow", { exact: true }).check();
  await sparseSkillPicker.getByRole("button", { name: /^Add 1$/ }).click();
  await sparseSkillPicker.waitFor({ state: "hidden" });
  await page.getByRole("listitem", { name: "Profile Skill git-workflow" }).waitFor();

  await page.waitForTimeout(900);
  await page.waitForFunction(() => !document.querySelector(".profile-row__dirty"));
  await page.waitForTimeout(4_300);
  await capturePage(page, join(outputDir, "profile-skills-single-920x620.png"));
  await page.getByRole("button", { name: "More Profile actions" }).click();
  await page.getByRole("menuitem", { name: "Delete Profile" }).click();
  const sparseDeleteDialog = page.getByRole("dialog", { name: "Delete Profile" });
  await sparseDeleteDialog.waitFor({ state: "visible" });
  await sparseDeleteDialog.getByRole("button", { name: "Remove Profile" }).click();
  await sparseDeleteDialog.waitFor({ state: "hidden" });

  await selectCaptureProfile("Code Review");
  await waitForProfileTitle("Code Review");
  await page.locator(".profile-hero").getByRole("button", { name: "Edit Profile" }).click();
  const editProfileDialog = page.getByRole("dialog", { name: "Edit Profile" });
  await editProfileDialog
    .getByRole("button", { name: "Change icon for Code Review" })
    .click();
  await page.getByRole("menu", { name: "Icons for Code Review" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "profile-icon-picker-920x620.png"));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await editProfileDialog.waitFor({ state: "hidden" });
  const skillsPolicy = page.getByRole("combobox", {
    name: "Skills application policy for OpenCode"
  });
  await capturePage(page, join(outputDir, "profile-policy-use-profile-920x620.png"));
  await skillsPolicy.selectOption("disable");
  await capturePage(page, join(outputDir, "profile-policy-turn-off-920x620.png"));
  await skillsPolicy.selectOption("ignore");
  await capturePage(page, join(outputDir, "profile-policy-keep-current-920x620.png"));
  await skillsPolicy.selectOption("manage");
  await page.waitForTimeout(500);
  for (const sectionName of ["Instructions", "Skills", "MCPs"]) {
    await showOnlyComposerSection(sectionName);
    await capturePage(
      page,
      join(outputDir, `profile-${sectionName.toLowerCase().replace(" ", "-")}-920x620.png`)
    );
    if (sectionName === "MCPs") {
      await setWindowSize(page, windowHandle, 1180, 728);
      await capturePage(page, join(outputDir, "profile-mcps-1180x728.png"));
      await setWindowSize(page, windowHandle, 920, 620);
    }
    if (sectionName === "Skills") {
      await page
        .getByRole("region", { name: "Profile Skills" })
        .getByRole("button", { name: "Add Skill", exact: true })
        .click();
      const skillPicker = page.getByRole("dialog", { name: "Add library skills" });
      await skillPicker.waitFor({ state: "visible" });
      await capturePage(page, join(outputDir, "profile-skill-picker-920x620.png"));
      await page.keyboard.press("Escape");
      await skillPicker.waitFor({ state: "hidden" });
    }
  }
  for (const sectionName of ["Instructions", "Skills", "MCPs"]) {
    await ensureComposerExpanded(sectionName);
  }
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(
    page,
    join(outputDir, "profile-resources-multi-expanded-920x620.png")
  );
  await captureRegion(
    page,
    page.locator('[data-profile-composer-id="skills"]'),
    join(outputDir, "profile-skills-region-920.png"),
    { widthLocator: page.locator(".profile-editor-surface") }
  );
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(
    page,
    join(outputDir, "profile-resources-multi-expanded-1180x728.png")
  );
  await setWindowSize(page, windowHandle, 1180, 728);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const previewDialog = page.getByRole("dialog", { name: "Preview" });
  await previewDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "apply-preview-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "apply-preview-920x620.png"));
  await previewDialog.getByRole("button", { name: "Apply", exact: true }).click();
  await previewDialog.waitFor({ state: "hidden" });

  await writeFile(
    join(homeDir, ".config", "opencode", "AGENTS.md"),
    "# Changed outside AgentEnv\n",
    "utf8"
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await selectCaptureProfile("Code Review");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const driftPreviewDialog = page.getByRole("dialog", { name: "Preview" });
  await driftPreviewDialog.waitFor({ state: "visible" });
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "apply-preview-review-required-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "apply-preview-review-required-920x620.png"));
  const applyButton = driftPreviewDialog.getByRole("button", { name: "Apply", exact: true });
  if ((await applyButton.count()) > 0) {
    await applyButton.click();
  } else {
    await driftPreviewDialog.getByLabel(/Back up and replace protected resources/).check();
    await driftPreviewDialog.getByRole("button", { name: "Back up and replace" }).click();
  }
  await driftPreviewDialog.waitFor({ state: "hidden" });

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("region", { name: "Profiles", exact: true }).waitFor({ state: "visible" });
  await selectCaptureProfile("Code Review");
  await waitForProfileTitle("Code Review");
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "profiles-applied-920x620.png"));
  await ensureComposerExpanded("Instructions");
  await capturePage(page, join(outputDir, "profile-instructions-expanded-920x620.png"));
  await page.getByRole("button", { name: "Open AGENTS.md", exact: true }).click();
  const profileInstructionEditor = page.getByRole("dialog", {
    name: "Instruction document"
  });
  await profileInstructionEditor.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "profile-instruction-preview-920x620.png"), {
    preserveFocus: true
  });
  await profileInstructionEditor.getByRole("button", { name: "Edit", exact: true }).click();
  await capturePage(page, join(outputDir, "profile-instruction-editor-920x620.png"), {
    preserveFocus: true
  });
  await profileInstructionEditor.getByRole("button", { name: "Maximize preview" }).click();
  await capturePage(page, join(outputDir, "profile-instruction-editor-maximized-920x620.png"), {
    preserveFocus: true
  });
  await profileInstructionEditor.getByRole("button", { name: "Close" }).first().click();
  await profileInstructionEditor.waitFor({ state: "hidden" });
  await ensureComposerExpanded("Skills");
  await capturePage(page, join(outputDir, "profile-skills-applied-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "profile-skills-applied-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  const localOverridePath = join(
    homeDir,
    ".config",
    "opencode",
    "skills",
    "git-workflow"
  );
  await rm(localOverridePath, { recursive: true, force: true });
  await mkdir(localOverridePath, { recursive: true });
  await writeFile(
    join(localOverridePath, "SKILL.md"),
    "---\nname: git-workflow\n---\n\n# Device-specific Git workflow\n",
    "utf8"
  );
  const localOverrideApply = await page.evaluate(async (path) => {
    await window.agentEnv.setUnmanagedSkillLocations({
      items: [{ path, targetId: "opencode", coverage: "exact" }],
      unmanaged: true
    });
    const preview = await window.agentEnv.previewApply("code-review", "opencode");
    return window.agentEnv.applyProfile("code-review", preview.id);
  }, localOverridePath);
  if (!localOverrideApply.ok) {
    throw new Error(
      `Could not create the local-override capture state: ${localOverrideApply.errors.join(", ")}`
    );
  }
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await selectCaptureProfile("Code Review");
  await ensureComposerExpanded("Skills");
  await page
    .getByRole("listitem", { name: "Profile Skill git-workflow" })
    .scrollIntoViewIfNeeded();
  await capturePage(
    page,
    join(outputDir, "profile-skills-local-override-920x620.png")
  );
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(
    page,
    join(outputDir, "profile-skills-local-override-1180x728.png")
  );
  await setWindowSize(page, windowHandle, 920, 620);
  const mixedSkillRegion = page.getByRole("region", { name: "Profile Skills" });
  await mixedSkillRegion
    .getByRole("listitem", { name: "Profile Skill testing-strategies" })
    .getByRole("switch", { name: "Disable testing-strategies" })
    .click();
  await mixedSkillRegion.getByRole("button", { name: "Add Skill", exact: true }).click();
  const mixedSkillPicker = page.getByRole("dialog", { name: "Add library skills" });
  await mixedSkillPicker.getByLabel("react-best-practices", { exact: true }).check();
  await mixedSkillPicker.getByRole("button", { name: /^Add 1$/ }).click();
  await mixedSkillPicker.waitFor({ state: "hidden" });
  await capturePage(page, join(outputDir, "profile-skill-statuses-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "profile-skill-statuses-1180x728.png"));
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("complementary", { name: "Global navigation" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("region", { name: "Profiles", exact: true }).waitFor({ state: "visible" });
  await selectCaptureProfile("Code Review");
  await waitForProfileTitle("Code Review");
  await ensureComposerExpanded("Skills");
  await capturePage(page, join(outputDir, "profiles-applied-1180x728.png"));
  await setWindowSize(page, windowHandle, 1440, 900);
  await capturePage(page, join(outputDir, "profiles-applied-1440x900.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await captureWorkspace(
    "Agents",
    "targets",
    () => page.getByRole("region", { name: "Agents", exact: true })
  );
  const claudeAgent = page.getByRole("article", { name: "Agent Claude Code" });
  await claudeAgent.getByRole("button", { name: "Claude Code", exact: true }).click();
  const unmanagedAgentCapture = page.getByRole("dialog", {
    name: "Create Profile from Claude Code"
  });
  await unmanagedAgentCapture.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "agent-configure-unmanaged-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "agent-configure-unmanaged-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await unmanagedAgentCapture.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.getByRole("region", { name: "Agents", exact: true }).waitFor({
    state: "visible"
  });
  const openCodeAgent = page.getByRole("article", { name: "Agent OpenCode" });
  await openCodeAgent.getByRole("button", { name: "OpenCode", exact: true }).click();
  const agentProfileComposer = page.getByRole("region", { name: "Profile composer" });
  await agentProfileComposer.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "agent-profile-config-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "agent-profile-config-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.getByRole("region", { name: "Agents", exact: true }).waitFor({
    state: "visible"
  });
  await openCodeAgent.getByRole("button", { name: "More actions for OpenCode" }).click();
  await page.getByRole("menuitem", { name: "Diagnostics" }).click();
  await openCodeAgent.getByRole("region", { name: "OpenCode diagnostics" }).waitFor({
    state: "visible"
  });
  await capturePage(page, join(outputDir, "target-diagnostics-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "target-diagnostics-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await openCodeAgent.getByRole("button", { name: "Stop managing OpenCode" }).click();
  const stopManagingDialog = page.getByRole("dialog", { name: "Stop managing Agent" });
  await stopManagingDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "target-stop-managing-choice-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "target-stop-managing-choice-1180x728.png"));
  await stopManagingDialog.getByRole("button", { name: "Review changes" }).click();
  const stopManagingPreview = page.getByRole("dialog", { name: "Preview" });
  await stopManagingPreview.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "target-stop-managing-preview-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "target-stop-managing-preview-920x620.png"));
  await page.keyboard.press("Escape");
  await stopManagingPreview.waitFor({ state: "hidden" });
  const openCodeMoreActions = openCodeAgent.getByRole("button", {
    name: "More actions for OpenCode"
  });
  await openCodeMoreActions.scrollIntoViewIfNeeded();
  await openCodeMoreActions.click();
  await page.getByRole("menuitem", { name: "Hide diagnostics" }).click();
  await setWindowSize(page, windowHandle, 920, 620);
  await page.getByRole("button", { name: "Recovery" }).click();
  const recoveryDialog = page.getByRole("dialog", { name: "Recovery" });
  await recoveryDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "target-recovery-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "target-recovery-1180x728.png"));
  await recoveryDialog.getByRole("button", { name: "Close" }).click();
  await recoveryDialog.waitFor({ state: "hidden" });
  await setWindowSize(page, windowHandle, 920, 620);
  await page
    .getByRole("article", { name: "Agent OpenCode" })
    .getByRole("button", { name: "More actions for OpenCode" })
    .click();
  await page.getByRole("menuitem", { name: "Capture" }).click();
  const targetCaptureDialog = page.getByRole("dialog", { name: "Create Profile from OpenCode" });
  await targetCaptureDialog.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "target-capture-setup-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "target-capture-setup-1180x728.png"));
  await targetCaptureDialog.getByRole("button", { name: "Review" }).click();
  const targetCaptureReview = page.getByRole("dialog", { name: "Review OpenCode capture" });
  await targetCaptureReview.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "target-capture-review-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "target-capture-review-920x620.png"));
  await page.keyboard.press("Escape");
  await targetCaptureReview.waitFor({ state: "hidden" });
  await captureWorkspace(
    "Conversations",
    "conversations",
    () => page.getByRole("option", { name: /Review the Agent environment before release/ })
  );
  await page.getByRole("option", {
    name: /Review the Agent environment before release/
  }).click();
  await page.getByText("The Profile is saved and ready for a final Apply preview.").waitFor({
    state: "visible"
  });
  await capturePage(page, join(outputDir, "conversations-detail-920x620.png"));
  const conversationSort = page.getByRole("button", { name: /Sort conversations:/ });
  await conversationSort.click();
  await page.getByRole("menuitemradio", { name: "Largest" }).click();
  await page.locator(".conversation-date-group").waitFor({ state: "detached" });
  await capturePage(page, join(outputDir, "conversations-largest-920x620.png"));
  await captureRegion(
    page,
    page.locator(".conversation-list-pane"),
    join(outputDir, "conversations-list-region-920.png")
  );
  await conversationSort.click();
  await page.getByRole("menuitemradio", { name: "Recent" }).click();
  await page.locator(".conversation-date-group").first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("menu", { name: "Continue in" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "conversations-continue-menu-920x620.png"));
  await page.getByRole("menuitem", { name: "Trae CLI, Paste prompt" }).click();
  const continuationReview = page.getByRole("dialog", { name: "Review continuation" });
  await continuationReview.waitFor({ state: "visible" });
  await continuationReview.getByText("/work/agentenv-manager", { exact: true }).waitFor({
    state: "visible"
  });
  await capturePage(page, join(outputDir, "conversations-continue-review-920x620.png"));
  await page.keyboard.press("Escape");
  await continuationReview.waitFor({ state: "hidden" });
  await captureWorkspace(
    "Settings",
    "settings",
    () => page.getByRole("region", { name: "Settings", exact: true })
  );
  await capturePage(page, join(outputDir, "settings-general-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "settings-general-1180x728.png"));
  await setWindowSize(page, windowHandle, 1440, 900);
  await capturePage(page, join(outputDir, "settings-general-1440x900.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await page.getByRole("tab", { name: "Agents" }).click();
  const customFolders = page.locator("details.agent-path-settings").filter({
    has: page.getByText("Custom folders", { exact: true })
  });
  await customFolders.getByText("Custom folders", { exact: true }).click();
  await customFolders.scrollIntoViewIfNeeded();
  await capturePage(page, join(outputDir, "settings-custom-folders-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await customFolders.scrollIntoViewIfNeeded();
  await capturePage(page, join(outputDir, "settings-custom-folders-1180x728.png"));
  await customFolders.getByText("Custom folders", { exact: true }).click();
  await setWindowSize(page, windowHandle, 920, 620);
  await page.getByRole("tab", { name: "Skills" }).click();
  await capturePage(page, join(outputDir, "settings-controls-920x620.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "settings-controls-1180x728.png"));
  await setWindowSize(page, windowHandle, 1440, 900);
  await capturePage(page, join(outputDir, "settings-controls-1440x900.png"));
  await setWindowSize(page, windowHandle, 1180, 728);
  await page.getByRole("tab", { name: "Connections" }).click();
  await capturePage(page, join(outputDir, "settings-connections-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await capturePage(page, join(outputDir, "settings-connections-920x620.png"));
  await page.getByRole("button", { name: "Set up" }).click();
  await capturePage(page, join(outputDir, "settings-connections-setup-920x620.png"));
  const workspaceSyncSection = page.getByRole("region", { name: "Device Sync" });
  await workspaceSyncSection.getByLabel("Private Git repository").fill(workspaceSyncRemote);
  await workspaceSyncSection.getByLabel("Branch").fill("main");
  await workspaceSyncSection.getByRole("button", { name: "Connect repository" }).click();
  await workspaceSyncSection.getByText("Changes to publish").waitFor({
    state: "visible",
    timeout: 15_000
  });
  await capturePage(page, join(outputDir, "settings-sync-local-changes-920x620.png"));
  await workspaceSyncSection.getByRole("button", { name: "Publish" }).click();
  const workspaceSyncReview = page.getByRole("dialog", { name: "Review Device Sync changes" });
  await workspaceSyncReview.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "settings-sync-review-920x620.png"));
  await page.keyboard.press("Escape");
  await workspaceSyncReview.waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "Data" }).click();
  await capturePage(page, join(outputDir, "settings-data-920x620.png"));
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const backupManager = page.getByRole("dialog", { name: "Manage Backups" });
  await backupManager.waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "settings-backups-920x620.png"));
  await backupManager.getByRole("button", { name: /Preview backup/ }).first().click();
  await backupManager.getByText("Backup contents", { exact: true }).waitFor({
    state: "visible"
  });
  await capturePage(page, join(outputDir, "settings-backup-contents-920x620.png"));
  await backupManager.getByRole("button", { name: "Back" }).click();
  await backupManager.getByRole("button", { name: "Close" }).click();
  await setWindowSize(page, windowHandle, 1180, 728);
  await capturePage(page, join(outputDir, "settings-data-1180x728.png"));
  await setWindowSize(page, windowHandle, 1440, 900);
  await capturePage(page, join(outputDir, "settings-data-1440x900.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await page.getByRole("tab", { name: "General" }).click();
  await page.getByLabel("Interface language").selectOption("zh_CN");
  await page.getByRole("heading", { name: "设置" }).waitFor({ state: "visible" });
  await page.getByRole("status").filter({ hasText: "设置已保存" }).waitFor({
    state: "visible"
  });
  await page.reload();
  await page.getByRole("heading", { name: "Agents", exact: true }).waitFor({
    state: "visible"
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("heading", { name: "设置" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "settings-zh-cn-920x620.png"));
  await page.getByRole("button", { name: "技能", exact: true }).click();
  await page.getByRole("region", { name: "技能资源库", exact: true }).waitFor({
    state: "visible"
  });
  await capturePage(page, join(outputDir, "skills-zh-cn-920x620.png"));
  await page.getByRole("button", { name: "配置方案", exact: true }).click();
  await page.getByRole("region", { name: "配置方案", exact: true }).waitFor({
    state: "visible"
  });
  await waitForProfileTitle("Code Review");
  await capturePage(page, join(outputDir, "profiles-zh-cn-920x620.png"));
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("region", { name: "设置", exact: true }).waitFor({
    state: "visible"
  });
  await page.getByRole("tab", { name: "通用" }).click();
  await page.getByLabel("界面语言").selectOption("zh_TW");
  await page.getByRole("heading", { name: "設定" }).waitFor({ state: "visible" });
  await page.getByRole("status").filter({ hasText: "設定已儲存" }).waitFor({
    state: "visible"
  });
  await page.reload();
  await page.getByRole("heading", { name: "Agents", exact: true }).waitFor({
    state: "visible"
  });
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("heading", { name: "設定" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "settings-zh-tw-920x620.png"));
  await page.getByRole("button", { name: "技能", exact: true }).click();
  await page.getByRole("region", { name: "技能資源庫", exact: true }).waitFor({
    state: "visible"
  });
  await capturePage(page, join(outputDir, "skills-zh-tw-920x620.png"));
  await page.getByRole("button", { name: "設定檔", exact: true }).click();
  await page.getByRole("region", { name: "設定檔", exact: true }).waitFor({
    state: "visible"
  });
  await waitForProfileTitle("Code Review");
  await capturePage(page, join(outputDir, "profiles-zh-tw-920x620.png"));
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("tab", { name: "一般" }).click();
  await page.getByLabel("介面語言").selectOption("en");
  await page.getByRole("heading", { name: "Settings" }).waitFor({ state: "visible" });

  await setWindowSize(page, windowHandle, 920, 620);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  const collapsedWorkspaces = [
    ["Skills", "Skills", "sidebar-collapsed-skills-920x620.png"],
    ["Profiles", "Profiles", "sidebar-collapsed-profiles-920x620.png"],
    ["Workspaces", "Workspaces", "sidebar-collapsed-workspaces-920x620.png"],
    ["Conversations", "Conversations", "sidebar-collapsed-conversations-920x620.png"],
    ["Agents", "Agents", "sidebar-collapsed-agents-920x620.png"],
    ["Settings", "Settings", "sidebar-collapsed-settings-920x620.png"]
  ];
  for (const [buttonName, headingName, fileName] of collapsedWorkspaces) {
    await page.getByRole("button", { name: buttonName, exact: true }).click();
    await page.getByRole("heading", { name: headingName, exact: true }).waitFor({
      state: "visible"
    });
    await capturePage(page, join(outputDir, fileName));
  }
  await page.getByRole("button", { name: "Show Local Agents" }).click();
  await page.getByRole("menu", { name: "Local Agents" }).waitFor({ state: "visible" });
  await capturePage(page, join(outputDir, "sidebar-collapsed-agents-menu-920x620.png"));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Expand sidebar" }).click();

  await setWindowSize(page, windowHandle, 1536, 1024);
  await page.getByRole("button", { name: "Profiles" }).click();
  await selectCaptureProfile("Daily Coding");
  await waitForProfileTitle("Daily Coding");
  await page.getByRole("button", { name: "Select apply Agent" }).click();
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
  const startupFailureRoot = join(fixtureRoot, "startup-failure-data");
  await mkdir(startupFailureRoot, { recursive: true });
  await writeFile(
    join(startupFailureRoot, "agentenv-data.json"),
    '{"formatVersion":99}\n',
    "utf8"
  );
  const startupFailureApp = await electron.launch({
    executablePath: electronPath,
    args: [
      "--disable-gpu",
      "--force-device-scale-factor=1",
      `--user-data-dir=${join(fixtureRoot, "startup-failure-user-data")}`,
      join(projectRoot, "out", "main", "main.js")
    ],
    env: {
      ...process.env,
      AGENTENV_AUTOMATION: "1",
      AGENTENV_DATA_ROOT: startupFailureRoot,
      AGENTENV_HOME: homeDir,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
    }
  });
  try {
    const startupFailurePage = await startupFailureApp.firstWindow();
    const startupFailureWindow = await startupFailureApp.browserWindow(startupFailurePage);
    await setWindowSize(startupFailurePage, startupFailureWindow, 920, 620);
    await startupFailurePage
      .getByRole("heading", { name: "This data needs a newer AgentEnv Manager" })
      .waitFor({ state: "visible", timeout: 15_000 });
    await startupFailurePage.screenshot({
      path: join(outputDir, "startup-failure-920x620.png"),
      animations: "disabled"
    });
  } finally {
    await startupFailureApp.close();
  }
  await writeCaptureManifest();
} finally {
  await app?.close();
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log(outputDir);
