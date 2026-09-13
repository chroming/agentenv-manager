import type { Page } from "playwright-core";

export async function setSkillCatalogStatus(page: Page, value: string) {
  const trigger = page.getByRole("button", { name: /^Filters/ });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await page.getByRole("combobox", { name: "Skill status filters" }).selectOption(value);
  await page.keyboard.press("Escape");
}

export async function openSkillCatalogAction(page: Page, name: string) {
  await page.getByRole("button", { name: "More Skill actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
