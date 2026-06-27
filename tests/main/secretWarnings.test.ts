import { describe, expect, it } from "vitest";
import { findSecretWarnings } from "../../src/main/secretWarnings";

describe("secret warnings", () => {
  it("warns for literal token-like values", () => {
    expect(
      findSecretWarnings('api_key = "sk-1234567890abcdefghijklmnop"\n')
    ).toContain("Possible literal secret in profile content: api_key");
  });

  it("warns for authorization headers", () => {
    expect(
      findSecretWarnings(
        'http_headers = { Authorization = "Bearer abcdefghijklmnopqrstuvwxyz123456" }\n'
      )
    ).toContain("Possible literal secret in profile content: Authorization");
  });

  it("does not warn for environment variable references", () => {
    expect(
      findSecretWarnings('bearer_token_env_var = "FIGMA_TOKEN"\n')
    ).toEqual([]);
  });
});
