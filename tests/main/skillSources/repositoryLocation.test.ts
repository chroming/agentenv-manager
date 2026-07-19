import { describe, expect, it } from "vitest";
import { parseRepositoryLocation } from "../../../src/main/skillSources/repositoryLocation";

describe("repository location", () => {
  it("turns a GitHub tree URL into a sanitized clone locator and scope", () => {
    expect(
      parseRepositoryLocation(
        "https://github.com/acme/skills/tree/main/skills/review?tab=readme#usage"
      )
    ).toEqual({
      kind: "https",
      transportLocator: "https://github.com/acme/skills.git",
      displayLocator: "https://github.com/acme/skills",
      cacheKeyLocator: "https://github.com/acme/skills",
      host: "github.com",
      webUrl: "https://github.com/acme/skills/tree/main/skills/review",
      inferredRef: "main",
      inferredDirectory: "skills/review"
    });
  });

  it("normalizes equivalent HTTPS clone locators for display and cache identity", () => {
    const withoutSuffix = parseRepositoryLocation("https://git.example.test/platform/skills/");
    const withSuffix = parseRepositoryLocation("https://GIT.example.test/platform/skills.git");

    expect(withoutSuffix).toMatchObject({
      kind: "https",
      transportLocator: "https://git.example.test/platform/skills",
      displayLocator: "https://git.example.test/platform/skills",
      cacheKeyLocator: "https://git.example.test/platform/skills",
      host: "git.example.test"
    });
    expect(withSuffix).toMatchObject({
      transportLocator: "https://git.example.test/platform/skills.git",
      displayLocator: "https://git.example.test/platform/skills",
      cacheKeyLocator: withoutSuffix.cacheKeyLocator
    });
  });

  it("accepts SSH and SCP-like clone locators without treating them as web links", () => {
    expect(parseRepositoryLocation("ssh://git@code.example.test:2222/team/skills.git")).toEqual({
      kind: "ssh",
      transportLocator: "ssh://git@code.example.test:2222/team/skills.git",
      displayLocator: "ssh://git@code.example.test:2222/team/skills",
      cacheKeyLocator: "ssh://git@code.example.test:2222/team/skills",
      host: "code.example.test"
    });
    expect(parseRepositoryLocation("git@code.example.test:team/skills.git")).toEqual({
      kind: "scp",
      transportLocator: "git@code.example.test:team/skills.git",
      displayLocator: "git@code.example.test:team/skills",
      cacheKeyLocator: "git@code.example.test:team/skills",
      host: "code.example.test"
    });
  });

  it("accepts explicit absolute and file URL repositories for isolated local use", () => {
    expect(parseRepositoryLocation("/tmp/agentenv remote/repository.git", { allowLocal: true }))
      .toMatchObject({
        kind: "file",
        transportLocator: "/tmp/agentenv remote/repository.git",
        displayLocator: "/tmp/agentenv remote/repository.git",
        cacheKeyLocator: "file:///tmp/agentenv%20remote/repository.git"
      });
    expect(parseRepositoryLocation("file:///tmp/agentenv%20remote/repository.git", { allowLocal: true }))
      .toMatchObject({
        kind: "file",
        transportLocator: "/tmp/agentenv remote/repository.git",
        cacheKeyLocator: "file:///tmp/agentenv%20remote/repository.git"
      });
    expect(() => parseRepositoryLocation("/tmp/repository.git")).toThrow(
      "Local repository paths are not enabled"
    );
  });

  it.each([
    "https://token@example.test/team/skills.git",
    "https://user:secret@example.test/team/skills.git",
    "ssh://git:secret@example.test/team/skills.git"
  ])("rejects embedded credentials in %s", (locator) => {
    expect(() => parseRepositoryLocation(locator)).toThrow("must not contain embedded credentials");
  });

  it.each([
    "-uhttps://example.test/team/skills.git",
    "ext::sh -c dangerous",
    "https://example.test/team/skills.git\n--upload-pack=bad",
    "git@example.test:-dangerous",
    "ftp://example.test/team/skills.git",
    "relative/repository.git"
  ])("rejects unsafe or unsupported locator %s", (locator) => {
    expect(() => parseRepositoryLocation(locator, { allowLocal: true })).toThrow();
  });

  it("does not infer vendor-specific tree semantics for unknown hosts", () => {
    const location = parseRepositoryLocation(
      "https://git.example.test/team/skills/tree/main/review"
    );
    expect(location).toMatchObject({
      transportLocator: "https://git.example.test/team/skills/tree/main/review"
    });
    expect(location).not.toHaveProperty("inferredRef");
    expect(location).not.toHaveProperty("inferredDirectory");
  });
});
