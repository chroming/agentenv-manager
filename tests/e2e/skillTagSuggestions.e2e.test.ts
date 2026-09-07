import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";

requireCurrentElectronBuild();
let root = "";
let app: ElectronApplication | undefined;
let server: Server | undefined;
afterEach(async () => {
  if (app) await (await app.firstWindow()).screenshot({ path: "/tmp/agentenv-ai-tags-last.png" }).catch(() => undefined);
  await app?.close(); app = undefined;
  await new Promise<void>((resolve) => { if (server) server.close(() => resolve()); else resolve(); }); server = undefined;
  if (root) await rm(root, { recursive: true, force: true });
});

describe("AI tag suggestions desktop flow", () => {
  it("confirms before model calls, fits three languages and sizes, and saves only accepted metadata", async () => {
    root = await mkdtemp(join(tmpdir(), "aem-tags-electron-")); let calls = 0;
    server = createServer((request, response) => {
      calls += 1; request.resume(); response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ tags: [
        { tag: "Code review", reason: "Reviews changes before deployment." },
        { tag: "Testing", reason: "Checks test coverage and failures." }
      ] }) } }] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const source = join(root, "source"); await mkdir(source, { recursive: true });
    const text = "---\nname: review\ndescription: Review changes and test coverage\n---\nReview changes and test coverage.\n";
    await writeFile(join(source, "SKILL.md"), text);
    const secondSource = join(root, "tagged-source"); await mkdir(secondSource, { recursive: true });
    await writeFile(join(secondSource, "SKILL.md"), "---\nname: review-integration-workflows-with-long-library-labels\ndescription: A tagged Skill\n---\nReview integration workflows.\n");
    app = await electron.launch({ executablePath: electronPath as unknown as string,
      args: [`--user-data-dir=${join(root, "electron-data")}`, join(process.cwd(), "out/main/main.js")],
      env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: join(root, "data"), AGENTENV_HOME: join(root, "home"),
        AGENTENV_CACHE_ROOT: join(root, "cache"), AGENTENV_AUTOMATION_TARGET_PATH: join(root, "bin") }
    });
    const page = await app.firstWindow(); page.setDefaultTimeout(10_000);
    await page.getByRole("button", { name: "Skills", exact: true }).waitFor();
    await page.evaluate(async ({ source, secondSource }) => {
      await window.agentEnv.importSkillToLibrary({ sourcePath: source, id: "review" });
      await window.agentEnv.importSkillToLibrary({ sourcePath: secondSource, id: "already-tagged" });
      await window.agentEnv.setSkillTags({ id: "already-tagged", tags: ["Testing", "Manual", "Long integration workflows", "Deployment compatibility"] });
    }, { source, secondSource });
    const captureDir = "/tmp/agentenv-ai-tags-evidence"; await mkdir(captureDir, { recursive: true });
    for (const [index, locale] of (["en", "zh_CN", "zh_TW"] as const).entries()) {
      await page.evaluate((locale) => window.agentEnv.updateSettings({ locale }), locale); await page.reload();
      const english = locale === "en";
      await page.getByRole("button", { name: english ? "Skills" : "技能", exact: true }).click();
      for (const width of [920, 1180, 1440]) {
        await page.setViewportSize({ width, height: 728 });
        const row = page.locator('.library-table-row').filter({ hasText: 'review-integration-workflows-with-long-library-labels' }).first();
        await row.waitFor();
        const geometry = await row.evaluate((node) => {
          const name = node.querySelector('.library-skill-name-button')!.getBoundingClientRect();
          const tags = node.querySelector('.skill-tag-cell')!.getBoundingClientRect();
          const chips = Array.from(node.querySelectorAll('.skill-tag-cell > button')).map((chip) => chip.getBoundingClientRect());
          const tagButtons = Array.from(node.querySelectorAll('.skill-tag-cell > button'));
          const uniformTags = tagButtons.every((chip) => chip.getBoundingClientRect().height === chips[0].height && getComputedStyle(chip).borderRadius === getComputedStyle(tagButtons[0]).borderRadius);
          const headers = Array.from(node.closest('.library-table')!.querySelectorAll('.library-table__head > span'));
          const cells = ['.library-resource-cell', '.skill-tag-cell', '.library-source-cell', '.library-status-cell', '.library-actions-cell'];
          const columnsAlign = cells.every((selector, i) => Math.abs(node.querySelector(selector)!.getBoundingClientRect().x - headers[i].getBoundingClientRect().x) < 1);
          return { uniformTags, columnsAlign, chipsFit: chips.every((chip) => chip.right <= tags.right + 1), sameLine: Math.abs((name.top + name.bottom) / 2 - (tags.top + tags.bottom) / 2) < 2,
            separated: name.right <= tags.left, fits: node.scrollWidth <= node.clientWidth };
        });
        expect(geometry).toEqual({ uniformTags: true, columnsAlign: true, chipsFit: true, sameLine: true, separated: true, fits: true });
        await row.locator('.skill-tag-cell').getByRole('button', { name: english ? 'Tags' : locale === 'zh_CN' ? '标签' : '標籤', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Deployment compatibility', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.screenshot({ path: join(captureDir, `tag-list-${locale}-${width}.png`) });
      }
      if (english) {
        await page.getByRole("button", { name: "Updates (0)", exact: true }).click();
        await page.getByRole("button", { name: "More Skill actions", exact: true }).click();
        expect(await page.getByRole("menuitem", { name: "AI tags...", exact: true }).isDisabled()).toBe(true);
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "All (2)", exact: true }).click();
      }
      await page.getByRole("button", { name: english ? "More Skill actions" : "更多 Skill 操作", exact: true }).click();
      await page.getByRole("menuitem", { name: english ? "AI tags..." : locale === "zh_CN" ? "AI 打标签…" : "AI 標籤…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: english ? "AI tags" : locale === "zh_CN" ? "AI 打标签" : "AI 標籤", exact: true });
      const generateButtons = dialog.getByRole("button", { name: english ? "Suggest tags" : locale === "zh_CN" ? "建议标签" : "建議標籤", exact: true });
      await generateButtons.first().waitFor();
      expect(await dialog.locator(".skill-ai-tags-row").count()).toBe(2);
      expect(calls).toBe(index);
      await generateButtons.first().click();
      if (index === 0) {
        await dialog.getByRole("button", { name: "Configure AI service", exact: true }).click();
        await dialog.getByRole("textbox", { name: "API endpoint", exact: true }).fill(`http://127.0.0.1:${port}/v1/chat/completions`);
        await dialog.getByRole("textbox", { name: "Model", exact: true }).fill("mock-model");
        await page.setViewportSize({ width: 920, height: 620 });
        expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        await page.screenshot({ path: join(captureDir, "tags-configure-920.png") });
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        await dialog.getByRole("textbox", { name: "API endpoint", exact: true }).waitFor({ state: "hidden" });
        expect(calls).toBe(0);
        await generateButtons.first().click();
      }
      await dialog.getByRole("button", { name: english ? "Remove tag Testing" : locale === "zh_CN" ? "移除标签 Testing" : "移除標籤 Testing", exact: true }).waitFor();
      expect(calls).toBe(index + 1);
      await page.setViewportSize({ width: 1180, height: 728 });
      const originalBounds = await dialog.boundingBox();
      await dialog.getByRole("button", { name: english ? "Maximize preview" : locale === "zh_CN" ? "最大化预览" : "最大化預覽", exact: true }).click();
      const expandedBounds = await dialog.boundingBox();
      expect(expandedBounds!.width).toBeGreaterThan(originalBounds!.width);
      expect(expandedBounds!.height).toBeGreaterThan(originalBounds!.height);
      await dialog.getByRole("button", { name: english ? "Restore" : locale === "zh_CN" ? "恢复" : "恢復", exact: true }).click();
      for (const [width, height] of [[920, 620], [1180, 728], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        const issues = await dialog.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          return [...node.querySelectorAll<HTMLElement>("button, input, .skill-ai-tags-row-heading, .ui-dialog-footer")].filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || element.scrollWidth > element.clientWidth + 2);
          }).map((element) => element.className);
        });
        expect(issues).toEqual([]);
        await page.screenshot({ path: join(captureDir, `tags-${locale}-${width}.png`) });
      }
      await dialog.getByRole("button", { name: english ? "Close" : locale === "zh_CN" ? "关闭" : "關閉", exact: true }).click();
      const cached = await page.evaluate((locale) => window.agentEnv.prepareSkillTagSuggestions(["review"], locale), locale);
      expect(cached.items[0].cached?.tags).toHaveLength(2);
      expect(calls).toBe(index + 1);
    }
    // Existing edit-tags entry uses the same AI dialog, then accepts one suggestion.
    await page.evaluate(() => window.agentEnv.updateSettings({ locale: "en" })); await page.reload();
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page.getByRole("button", { name: "More actions for review", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit tags", exact: true }).click();
    await page.getByRole("button", { name: "AI suggestions", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "AI tags", exact: true });
    await dialog.getByRole("button", { name: "Remove tag Testing", exact: true }).click();
    await dialog.getByRole("button", { name: "Save tags (1)", exact: true }).click();
    await dialog.getByText("Saved", { exact: true }).waitFor();
    expect(calls).toBe(3);
    const entry = await page.evaluate(async () => (await window.agentEnv.listSkillLibrary()).find((skill) => skill.id === "review"));
    expect(entry?.tags).toEqual(["Code review"]);
    expect(entry?.aiTags).toEqual(["Code review"]);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() => window.agentEnv.setSkillTags({ id: "review", tags: ["Code review", "Manual"] }));
    await page.reload();
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page.getByRole("button", { name: "More actions for review", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit tags", exact: true }).click();
    await page.getByRole("region", { name: "Fixed tags", exact: true }).getByRole("button", { name: "Remove tag Manual" }).waitFor();
    await page.getByRole("region", { name: "AI-generated tags", exact: true }).getByRole("button", { name: "Remove tag Code review" }).waitFor();
    await page.setViewportSize({ width: 920, height: 620 });
    await page.screenshot({ path: join(captureDir, "tag-origins-920.png") });
    await page.getByRole("button", { name: "Make Code review fixed", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("dialog", { name: "Edit tags for review" }).waitFor({ state: "hidden" });
    const fixed = await page.evaluate(async () => (await window.agentEnv.listSkillLibrary()).find((skill) => skill.id === "review"));
    expect(fixed?.tags).toEqual(["Code review", "Manual"]);
    expect(fixed?.aiTags ?? []).toEqual([]);
    // A later generation can update AI tags but cannot undo an explicit fixed choice.
    await page.getByRole("button", { name: "More actions for review", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit tags", exact: true }).click();
    await page.getByRole("button", { name: "AI suggestions", exact: true }).click();
    const nextDialog = page.getByRole("dialog", { name: "AI tags", exact: true });
    await nextDialog.getByRole("button", { name: "Suggest tags", exact: true }).first().click();
    await nextDialog.getByRole("button", { name: "Remove tag Testing" }).waitFor();
    await nextDialog.getByRole("button", { name: "Save tags (1)", exact: true }).click();
    await nextDialog.getByText("Saved", { exact: true }).waitFor();
    const regenerated = await page.evaluate(async () => (await window.agentEnv.listSkillLibrary()).find((skill) => skill.id === "review"));
    expect(regenerated?.tags).toEqual(["Code review", "Manual", "Testing"]);
    expect(regenerated?.aiTags).toEqual(["Testing"]);
    expect(calls).toBe(4);
    expect(await readFile(join(source, "SKILL.md"), "utf8")).toBe(text);
    expect(await readFile(join(root, "data", "skills-library", "review", "SKILL.md"), "utf8")).toBe(text);
  }, 120_000);
});
