import { describe, expect, it } from "vitest";
import config from "../../electron.vite.config";

describe("electron vite config", () => {
  it("polyfills global for browser-side TOML parsing in dev and production", () => {
    expect(config.renderer?.define).toMatchObject({ global: "globalThis" });
    expect(config.renderer?.optimizeDeps?.esbuildOptions?.define).toMatchObject({
      global: "globalThis"
    });
  });
});
