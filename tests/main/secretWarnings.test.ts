import { describe, expect, it } from "vitest";
import {
  findSecretWarnings,
  redactSensitiveValues
} from "../../src/main/secretWarnings";

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

  it("detects JSONC and YAML literal credentials", () => {
    expect(
      findSecretWarnings('{ "auth": { "token": "github_pat_12345678901234567890" } }')
    ).toContain("Possible literal secret in profile content: token");
    expect(findSecretWarnings("credentials:\n  password: local-value\n")).toContain(
      "Possible literal secret in profile content: password"
    );
    expect(findSecretWarnings('{ "clientSecret": "local-secret" }')).toContain(
      "Possible literal secret in profile content: clientSecret"
    );
    expect(findSecretWarnings('{ "refreshToken": "local-token" }')).toContain(
      "Possible literal secret in profile content: refreshToken"
    );
  });

  it("accepts explicit environment references across formats", () => {
    expect(findSecretWarnings('{ "api_key": "${SERVICE_API_KEY}" }')).toEqual([]);
    expect(findSecretWarnings("password: SERVICE_PASSWORD\n")).toEqual([]);
    expect(findSecretWarnings("secret_key_ref: local-secret\n")).toEqual([]);
    expect(findSecretWarnings('{ "secretKeyRef": "local-secret" }')).toEqual([]);
  });

  it("redacts structured values, bearer tokens, and private keys", () => {
    const content = [
      '{ "api_key": "sk-1234567890abcdefghijklmnop" }',
      "password: local-value",
      "Authorization = 'Bearer abcdefghijklmnopqrstuvwxyz123456'",
      "-----BEGIN PRIVATE KEY-----",
      "private-key-material",
      "-----END PRIVATE KEY-----"
    ].join("\n");

    const redacted = redactSensitiveValues(content);
    expect(redacted).not.toContain("sk-1234567890abcdefghijklmnop");
    expect(redacted).not.toContain("local-value");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(redacted).not.toContain("private-key-material");
    expect(redacted.match(/<redacted>/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
