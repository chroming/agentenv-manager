import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron } from "playwright-core";
import { expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";

requireCurrentElectronBuild();
it("saves without shifting actions and tests only synthetic content on explicit request", async () => {
  const root = await mkdtemp(join(tmpdir(), "aem-service-test-"));
  const bodies: unknown[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push(JSON.parse(body));
    setTimeout(() => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }));
    }, 300);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const app = await electron.launch({ executablePath: electronPath as unknown as string,
    args: [`--user-data-dir=${join(root, "electron")}`, join(process.cwd(), "out/main/main.js")],
    env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: join(root, "data"),
      AGENTENV_HOME: join(root, "home"), AGENTENV_CACHE_ROOT: join(root, "cache"), AGENTENV_AUTOMATION_TARGET_PATH: join(root, "bin") } });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    await page.evaluate((endpoint) => window.agentEnv.saveSkillSummaryConfig({ endpoint, model: "fixture" }), `http://127.0.0.1:${port}/v1`);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "AI assistance", exact: true }).click();
    await page.locator('summary').filter({ hasText: 'AI service' }).click();
    for (const width of [920, 1180, 1440]) {
      await page.setViewportSize({ width, height: 728 });
      const save = page.getByRole("button", { name: "Save", exact: true });
      await save.scrollIntoViewIfNeeded();
      const before = await save.boundingBox();
      await save.click();
      await page.locator('.ai-service-feedback').filter({ hasText: 'Saved' }).waitFor();
      expect((await save.boundingBox())!.y).toBe(before!.y);
    }
    expect(bodies).toHaveLength(0);
    const test = page.getByRole("button", { name: "Test connection", exact: true });
    await test.click();
    expect(await test.getAttribute("aria-busy")).toBe("true");
    await page.getByText("AI service is available", { exact: true }).waitFor();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model: "fixture", max_tokens: 64, messages: [
      { role: "system", content: 'Return only this JSON object: {"ok":true}.' },
      { role: "user", content: "Connection test." }
    ] });
    await page.screenshot({ path: "/tmp/agentenv-ai-service-test.png" });
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
