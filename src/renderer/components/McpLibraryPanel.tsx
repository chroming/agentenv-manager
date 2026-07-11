import { type RefObject, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { McpLibraryEntry, McpTransport, SaveMcpServerInput } from "../../shared/types";
import {
  type McpLibraryViewState,
  updateMcpLibraryControls
} from "../libraryViewState";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip } from "./OverflowTooltip";

interface McpLibraryPanelProps {
  mcpServers: McpLibraryEntry[];
  mcpUsage: Record<string, string[]>;
  viewState: McpLibraryViewState;
  onViewStateChange(next: McpLibraryViewState): void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  onSave(input: SaveMcpServerInput): Promise<void>;
  onRemove(id: string): void;
  onReviewUsage(id: string): void;
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

const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const parseEnvText = (value: string) => {
  const names = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    aliasName: names.find((name) => name.includes("=")),
    duplicateName: names.find((name, index) => names.indexOf(name) !== index),
    env: Object.fromEntries(names.map((name) => [name, name])),
    invalidName: names.find((name) => !ENV_NAME_PATTERN.test(name))
  };
};

const remoteUrlError = (value: string) => {
  if (!value.trim()) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? undefined
      : "Use an http or https URL.";
  } catch {
    return "Enter a valid MCP server URL.";
  }
};

