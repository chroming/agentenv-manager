import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createElectronViteConfig,
  resolvePostHogBuildEnvironment
} from "../../electron.vite.config";

describe("electron vite config", () => {
  it("polyfills global for browser-side TOML parsing in dev and production", () => {
    const config = createElectronViteConfig("production", {});
    const packageVersion = (JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")
    ) as { version: string }).version;
    expect(config.main?.define?.__AGENTENV_APP_VERSION__)
      .toBe(JSON.stringify(packageVersion));
    expect(config.renderer?.define).toMatchObject({ global: "globalThis" });
    expect(config.renderer?.optimizeDeps?.esbuildOptions?.define).toMatchObject({
      global: "globalThis"
    });
  });

  it("uses local build values while allowing CI environment variables to override them", () => {
    expect(resolvePostHogBuildEnvironment({
      AGENTENV_POSTHOG_PROJECT_TOKEN: "local-token"
    })).toEqual({
      host: "https://us.i.posthog.com",
      projectToken: "local-token"
    });
    expect(resolvePostHogBuildEnvironment({
      AGENTENV_POSTHOG_HOST: "https://eu.i.posthog.com",
      AGENTENV_POSTHOG_PROJECT_TOKEN: "ci-token"
    })).toEqual({
      host: "https://eu.i.posthog.com",
      projectToken: "ci-token"
    });
  });
});
