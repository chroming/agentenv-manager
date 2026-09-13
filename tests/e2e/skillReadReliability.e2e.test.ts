import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";
import { expectInViewport, expectNoHorizontalOverflow } from "./layoutAssertions";
import { openSkillCatalogAction } from "./skillCatalogControls";

requireCurrentElectronBuild();
let root = "";
let app: ElectronApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true });
});

it("opens with a damaged Skill, shows healthy siblings, and clears stale status after repair", async () => {
  root = await mkdtemp(join(tmpdir(), "aem-skill-read-desktop-"));
  const data = join(root, "data");
  for (const id of ["healthy", "damaged"]) {
    await mkdir(join(data, "skills-library", id), { recursive: true });
    await writeFile(join(data, "skills-library", id, "SKILL.md"), `---\nname: ${id}\ndescription: Example Skill\n---\n# Content\n`);
  }
  const metadata = join(data, "skills-library", "damaged", ".agentenv-skill.json");
  await writeFile(metadata, "{broken");
  await mkdir(join(root, "agent-bin"));
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [`--user-data-dir=${join(root, "electron")}`, join(process.cwd(), "out/main/main.js")],
    env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_AUTOMATION_TARGET_PATH: join(root, "agent-bin"),
      AGENTENV_HOME: join(root, "home"), AGENTENV_FAKE_HOME: join(root, "fake-home"),
      AGENTENV_DATA_ROOT: data, AGENTENV_CACHE_ROOT: join(root, "cache") }
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  const row = page.locator(".library-table-row").filter({ hasText: "damaged" });
  await row.getByText("Could not read", { exact: true }).waitFor({ timeout: 20_000 });
  expect(await page.locator(".library-table-row").count()).toBe(2);
  expect(await page.evaluate(async () => (await window.agentEnv.scanSkillInventory()).issues.length)).toBeGreaterThan(0);
  await mkdir("/tmp/aem-skill-read-evidence", { recursive: true });
  for (const width of [920, 1180, 1440]) {
    await page.setViewportSize({ width, height: 720 });
    await expectNoHorizontalOverflow(page);
    await expectInViewport(page, row);
    const status = await row.locator(".library-status-cell").boundingBox();
    const label = await row.getByText("Could not read", { exact: true }).boundingBox();
    expect(label && status && label.x + label.width <= status.x + status.width + 1).toBe(true);
    await page.screenshot({ path: `/tmp/aem-skill-read-evidence/library-${width}.png` });
  }
  expect(await readFile(metadata, "utf8")).toBe("{broken");
  await writeFile(metadata, "{}");
  await openSkillCatalogAction(page, "Refresh");
  await expect.poll(() => row.getByText("Could not read", { exact: true }).count()).toBe(0);
  expect(await page.evaluate(async () => (await window.agentEnv.listSkillLibrary()).every((entry) => !entry.readIssue))).toBe(true);
  for (const width of [920, 1180, 1440]) {
    await page.setViewportSize({ width, height: 720 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `/tmp/aem-skill-read-evidence/repaired-${width}.png` });
  }
  expect(errors).toEqual([]);
}, 45_000);
