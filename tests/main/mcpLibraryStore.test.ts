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

  it("blocks duplicate creation and keeps an existing server ID immutable", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-mcp-library-"));
    const store = createMcpLibraryStore(createPaths({ appDataRoot: root }));
    const definition = {
      id: "context7",
      name: "Context7",
      transport: "stdio" as const,
      command: "npx"
    };
    await store.saveServer(definition);

    await expect(store.saveServer(definition)).rejects.toThrow(
      "MCP server ID already exists: context7"
    );
    await expect(
      store.saveServer({ ...definition, existingId: "context7", name: "Context7 Docs" })
    ).resolves.toMatchObject({ id: "context7", name: "Context7 Docs" });
    await expect(
      store.saveServer({ ...definition, existingId: "context7", id: "context8" })
    ).rejects.toThrow("MCP server ID cannot be changed after creation");
  });

  it("stores only portable stdio environment references", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-mcp-library-"));
    const store = createMcpLibraryStore(createPaths({ appDataRoot: root }));

    await expect(
      store.saveServer({
        id: "remote-docs",
        name: "Remote Docs",
        transport: "http",
        url: "https://example.com/mcp",
        env: { TOKEN: "TOKEN" }
      })
    ).rejects.toThrow("Remote MCP credentials must be configured in the Target");
    await expect(
      store.saveServer({
        id: "local-docs",
        name: "Local Docs",
        transport: "stdio",
        command: "node",
        env: { TOKEN: "OTHER_TOKEN" }
      })
    ).rejects.toThrow("MCP environment references must use the same variable name");
    await expect(
      store.saveServer({
        id: "invalid-remote",
        name: "Invalid Remote",
        transport: "sse",
        url: "file:///tmp/mcp"
      })
    ).rejects.toThrow("remote MCP servers require an http or https URL");
  });
});
