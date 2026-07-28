import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
      args: [
        `--user-data-dir=${join(root, "electron-user-data")}`,
        join(process.cwd(), "out", "main", "main.js")
      ],
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
    await page.getByRole("button", { name: "Skills", exact: true }).click();
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
    const selectAllGeometry = await dialog.locator(".github-select-all").evaluate((element) => {
      const box = element.getBoundingClientRect();
      const text = element.querySelector("span")!;
      return {
        height: Math.round(box.height),
        textHeight: Math.round(text.getBoundingClientRect().height),
        textScrollWidth: text.scrollWidth,
        textWidth: Math.round(text.getBoundingClientRect().width)
      };
    });
    expect(selectAllGeometry.height).toBeLessThanOrEqual(34);
    expect(selectAllGeometry.textHeight).toBeLessThanOrEqual(18);
    expect(selectAllGeometry.textScrollWidth).toBeLessThanOrEqual(selectAllGeometry.textWidth + 1);
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
    expect(await page.getByRole("tab", { name: /^Enabled / }).count()).toBe(0);
    expect(await page.getByRole("tab", { name: /^Monitored 1$/ }).count()).toBe(1);
    expect(await page.getByRole("tab", { name: /^Manual only 0$/ }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Refresh skills" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Refresh sources" }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Check for updates" }).count()).toBe(1);
    const sourceGroup = page.locator(".skill-source-group");
    await expect.poll(() => sourceGroup.count()).toBe(1);
    const checkSource = async () => {
      await sourceGroup.getByRole("button", { name: /Source actions for/ }).click();
      await page.getByRole("menuitem", { name: "Check source" }).click();
    };
    const expectSourceLaneGeometry = async (width: number, height: number) => {
      await page.setViewportSize({ width, height });
      const geometry = await page.locator(".skill-source-group-row").evaluate((row) => {
        const header = document.querySelector<HTMLElement>(".skill-source-table-head")!;
        const headerCells = Array.from(header.children) as HTMLElement[];
        const rowCells = [
          row.querySelector<HTMLElement>(".skill-source-counts"),
          row.querySelector<HTMLElement>(".skill-source-last-checked"),
          row.querySelector<HTMLElement>(".skill-source-status"),
          row.querySelector<HTMLElement>(".skill-source-more")
        ];
        return {
          documentWidth: document.documentElement.scrollWidth,
          headerLefts: headerCells.slice(1).map((cell) => cell.getBoundingClientRect().left),
          rowLefts: rowCells.map((cell) => cell!.getBoundingClientRect().left),
          rowRight: row.getBoundingClientRect().right,
          moreRight: rowCells[3]!.getBoundingClientRect().right,
          viewportWidth: document.documentElement.clientWidth
        };
      });
      expect(geometry.documentWidth).toBe(geometry.viewportWidth);
      geometry.rowLefts.forEach((left, index) => {
        expect(
          Math.abs(left - geometry.headerLefts[index]!),
          JSON.stringify(geometry)
        ).toBeLessThanOrEqual(1);
      });
      expect(Math.abs(geometry.moreRight - geometry.rowRight + 12)).toBeLessThanOrEqual(1);
    };
    await expectSourceLaneGeometry(1180, 760);
    await expectSourceLaneGeometry(920, 620);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const sourceFilterPanel = page.getByRole("group", { name: "Source filters" });
    expect(await sourceFilterPanel.evaluate((panel) => {
      const bounds = panel.getBoundingClientRect();
      const controlsInside = [...panel.querySelectorAll<HTMLElement>("select, button")]
        .every((control) => {
          const rect = control.getBoundingClientRect();
          return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 &&
            rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
        });
      return controlsInside && panel.scrollWidth <= panel.clientWidth;
    })).toBe(true);
    const sourceTypeFilter = page.getByRole("combobox", { name: "Source type filter" });
    await sourceTypeFilter.selectOption("local");
    await expect.poll(() => sourceGroup.count()).toBe(0);
    await sourceTypeFilter.selectOption("online");
    await expect.poll(() => sourceGroup.count()).toBe(1);
    await page.getByRole("combobox", { name: "Source result filter" }).selectOption("changes");
    await expect.poll(() => sourceGroup.count()).toBe(1);
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.getByRole("button", { name: /Filters/, exact: false }).click();
    await sourceGroup.getByRole("button", { name: "Expand source" }).click();
    const firstCandidate = sourceGroup.locator(".skill-source-candidate").first();
    expect(await firstCandidate.locator(".skill-source-candidate-field-label").allTextContents())
      .toEqual(["Upstream", "Library"]);
    expect(await firstCandidate.getByText("Upstream", { exact: true }).isVisible()).toBe(true);
    expect(await firstCandidate.getByText("Library", { exact: true }).isVisible()).toBe(true);
    await sourceGroup.getByRole("button", {
      name: "Ignore Release Check Internal for this source"
    }).click();
    await sourceGroup.getByText("Ignored", { exact: true }).waitFor({ state: "visible" });
    await expect.poll(() => sourceGroup.getByLabel("Source summary").textContent())
      .toContain("Changes 0");
    const ignoredRegistry = JSON.parse(
      await readFile(join(appDataRoot, "skill-sources.json"), "utf8")
    ) as { sources: Array<{ ignoredSubpaths?: string[] }> };
    expect(ignoredRegistry.sources[0]?.ignoredSubpaths).toEqual(["release-check"]);

    await sourceGroup.getByRole("button", { name: "Unignore", exact: true }).click();
    await sourceGroup.getByText("New", { exact: true }).waitFor({ state: "visible" });
    await expect.poll(() => sourceGroup.getByLabel("Source summary").textContent())
      .toContain("Changes 1");
    await expect.poll(async () => {
      const restoredRegistry = JSON.parse(
        await readFile(join(appDataRoot, "skill-sources.json"), "utf8")
      ) as { sources: Array<{ ignoredSubpaths?: string[] }> };
      return restoredRegistry.sources[0]?.ignoredSubpaths;
    }).toBeUndefined();

    await sourceGroup.getByRole("button", { name: "Add", exact: true }).click();
    const releaseLibrarySkill = join(appDataRoot, "skills-library", "release-check-internal");
    await expect.poll(() => exists(join(releaseLibrarySkill, "SKILL.md"))).toBe(true);
    await expect.poll(() => sourceGroup.getByText("New", { exact: true }).count()).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);

    const metadataPath = join(librarySkill, ".agentenv-skill.json");
    const staleMetadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    staleMetadata.remoteRevision = "stale-transport-revision";
    await writeFile(metadataPath, `${JSON.stringify(staleMetadata, null, 2)}\n`, "utf8");
    await checkSource();
    await sourceGroup.getByRole("button", { name: "Update all skills", exact: true })
      .waitFor({ state: "visible" });
    await sourceGroup.getByRole("button", { name: "Update api-design-internal" }).click();
    await page.getByText("api-design-internal source is current", { exact: true })
      .waitFor({ state: "visible" });
    await expect.poll(() =>
      sourceGroup.getByRole("button", { name: "Update all skills" }).count()
    ).toBe(0);
    const reconciledMetadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      remoteRevision?: string;
    };
    expect(reconciledMetadata.remoteRevision).not.toBe("stale-transport-revision");

    await page.getByRole("tab", { name: "Skill list" }).click();

    const row = page.getByRole("group", { name: "Library item api-design-internal" });
    await repository.write("README.md", "Unrelated repository notes changed.\n");
    await repository.commit("unrelated change");
    await page.getByRole("button", { name: "Check updates" }).click();
    await page.getByText("All tracked skills are up to date", { exact: true })
      .waitFor({ state: "visible" });
    expect(await row.getByRole("button", { name: "Update api-design-internal" }).count())
      .toBe(0);

    await repository.write(
      "skills/engineering/api-design/SKILL.md",
      "---\nname: API Design Internal\ndescription: Updated internal API design workflow.\nversion: 1.1.0\n---\n# API Design\n\nReview compatibility.\n"
    );
    await repository.commit("update api design skill");
    await page.getByRole("tab", { name: "By source" }).click();
    await checkSource();
    const reviewSourceUpdates = sourceGroup.getByRole("button", {
      name: "Update all skills",
      exact: true
    });
    await reviewSourceUpdates.waitFor({ state: "visible" });

    await page.getByRole("tab", { name: "Skill list" }).click();
    const updateButton = row.getByRole("button", { name: "Update api-design-internal" });
    await updateButton.waitFor({ state: "visible" });
    await page.getByRole("tab", { name: "By source" }).click();
    await reviewSourceUpdates.click();

    const preview = page.getByRole("dialog", { name: "Update all skills" });
    await preview.waitFor({ state: "visible" });
    await expect.poll(() => preview.textContent()).toContain("SKILL.md");
    await expect.poll(() => readFile(join(librarySkill, "SKILL.md"), "utf8"))
      .not.toContain("Review compatibility");
    await preview.getByRole("button", { name: "Update 1 skill" }).click();
    await preview
      .getByRole("status", { name: "API Design Internal: Done" })
      .waitFor({ state: "visible" });
    await preview.getByRole("button", { name: "Close" }).click();
    await page.getByText(
      "Updated 1 skill · All tracked skills are up to date",
      { exact: true }
    ).waitFor({ state: "visible" });
    await expect.poll(() =>
      sourceGroup.getByRole("button", { name: "Update all skills" }).count()
    ).toBe(0);
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
    await checkSource();
    await sourceGroup.getByText("Removed upstream", { exact: true }).waitFor({ state: "visible" });
    expect(await sourceGroup.getByRole("button", { name: "Delete", exact: true }).count()).toBe(1);
  }, 90_000);

  it("merges separately imported repository directories through an explicit preview", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-source-merge-e2e-"));
    const appDataRoot = join(root, "app-data");
    const homeDir = join(root, "home");
    const repository = await createGitTestRepository(root, {
      "skills/engineering/frontend/review/SKILL.md":
        "---\nname: Frontend Review\ndescription: Review frontend code.\n---\n# Frontend Review\n",
      "skills/engineering/backend/testing/SKILL.md":
        "---\nname: Backend Testing\ndescription: Test backend code.\n---\n# Backend Testing\n"
    });
    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [
        `--user-data-dir=${join(root, "electron-user-data")}`,
        join(process.cwd(), "out", "main", "main.js")
      ],
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_DATA_ROOT: appDataRoot,
        AGENTENV_HOME: homeDir,
        AGENTENV_FAKE_HOME: join(root, "fake-home"),
        AGENTENV_CACHE_ROOT: join(root, "cache"),
        PATH: process.env.PATH ?? `/usr/bin${delimiter}/bin`
      }
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 920, height: 620 });
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page.getByRole("heading", { name: "Skills" }).waitFor({ state: "visible" });

    const importDirectory = async (directory: string) => {
      await page.getByRole("button", { name: "Import skills" }).click();
      const dialog = page.getByRole("dialog", { name: "Import skills" });
      await dialog.getByRole("tab", { name: "Repository" }).click();
      await dialog.getByLabel("Repository address").fill(repository.remoteDir);
      await dialog.getByText("Advanced", { exact: true }).click();
      await dialog.getByLabel("Repository directory").fill(directory);
      await dialog.getByRole("button", { name: "Scan", exact: true }).click();
      const importButton = dialog.getByRole("button", { name: "Import 1" });
      await importButton.waitFor({ state: "visible" });
      await importButton.click();
      await dialog.getByText("All 1 skills imported", { exact: true }).waitFor({ state: "visible" });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    };

    await importDirectory("skills/engineering/frontend");
    await importDirectory("skills/engineering/backend");
    const reviewPath = join(appDataRoot, "skills-library", "frontend-review", "SKILL.md");
    const testingPath = join(appDataRoot, "skills-library", "backend-testing", "SKILL.md");
    const reviewContent = await readFile(reviewPath, "utf8");
    const testingContent = await readFile(testingPath, "utf8");

    await page.getByRole("tab", { name: "By source" }).click();
    await expect.poll(() => page.locator(".skill-source-group").count()).toBe(2);
    expect(await page.locator(".skill-source-list").getByRole("checkbox").count()).toBe(0);
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    const sourceChoices = page.locator(".skill-source-list").getByRole("checkbox");
    const selectionRails = page.locator(".skill-source-select");
    const firstChoice = await selectionRails.nth(0).boundingBox();
    const secondChoice = await selectionRails.nth(1).boundingBox();
    if (!firstChoice || !secondChoice) throw new Error("Source selection controls are not visible");
    await page.mouse.move(firstChoice.x + 1, firstChoice.y + firstChoice.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      secondChoice.x + 1,
      secondChoice.y + secondChoice.height / 2,
      { steps: 6 }
    );
    await page.mouse.up();
    await expect.poll(() => sourceChoices.nth(0).isChecked()).toBe(true);
    await expect.poll(() => sourceChoices.nth(1).isChecked()).toBe(true);
    await page.getByRole("button", { name: "Merge selected (2)", exact: true }).click();
    const mergeDialog = page.getByRole("dialog", { name: "Confirm source merge" });
    await expect.poll(() => mergeDialog.getByLabel("Merged source directory").inputValue())
      .toBe("skills/engineering");
    await expect.poll(() => mergeDialog.getByText("2", { exact: true }).count()).toBeGreaterThan(0);
    await mergeDialog.getByRole("button", { name: "Confirm merge" }).click();
    await mergeDialog.waitFor({ state: "hidden" });
    await expect.poll(() => page.locator(".skill-source-group").count()).toBe(1);

    await page.getByRole("button", { name: /Source actions for/ }).click();
    await page.getByRole("menuitem", { name: "Rename source" }).click();
    const renameDialog = page.getByRole("dialog", { name: "Rename source" });
    await renameDialog.getByLabel("Source name").fill("Engineering Skills");
    await renameDialog.getByRole("button", { name: "Save", exact: true }).click();
    await renameDialog.waitFor({ state: "hidden" });
    await page.getByText("Engineering Skills", { exact: true }).waitFor({ state: "visible" });
    const registry = JSON.parse(await readFile(join(appDataRoot, "skill-sources.json"), "utf8")) as {
      sources: Array<{ displayName?: string }>;
    };
    expect(registry.sources).toHaveLength(1);
    expect(registry.sources[0]?.displayName).toBe("Engineering Skills");
    await page.getByRole("button", { name: /Source actions for/ }).click();
    await page.getByRole("menuitem", { name: "Check source" }).click();
    await page.getByText("Engineering Skills", { exact: true }).waitFor({ state: "visible" });
    await page.reload();
    await page.getByRole("heading", { name: "Skills" }).waitFor({ state: "visible" });
    await page.getByRole("tab", { name: "By source" }).click();
    await page.getByText("Engineering Skills", { exact: true }).waitFor({ state: "visible" });

    for (const [id, expectedSubpath] of [
      ["frontend-review", "frontend/review"],
      ["backend-testing", "backend/testing"]
    ] as const) {
      const metadata = JSON.parse(await readFile(
        join(appDataRoot, "skills-library", id, ".agentenv-skill.json"),
        "utf8"
      )) as { sourceCollection?: { sourceId?: string; directory?: string; sourceSubpath?: string } };
      expect(metadata.sourceCollection).toMatchObject({
        sourceId: expect.stringMatching(/^source-/),
        directory: "skills/engineering",
        sourceSubpath: expectedSubpath
      });
    }
    await expect(readFile(reviewPath, "utf8")).resolves.toBe(reviewContent);
    await expect(readFile(testingPath, "utf8")).resolves.toBe(testingContent);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }, 90_000);
});
