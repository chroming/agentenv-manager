import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createMcpLibraryStore } from "../../src/main/mcpLibraryStore";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("MCP library store", () => {
  it("stores reusable MCP server definitions", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-mcp-library-"));
    const store = createMcpLibraryStore(createPaths({ appDataRoot: root }));

    await expect(store.listServers()).resolves.toEqual([]);

    await store.saveServer({
      id: "context7",
      name: "Context7",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: {
        CONTEXT7_API_KEY: "CONTEXT7_API_KEY"
      }
    });

    await expect(store.listServers()).resolves.toEqual([
      {
        id: "context7",
        name: "Context7",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        env: {
          CONTEXT7_API_KEY: "CONTEXT7_API_KEY"
        }
      }
    ]);
  });

  it("removes reusable MCP server definitions", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-mcp-library-"));
    const store = createMcpLibraryStore(createPaths({ appDataRoot: root }));
    await store.saveServer({
      id: "docs",
      name: "Docs",
      transport: "http",
      url: "https://example.com/mcp"
    });

    await store.removeServer("docs");

    await expect(store.listServers()).resolves.toEqual([]);
  });
});