export const McpLibraryPanel = ({
  mcpServers,
  mcpUsage,
  viewState,
  onViewStateChange,
  searchInputRef,
  onSave,
  onRemove,
  onReviewUsage
}: McpLibraryPanelProps) => {
  const [draft, setDraft] = useState<SaveMcpServerInput>(defaultDraft);
  const [editingId, setEditingId] = useState<string>();
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<McpLibraryEntry>();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { search } = viewState;
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editorIdFieldRef = useRef<HTMLInputElement>(null);
  const editorNameFieldRef = useRef<HTMLInputElement>(null);
  const editorDialogRef = useRef<HTMLElement>(null);
  const wasEditorOpenRef = useRef(false);
  const deleteDialogRef = useRef<HTMLElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLElement>(null);

  useModalDialog({
    open: Boolean(deleteCandidate),
    dialogRef: deleteDialogRef,
    initialFocusRef: deleteCancelRef,
    fallbackFocusRef: deleteTriggerRef,
    onDismiss: () => setDeleteCandidate(undefined)
  });

  useEffect(() => {
    if (isEditorOpen) {
      wasEditorOpenRef.current = true;
      (editingId ? editorNameFieldRef.current : editorIdFieldRef.current)?.focus();
      return;
    }
    if (wasEditorOpenRef.current) {
      wasEditorOpenRef.current = false;
      editorTriggerRef.current?.focus();
    }
  }, [editingId, isEditorOpen]);

  useEffect(() => {
    if (!isEditorOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isEditorOpen && isSaving) {
          return;
        }
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
  }, [isEditorOpen, isSaving]);

  const resetEditor = () => {
    setDraft(defaultDraft);
    setEditingId(undefined);
    setArgsText("");
    setEnvText("");
  };

  const createServer = () => {
    resetEditor();
    setIsEditorOpen(true);
  };

  const editServer = (server: McpLibraryEntry) => {
    setEditingId(server.id);
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
        .map(([key, sourceName]) => (key === sourceName ? key : `${key}=${sourceName}`))
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
        ...(editingId ? { existingId: editingId } : {}),
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
        env: draft.transport === "stdio" ? parsedEnv.env : {}
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
  const parsedEnv = parseEnvText(envText);
  const normalizedId = draft.id.trim();
  const idError = !normalizedId
    ? undefined
    : !SAFE_ID_PATTERN.test(normalizedId)
      ? "Use letters, numbers, hyphens, or underscores; start with a letter or number."
      : !editingId && mcpServers.some((server) => server.id === normalizedId)
        ? "This ID already exists. Choose a unique ID."
        : undefined;
  const envError = parsedEnv.aliasName
    ? "Environment aliases are not portable. Use one matching variable name per line."
    : parsedEnv.invalidName
      ? `${parsedEnv.invalidName} is not a valid environment variable name.`
    : parsedEnv.duplicateName
      ? `${parsedEnv.duplicateName} is listed more than once.`
      : undefined;
  const urlError = draft.transport === "stdio" ? undefined : remoteUrlError(draft.url ?? "");
  const isDraftComplete = Boolean(
    draft.id.trim() &&
      draft.name.trim() &&
      !idError &&
      !envError &&
      !urlError &&
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
          ref={searchInputRef}
          aria-label="Search MCP servers"
          placeholder="Search MCP servers..."
          value={search}
          onChange={(event) =>
            onViewStateChange(
              updateMcpLibraryControls(viewState, { search: event.currentTarget.value })
            )
          }
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
                <OverflowTooltip
                  ariaLabel={`Full MCP name ${server.id}`}
                  className="mcp-row-name"
                  text={server.name}
                />
                <small>
                  <OverflowTooltip
                    ariaLabel={`Full MCP endpoint ${server.id}`}
                    className="mcp-row-endpoint"
                    text={`${server.transport} · ${commandLabel(server)}`}
                    tooltipClassName="library-source-tooltip"
                  />
                </small>
                <small className="mcp-row-meta">
                  <OverflowTooltip
                    ariaLabel={`Environment summary for ${server.id}`}
                    className="mcp-row-meta-item"
                    text={Object.keys(server.env ?? {}).length > 0
                      ? `${Object.keys(server.env ?? {}).length} env variable${
                          Object.keys(server.env ?? {}).length === 1 ? "" : "s"
                        }`
                      : "No env variables"}
                  />
                  <OverflowTooltip
                    ariaLabel={`Full MCP usage ${server.id}`}
                    className="mcp-row-meta-item"
                    text={(mcpUsage[server.id] ?? []).length > 0
                      ? `Used by ${(mcpUsage[server.id] ?? []).join(", ")}`
                      : "Not used by any profile"}
                  />
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
                  onClick={(event) => {
                    deleteTriggerRef.current = event.currentTarget;
                    setDeleteCandidate(server);
                  }}
                >
                  <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          {visibleServers.length === 0 ? (
            <div className="inline-state inline-state--panel library-empty-state">
              <span>{mcpServers.length === 0 ? "No MCP servers yet" : "No matching MCP servers"}</span>
              {mcpServers.length === 0 ? (
                <button
                  className="primary-inline-action"
                  type="button"
                  onClick={(event) => {
                    editorTriggerRef.current = event.currentTarget;
                    createServer();
                  }}
                >
                  <Plus size={15} strokeWidth={2.3} />
                  Add first MCP server
                </button>
              ) : null}
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
                <strong>{editingId ? `Edit ${draft.name || editingId}` : "Add MCP server"}</strong>
                <p className="muted">
                  {draft.transport === "stdio"
                    ? "Reference environment variables without storing secret values."
                    : "Remote credentials are configured in the Target after Apply."}
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
                  ref={editorIdFieldRef}
                  aria-label="MCP library id"
                  placeholder="context7"
                  value={draft.id}
                  disabled={Boolean(editingId)}
                  aria-describedby={idError ? "mcp-id-error" : editingId ? "mcp-id-help" : undefined}
                  onChange={(event) => setDraft({ ...draft, id: event.currentTarget.value })}
                />
                {editingId ? (
                  <small className="field-help" id="mcp-id-help">
                    ID is fixed because Profiles reference it.
                  </small>
                ) : idError ? (
                  <small className="field-error" id="mcp-id-error" role="alert">
                    {idError}
                  </small>
                ) : null}
              </label>
              <label>
                <span>Name</span>
                <input
                  ref={editorNameFieldRef}
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
                    aria-describedby={urlError ? "mcp-url-error" : undefined}
                    placeholder="https://example.com/mcp"
                    value={draft.url ?? ""}
                    onChange={(event) => setDraft({ ...draft, url: event.currentTarget.value })}
                  />
                  {urlError ? (
                    <small className="field-error" id="mcp-url-error" role="alert">
                      {urlError}
                    </small>
                  ) : null}
                </label>
              )}
              {draft.transport === "stdio" ? (
                <label className="mcp-server-form__wide">
                  <span>Environment variable references</span>
                  <textarea
                    aria-label="MCP env"
                    aria-describedby={envError ? "mcp-env-error" : "mcp-env-help"}
                    placeholder="GITHUB_TOKEN&#10;DOCS_TOKEN"
                    value={envText}
                    onChange={(event) => setEnvText(event.currentTarget.value)}
                  />
                  {envError ? (
                    <small className="field-error" id="mcp-env-error" role="alert">
                      {envError}
                    </small>
                  ) : (
                    <small className="field-help" id="mcp-env-help">
                      One variable name per line. Values stay in your shell environment.
                    </small>
                  )}
                </label>
              ) : null}
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
            ref={deleteDialogRef}
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
                  {(mcpUsage[deleteCandidate.id] ?? []).length > 0
                    ? `${deleteCandidate.name} is used by ${(mcpUsage[deleteCandidate.id] ?? []).join(", ")}. Remove it from those profiles first.`
                    : `Delete ${deleteCandidate.name} from the shared MCP library?`}
                </p>
              </div>
            </header>
            <footer className="preview-actions">
              <button
                ref={deleteCancelRef}
                className="secondary-action"
                type="button"
                onClick={() => setDeleteCandidate(undefined)}
              >
                Cancel
              </button>
              {(mcpUsage[deleteCandidate.id] ?? []).length > 0 ? (
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => {
                    onReviewUsage(deleteCandidate.id);
                    setDeleteCandidate(undefined);
                  }}
                >
                  Review profiles
                </button>
              ) : (
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
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
};
