import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { createGitTestRepository } from "../main/skillSources/gitTestRepository";

let root = "";
let app: ElectronApplication | undefined;

const exists = async (path: string) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("Repository Skill source", () => {
  it("imports selected skills and updates only when the selected subtree changes", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-repository-e2e-"));
    const appDataRoot = join(root, "app-data");
    const homeDir = join(root, "home");
    const cacheRoot = join(root, "cache");
    const repository = await createGitTestRepository(root, {
      "README.md": "Initial repository notes.\n",
      "skills/engineering/api-design/SKILL.md":
        "---\nname: API Design Internal\ndescription: Internal API design workflow.\nversion: 1.0.0\n---\n# API Design\n",
      "skills/engineering/release-check/SKILL.md":
        "---\nname: Release Check Internal\ndescription: Internal release checks.\nversion: 1.0.0\n---\n# Release Check\n"
    });

    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(process.cwd(), "out", "main", "main.js")],
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_DATA_ROOT: appDataRoot,
        AGENTENV_HOME: homeDir,
        AGENTENV_FAKE_HOME: join(root, "fake-home"),
        AGENTENV_CACHE_ROOT: cacheRoot,
        PATH: process.env.PATH ?? `/usr/bin${delimiter}/bin`
      }
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 920, height: 620 });
    await page.getByRole("heading", { name: "Skills" }).waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Import skills" }).click();
    const dialog = page.getByRole("dialog", { name: "Import skills" });
    await dialog.getByRole("tab", { name: "Repository" }).click();
    await dialog.getByLabel("Repository address").fill(repository.remoteDir);
    await dialog.getByText("Advanced", { exact: true }).click();
    await dialog.getByLabel("Repository directory").fill("skills/engineering");
    await dialog.getByRole("button", { name: "Scan", exact: true }).click();

    const apiDesign = dialog.getByRole("checkbox", { name: "Select API Design Internal" });
    const releaseCheck = dialog.getByRole("checkbox", { name: "Select Release Check Internal" });
    await apiDesign.waitFor({ state: "visible" });
    expect(await apiDesign.isChecked()).toBe(true);
    expect(await releaseCheck.isChecked()).toBe(true);
    expect(await dialog.getByRole("checkbox", { name: "Select all discovered skills" }).isChecked())
      .toBe(true);
    await releaseCheck.uncheck();
    await dialog.getByRole("button", { name: "Import 1" }).click();
    await dialog.getByText("All 1 skills imported", { exact: true }).waitFor({ state: "visible" });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    const librarySkill = join(appDataRoot, "skills-library", "api-design-internal");
    expect(await exists(join(librarySkill, "SKILL.md"))).toBe(true);
    expect(await exists(join(appDataRoot, "skills-library", "release-check-internal"))).toBe(false);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);

    await page.getByRole("tab", { name: "By source" }).click();
    expect(await page.getByRole("tab", { name: /^All / }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Refresh skills" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Refresh sources" }).count()).toBe(1);
    const sourceGroup = page.locator(".skill-source-group");
    await expect.poll(() => sourceGroup.count()).toBe(1);
    await sourceGroup.getByRole("button", { name: "Expand source" }).click();
    await sourceGroup.getByRole("button", { name: "Add", exact: true }).click();
    const releaseLibrarySkill = join(appDataRoot, "skills-library", "release-check-internal");
    await expect.poll(() => exists(join(releaseLibrarySkill, "SKILL.md"))).toBe(true);
    await expect.poll(() => sourceGroup.getByText("New", { exact: true }).count()).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.getByRole("tab", { name: "Skill list" }).click();

    const row = page.getByRole("group", { name: "Library item api-design-internal" });
    await repository.write("README.md", "Unrelated repository notes changed.\n");
    await repository.commit("unrelated change");
    await page.getByRole("button", { name: "Check updates" }).click();
    await page.getByText("All tracked skills are up to date", { exact: true })
      .waitFor({ state: "visible" });
    expect(await row.getByRole("button", { name: "Review update api-design-internal" }).count())
      .toBe(0);

    await repository.write(
      "skills/engineering/api-design/SKILL.md",
      "---\nname: API Design Internal\ndescription: Updated internal API design workflow.\nversion: 1.1.0\n---\n# API Design\n\nReview compatibility.\n"
    );
    await repository.commit("update api design skill");
    await page.getByRole("button", { name: "Check updates" }).click();
    const updateButton = row.getByRole("button", { name: "Review update api-design-internal" });
    await updateButton.waitFor({ state: "visible" });
    await updateButton.click();

    const preview = page.getByRole("dialog", { name: "Update preview for api-design-internal" });
    await preview.waitFor({ state: "visible" });
    await expect.poll(() => preview.textContent()).toContain("SKILL.md");
    await expect.poll(() => readFile(join(librarySkill, "SKILL.md"), "utf8"))
      .not.toContain("Review compatibility");
    await preview.getByRole("button", { name: "Apply update api-design-internal" }).click();
    await preview.waitFor({ state: "hidden" });
    await page.getByText(
      "Updated api-design-internal · All tracked skills are up to date",
      { exact: true }
    ).waitFor({ state: "visible" });
    await expect(readFile(join(librarySkill, "SKILL.md"), "utf8"))
      .resolves.toContain("Review compatibility");
    const backupRoot = join(appDataRoot, "backups", "skill-cleanup");
    await expect.poll(async () => (await readdir(backupRoot)).length).toBeGreaterThan(0);
    const metadata = JSON.parse(
      await readFile(join(librarySkill, ".agentenv-skill.json"), "utf8")
    ) as { sourceType?: string; remoteRef?: string; remotePath?: string };
    expect(metadata).toMatchObject({
      sourceType: "git",
      remoteRef: "main",
      remotePath: "skills/engineering/api-design"
    });

    await rm(
      join(repository.workDir, "skills", "engineering", "release-check"),
      { recursive: true, force: true }
    );
    await repository.commit("remove release check skill");
    await page.getByRole("tab", { name: "By source" }).click();
    await sourceGroup.getByRole("button", { name: "Check", exact: true }).click();
    await sourceGroup.getByText("Removed upstream", { exact: true }).waitFor({ state: "visible" });
    expect(await sourceGroup.getByRole("button", { name: "Delete", exact: true }).count()).toBe(1);
  }, 90_000);
});
