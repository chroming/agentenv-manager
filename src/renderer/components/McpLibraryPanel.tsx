import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { McpLibraryEntry, McpTransport, SaveMcpServerInput } from "../../shared/types";

interface McpLibraryPanelProps {
  mcpServers: McpLibraryEntry[];
  mcpUsage: Record<string, string[]>;
  onSave(input: SaveMcpServerInput): Promise<void>;
  onRemove(id: string): void;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

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
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState("");
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editorFirstFieldRef = useRef<HTMLInputElement>(null);
  const editorDialogRef = useRef<HTMLElement>(null);
  const wasEditorOpenRef = useRef(false);

  useEffect(() => {
    if (isEditorOpen) {
      wasEditorOpenRef.current = true;
      editorFirstFieldRef.current?.focus();
      return;
    }
    if (wasEditorOpenRef.current) {
      wasEditorOpenRef.current = false;
      editorTriggerRef.current?.focus();
    }
  }, [isEditorOpen]);

  useEffect(() => {
    if (!deleteCandidate && !isEditorOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isEditorOpen && isSaving) {
          return;
        }
        setDeleteCandidate(undefined);
        setIsEditorOpen(false);
        return;
      }
      if (event.key !== "Tab" || !isEditorOpen || !editorDialogRef.current) {
        return;
      }
      const focusableControls = Array.from(
        editorDialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      const firstControl = focusableControls[0];
      const lastControl = focusableControls.at(-1);
      if (!firstControl || !lastControl) {
        return;
      }
      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [deleteCandidate, isEditorOpen, isSaving]);

  const resetEditor = () => {
    setDraft(defaultDraft);
    setArgsText("");
    setEnvText("");
  };

  const createServer = () => {
    resetEditor();
    setIsEditorOpen(true);
  };

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
    setIsEditorOpen(true);
  };

  const saveDraft = async () => {
    if (!isDraftComplete || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await onSave({
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
      resetEditor();
      setIsEditorOpen(false);
    } catch {
      // App owns the global error message; retain this draft for retry.
    } finally {
      setIsSaving(false);
    }
  };

  const visibleServers = mcpServers.filter((server) =>
    `${server.name} ${server.id} ${server.transport}`.toLowerCase().includes(search.toLowerCase())
  );
  const isDraftComplete = Boolean(
    draft.id.trim() &&
      draft.name.trim() &&
      (draft.transport === "stdio" ? draft.command?.trim() : draft.url?.trim())
  );

  return (
    <section className="skill-library-panel" aria-label="MCP library">
      <div className="asset-editor-header">
        <div>
          <div className="section-title">MCP Library</div>
          <p className="muted">{mcpServers.length} shared servers</p>
        </div>
        <button
          className="primary-inline-action"
          type="button"
          onClick={(event) => {
            editorTriggerRef.current = event.currentTarget;
            createServer();
          }}
        >
          <Plus size={15} strokeWidth={2.3} />
          Add MCP server
        </button>
      </div>

      <label className="mcp-library-search">
        <Search size={15} strokeWidth={2.2} aria-hidden="true" />
        <input
          aria-label="Search MCP servers"
          placeholder="Search MCP servers..."
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </label>

      <section className="resource-section" aria-label="MCP servers">
        <div className="resource-list library-list">
          {visibleServers.map((server) => (
            <div
              aria-label={`MCP library item ${server.id}`}
              className="resource-row library-row"
              key={server.id}
              role="group"
            >
              <span className="resource-chip">MCP</span>
              <div className="resource-row__main">
                <span>{server.name}</span>
                <small className="mcp-row-endpoint">{server.transport} · {commandLabel(server)}</small>
                <small className="mcp-row-meta">
                  <span>
                    {Object.keys(server.env ?? {}).length > 0
                      ? `${Object.keys(server.env ?? {}).length} env variable${
                          Object.keys(server.env ?? {}).length === 1 ? "" : "s"
                        }`
                      : "No env variables"}
                  </span>
                  <span>
                    {(mcpUsage[server.id] ?? []).length > 0
                      ? `Used by ${(mcpUsage[server.id] ?? []).join(", ")}`
                      : "Not used by any profile"}
                  </span>
                </small>
              </div>
              <div className="resource-row__actions">
                <button
                  className="icon-action"
                  type="button"
                  aria-label={`Edit ${server.id}`}
                  onClick={(event) => {
                    editorTriggerRef.current = event.currentTarget;
                    editServer(server);
                  }}
                >
                  <Pencil size={15} strokeWidth={2.2} aria-hidden="true" />
                </button>
                <button
                  className="icon-action danger-icon-action"
                  type="button"
                  aria-label={`Remove ${server.id}`}
                  onClick={() => setDeleteCandidate(server)}
                >
                  <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          {visibleServers.length === 0 ? (
            <div className="inline-state inline-state--panel">
              <span>{mcpServers.length === 0 ? "No MCP servers yet" : "No matching MCP servers"}</span>
            </div>
          ) : null}
        </div>
      </section>

      {isEditorOpen ? (
        <div
          className="library-drawer-backdrop"
          onClick={() => {
            if (!isSaving) setIsEditorOpen(false);
          }}
        >
          <section
            ref={editorDialogRef}
            className="library-drawer mcp-editor-drawer"
            role="dialog"
            aria-label="MCP server editor"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="library-drawer__header">
              <div>
                <strong>{draft.id ? `Edit ${draft.name || draft.id}` : "Add MCP server"}</strong>
                <p className="muted">
                  Use environment variable names only. Secret values stay outside the library.
                </p>
              </div>
              <button
                className="icon-action"
                type="button"
                aria-label="Close MCP server editor"
                disabled={isSaving}
                onClick={() => setIsEditorOpen(false)}
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </header>
            <div className="mcp-server-form">
              <label>
                <span>ID</span>
                <input
                  ref={editorFirstFieldRef}
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
                      onChange={(event) =>
                        setDraft({ ...draft, command: event.currentTarget.value })
                      }
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
                disabled={!isDraftComplete || isSaving}
                onClick={() => { void saveDraft(); }}
              >
                {isSaving ? "Saving MCP server" : "Save MCP server"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

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
