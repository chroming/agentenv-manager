import { describe, expect, it, vi } from "vitest";
import { createGitHubSkillClient } from "../../src/main/githubSkillClient";

const responseFor = (value: unknown) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  headers: new Headers(),
  json: async () => value,
  text: async () => JSON.stringify(value)
});

describe("github skill client caching", () => {
  it("reuses successful responses only within the same authenticated account", async () => {
    let token = "first-account";
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      responseFor({ value: token })
    );
    const client = createGitHubSkillClient({
      fetchImpl,
      authTokenProvider: async () => token
    });

    await client.fetchJson("https://api.github.com/repos/example/skills");
    await client.fetchJson("https://api.github.com/repos/example/skills");
    token = "second-account";
    await client.fetchJson("https://api.github.com/repos/example/skills");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer first-account"
    });
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer second-account"
    });
  });

  it("performs a fresh request when an explicit check asks for refresh", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      responseFor({ request: fetchImpl.mock.calls.length })
    );
    const client = createGitHubSkillClient({ fetchImpl });
    const url = "https://api.github.com/repos/example/skills";

    await client.fetchJson(url);
    await client.fetchJson(url);
    await client.fetchJson(url, { refresh: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
