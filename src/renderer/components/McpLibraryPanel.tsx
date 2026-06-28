import { useEffect, useState } from "react";
import type { McpLibraryEntry, McpTransport, SaveMcpServerInput } from "../../shared/types";

interface McpLibraryPanelProps {
  mcpServers: McpLibraryEntry[];
  mcpUsage: Record<string, string[]>;
  onSave(input: SaveMcpServerInput): void;
  onRemove(id: string): void;
}

const defaultDraft: SaveMcpServerInput = {
  id: "",
  name: "",
  transport: "stdio",
  command: "",
  args: [],
  url: "",
  env: {}
};

const commandLabel = (server: McpLibraryEntry) => {
  if (server.transport === "stdio") {
    return [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
  }
  return server.url ?? "";
};

const parseEnvText = (value: string) =>
  Object.fromEntries(
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const equalsIndex = line.indexOf("=");
        if (equalsIndex < 0) {
          return [line, line];
        }
        const key = line.slice(0, equalsIndex).trim();
        const envName = line.slice(equalsIndex + 1).trim();
        return [key, envName || key];
      })
      .filter(([key]) => key.length > 0)
  );

export const McpLibraryPanel = ({ mcpServers, mcpUsage, onSave, onRemove }: McpLibraryPanelProps) => {
  const [draft, setDraft] = useState<SaveMcpServerInput>(defaultDraft);
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<McpLibraryEntry>();

  useEffect(() => {
    if (!deleteCandidate) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeleteCandidate(undefined);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [deleteCandidate]);

  const editServer = (server: McpLibraryEntry) => {
    setDraft({
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args ?? [],
      url: server.url,
      env: server.env ?? {}
    });
    setArgsText((server.args ?? []).join("\n"));
    setEnvText(
      Object.entries(server.env ?? {})
        .map(([key, value]) => (key === value ? key : `${key}=${value}`))
        .join("\n")
    );
  };

  const saveDraft = () => {
    if (!draft.id.trim() || !draft.name.trim()) {
      return;
    }
    onSave({
      ...draft,
      id: draft.id.trim(),
      name: draft.name.trim(),
      command: draft.transport === "stdio" ? draft.command?.trim() || undefined : undefined,
      url: draft.transport === "stdio" ? undefined : draft.url?.trim() || undefined,
      args:
        draft.transport === "stdio"
          ? argsText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
          : [],
      env: parseEnvText(envText)
    });
    setDraft(defaultDraft);
    setArgsText("");
    setEnvText("");
  };

  return (
    <section className="skill-library-panel" aria-label="MCP library">
      <div className="asset-editor-header">
        <div>
          <div className="section-title">MCP Library</div>
          <p className="muted">Reusable MCP servers live once here, then profiles reference them.</p>
        </div>
      </div>

      <section className="resource-section" aria-label="MCP servers">
        <div>
          <div className="resource-heading">Servers</div>
          <p className="muted">
            {mcpServers.length === 0
              ? "No shared MCP servers yet."
              : `${mcpServers.length} shared MCP server${mcpServers.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="resource-list library-list">
          {mcpServers.map((server) => (
            <div
              aria-label={`MCP library item ${server.id}`}
              className="resource-row library-row"
              key={server.id}
              role="group"
            >
              <span className="resource-chip">MCP</span>
              <div className="resource-row__main">
                <span>{server.name}</span>
                <small>{server.transport}</small>
                <small>{commandLabel(server)}</small>
                <small>
                  {Object.keys(server.env ?? {}).length > 0
                    ? `${Object.keys(server.env ?? {}).length} env variable${
                        Object.keys(server.env ?? {}).length === 1 ? "" : "s"
                      }`
                    : "No env variables"}
                </small>
                <small>
                  {(mcpUsage[server.id] ?? []).length > 0
                    ? `Used by ${(mcpUsage[server.id] ?? []).join(", ")}`
                    : "Not used by any profile"}
                </small>
              </div>
              <div className="resource-row__actions">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => editServer(server)}
                >
                  Edit {server.id}
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => setDeleteCandidate(server)}
                >
                  Remove {server.id}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="resource-section library-import-panel" aria-label="MCP server editor">
        <div>
          <div className="resource-heading">Server Definition</div>
          <p className="muted">Use env variable names only; do not store secret values here.</p>
        </div>
        <div className="mcp-server-form">
          <label>
            <span>ID</span>
            <input
              aria-label="MCP library id"
              placeholder="context7"
              value={draft.id}
              onChange={(event) => setDraft({ ...draft, id: event.currentTarget.value })}
            />
          </label>
          <label>
            <span>Name</span>
            <input
              aria-label="MCP library name"
              placeholder="Context7"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
            />
          </label>
          <label>
            <span>Transport</span>
            <select
              aria-label="MCP transport"
              value={draft.transport}
              onChange={(event) =>
                setDraft({ ...draft, transport: event.currentTarget.value as McpTransport })
              }
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </select>
          </label>
          {draft.transport === "stdio" ? (
            <>
              <label>
                <span>Command</span>
                <input
                  aria-label="MCP command"
                  placeholder="npx"
                  value={draft.command ?? ""}
                  onChange={(event) => setDraft({ ...draft, command: event.currentTarget.value })}
                />
              </label>
              <label className="mcp-server-form__wide">
                <span>Args</span>
                <textarea
                  aria-label="MCP args"
                  placeholder="-y&#10;@upstash/context7-mcp"
                  value={argsText}
                  onChange={(event) => setArgsText(event.currentTarget.value)}
                />
              </label>
            </>
          ) : (
            <label className="mcp-server-form__wide">
              <span>URL</span>
              <input
                aria-label="MCP URL"
                placeholder="https://example.com/mcp"
                value={draft.url ?? ""}
                onChange={(event) => setDraft({ ...draft, url: event.currentTarget.value })}
              />
            </label>
          )}
          <label className="mcp-server-form__wide">
            <span>Environment variables</span>
            <textarea
              aria-label="MCP env"
              placeholder="GITHUB_TOKEN&#10;DOCS_TOKEN=DOCS_RUNTIME_TOKEN"
              value={envText}
              onChange={(event) => setEnvText(event.currentTarget.value)}
            />
          </label>
          <button
            className="primary-action library-import-action"
            type="button"
            disabled={!draft.id.trim() || !draft.name.trim()}
            onClick={saveDraft}
          >
            Save MCP server
          </button>
        </div>
      </section>

      {deleteCandidate ? (
        <div className="preview-modal-backdrop" onClick={() => setDeleteCandidate(undefined)}>
          <section
            className="profile-form-dialog profile-form-dialog--compact"
            role="dialog"
            aria-label="Delete MCP server"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">Delete MCP server</div>
                <p className="muted">
                  Delete {deleteCandidate.name} from the shared MCP library? Profile references are not changed.
                </p>
              </div>
            </header>
            <footer className="preview-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={() => setDeleteCandidate(undefined)}
              >
                Cancel
              </button>
              <button
                className="danger-action"
                type="button"
                onClick={() => {
                  onRemove(deleteCandidate.id);
                  setDeleteCandidate(undefined);
                }}
              >
                Delete server
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
};
