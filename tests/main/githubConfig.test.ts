import { describe, expect, it } from "vitest";
import {
  DEFAULT_GITHUB_OAUTH_CLIENT_ID,
  resolveGitHubOAuthClientId
} from "../../src/main/githubConfig";

describe("GitHub OAuth configuration", () => {
  it("uses the official client id by default", () => {
    expect(resolveGitHubOAuthClientId({})).toBe(DEFAULT_GITHUB_OAUTH_CLIENT_ID);
  });

  it("allows source builds to use their own OAuth app", () => {
    expect(resolveGitHubOAuthClientId({
      AGENTENV_GITHUB_OAUTH_CLIENT_ID: "fork-client-id"
    })).toBe("fork-client-id");
  });

  it("ignores an empty override", () => {
    expect(resolveGitHubOAuthClientId({
      AGENTENV_GITHUB_OAUTH_CLIENT_ID: "   "
    })).toBe(DEFAULT_GITHUB_OAUTH_CLIENT_ID);
  });
});
