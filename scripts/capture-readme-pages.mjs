import { join } from "node:path";
import { rm } from "node:fs/promises";

export const captureReadmePages = async ({ page, windowHandle, outputDir, fixtureRoot, setWindowSize, capturePage }) => {
  page.setDefaultTimeout(15_000);
  const discovery = page.getByRole("dialog", { name: "Choose Agents" });
  await discovery.waitFor();
  await discovery.getByRole("button", { name: /^Enable \d+ Agents$/ }).click();
  const setup = page.getByRole("dialog", { name: "Agents enabled" });
  await setup.getByRole("button", { name: "Set up later" }).click();
  await setup.waitFor({ state: "hidden" });
  await rm(join(fixtureRoot, "home", ".agents", "skills", "shared-compatibility-reviewer"), { recursive: true, force: true });
  await page.reload();
  await setWindowSize(page, windowHandle, 1180, 728);
  const capture = async (name) => {
    const heading = { agents: "Agents", profiles: "Profiles", workspaces: "Workspaces", instructions: "Instructions", "skills-list": "Skills", "skills-by-source": "Skills", conversations: "Conversations" }[name];
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    await page.waitForTimeout(550);
    // Only synthetic fixture paths are shortened for public screenshots.
    await page.evaluate((root) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent?.includes(root)) node.textContent = node.textContent.replaceAll(root, "/Users/demo/AgentEnv");
      }
    }, fixtureRoot);
    await capturePage(page, join(outputDir, `${name}.png`));
  };
  const open = async (name) => {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
  };
  await page.locator(".target-list[aria-busy='false']").waitFor();
  await page.waitForTimeout(5000);
  await capture("agents");

  await open("Profiles");
  await page.getByRole("button", { name: "Choose Profile", exact: true }).click();
  await page.getByRole("dialog", { name: "Choose Profile", exact: true })
    .getByRole("option", { name: "Profile Daily Coding", exact: true }).click();
  await page.locator(".profile-switcher--hero .ui-object-switcher__trigger-title").filter({ hasText: "Daily Coding" }).waitFor();
  const skills = page.locator('[data-profile-composer-id="skills"]').getByRole("button", { name: "Skills", exact: true });
  if (await skills.getAttribute("aria-expanded") !== "true") await skills.click();
  await capture("profiles");

  await open("Workspaces");
  await page.getByRole("heading", { name: "Release Console", exact: true }).waitFor();
  await page.getByRole("button", { name: "Expand Skills", exact: true }).click();
  await capture("workspaces");

  await open("Instructions");
  await capture("instructions");

  await open("Skills");
  await capture("skills-list");
  await page.getByRole("tab", { name: "By source", exact: true }).click();
  await page.waitForTimeout(1500);
  const source = page.locator(".skill-source-group").first();
  await source.waitFor().catch(async (error) => {
    console.error(await page.locator("body").innerText());
    throw error;
  });
  await page.getByRole("button", { name: "Expand source", exact: true }).first().click();
  await capture("skills-by-source");

  await open("Conversations");
  await page.getByRole("option", { name: /Review the Agent environment before release/ }).click();
  await page.getByText("The Profile is saved and ready for a final Apply preview.").waitFor();
  await capture("conversations");
};
