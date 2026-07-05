import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const opencodeDir = join(homeDir, ".config", "opencode");
  await mkdir(binDir, { recursive: true });
  await mkdir(opencodeDir, { recursive: true });

  for (const command of ["opencode", "codex", "claude"]) {
    const executable = join(binDir, command);
    await writeFile(executable, `#!/bin/sh\necho fake-${command}\n`, "utf8");
    await chmod(executable, 0o755);
  }

  await writeFile(join(opencodeDir, "AGENTS.md"), "# Existing OpenCode environment\n", "utf8");
  await writeJson(join(opencodeDir, "opencode.jsonc"), { shell: "/bin/zsh" });
  await Promise.all(profileFixtures.map((profile) => writeProfile(appDataRoot, profile)));
  await writeLibrary(appDataRoot);

  return { appDataRoot, binDir, homeDir };
};

const captureWindow = async (windowHandle, path) => {
  const encoded = await windowHandle.evaluate(async (browserWindow) =>
    (await browserWindow.capturePage()).toPNG().toString("base64")
  );
  await writeFile(path, Buffer.from(encoded, "base64"));
};

const setWindowSize = async (page, windowHandle, width, height) => {
  await windowHandle.evaluate((browserWindow, size) => {
    browserWindow.setContentSize(size.width, size.height);
    browserWindow.center();
    browserWindow.show();
    browserWindow.focus();
  }, { width, height });
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(150);
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
  await captureWindow(windowHandle, join(outputDir, fileName));
};

await mkdir(outputDir, { recursive: true });
if (suppliedReference && suppliedReference !== referencePath) {
  await copyFile(suppliedReference, referencePath);
}

const fixtureRoot = await mkdtemp(join(tmpdir(), "agentenv-profiles-capture-"));
let app;
try {
  const { appDataRoot, binDir, homeDir } = await prepareFixture(fixtureRoot);
  app = await electron.launch({
    executablePath: electronPath,
    args: ["--disable-gpu", join(projectRoot, "out", "main", "main.js")],
    env: {
      ...process.env,
      AGENTENV_AUTOMATION: "1",
      AGENTENV_DATA_ROOT: appDataRoot,
      AGENTENV_FAKE_HOME: join(fixtureRoot, "fake-home"),
      AGENTENV_HOME: homeDir,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
    }
  });

  const page = await app.firstWindow();
  const windowHandle = await app.browserWindow(page);
  await page.waitForLoadState("domcontentloaded");
  await setWindowSize(page, windowHandle, 1180, 728);
  await page.getByRole("region", { name: "Skill library", exact: true }).waitFor({ state: "visible" });
  await captureWindow(windowHandle, join(outputDir, "skills-1180x728.png"));
  await setWindowSize(page, windowHandle, 920, 620);
  await captureWindow(windowHandle, join(outputDir, "skills-920x620.png"));

  await setWindowSize(page, windowHandle, 1536, 1024);
  await page.getByRole("button", { name: "Profiles" }).click();
  await page.getByRole("button", { name: /Daily Coding/ }).click();
  await page.getByRole("heading", { name: "Daily Coding" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Select apply target" }).click();
  await page.waitForTimeout(250);
  await captureWindow(windowHandle, join(outputDir, "implementation-1536x1024.png"));

  await page.keyboard.press("Escape");
  await setWindowSize(page, windowHandle, 1180, 728);
  await captureWindow(windowHandle, join(outputDir, "implementation-1180x728.png"));

  const htmlPath = await writeComparisonPage();
  await captureComparison(page, windowHandle, htmlPath, "full", "comparison.png", 570);
  await captureComparison(page, windowHandle, htmlPath, "header", "header-comparison.png", 250);
  await captureComparison(page, windowHandle, htmlPath, "composer", "composer-comparison.png", 420);
} finally {
  await app?.close();
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log(outputDir);
