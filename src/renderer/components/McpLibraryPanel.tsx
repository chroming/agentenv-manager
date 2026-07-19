import { type RefObject, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Network, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { McpLibraryEntry, McpTransport, SaveMcpServerInput } from "../../shared/types";
import {
  type McpLibraryViewState,
  updateMcpLibraryControls
} from "../libraryViewState";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip } from "./OverflowTooltip";
import { useI18n } from "../i18n";
import { ResourceRow } from "./ui";

interface McpLibraryPanelProps {
  mcpServers: McpLibraryEntry[];
  mcpUsage: Record<string, string[]>;
  createRequest?: number;
  createTriggerRef?: RefObject<HTMLButtonElement | null>;
  viewState: McpLibraryViewState;
  onViewStateChange(next: McpLibraryViewState): void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  scrollOwnerRef?(node: HTMLElement | null): void;
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
  createRequest = 0,
  createTriggerRef,
  viewState,
  onViewStateChange,
  searchInputRef,
  scrollOwnerRef,
  onSave,
  onRemove,
  onReviewUsage
}: McpLibraryPanelProps) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SaveMcpServerInput>(defaultDraft);
  const [editingId, setEditingId] = useState<string>();
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<McpLibraryEntry>();
  const [openAction, setOpenAction] = useState<{
    id: string;
    left: number;
    top: number;
  }>();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { search } = viewState;
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousCreateRequestRef = useRef(createRequest);
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
    if (!openAction) {
      return undefined;
    }
    const dismissMenu = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpenAction(undefined);
        return;
      }
      if (!(event.target instanceof Element) || !event.target.closest(".mcp-row-action-menu")) {
        setOpenAction(undefined);
      }
    };
    document.addEventListener("mousedown", dismissMenu);
    document.addEventListener("keydown", dismissMenu);
    return () => {
      document.removeEventListener("mousedown", dismissMenu);
      document.removeEventListener("keydown", dismissMenu);
    };
  }, [openAction]);

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

  useEffect(() => {
    if (createRequest === previousCreateRequestRef.current) {
      return;
    }
    previousCreateRequestRef.current = createRequest;
    editorTriggerRef.current = createTriggerRef?.current ?? null;
    resetEditor();
    setIsEditorOpen(true);
  }, [createRequest, createTriggerRef]);

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
      ? t("Use letters, numbers, hyphens, or underscores; start with a letter or number.")
      : !editingId && mcpServers.some((server) => server.id === normalizedId)
        ? t("This ID already exists. Choose a unique ID.")
        : undefined;
  const envError = parsedEnv.aliasName
    ? t("Environment aliases are not portable. Use one matching variable name per line.")
    : parsedEnv.invalidName
      ? t("{{name}} is not a valid environment variable name.", { name: parsedEnv.invalidName })
    : parsedEnv.duplicateName
      ? t("{{name}} is listed more than once.", { name: parsedEnv.duplicateName })
      : undefined;
  const rawUrlError = draft.transport === "stdio" ? undefined : remoteUrlError(draft.url ?? "");
  const urlError = rawUrlError ? t(rawUrlError) : undefined;
  const isDraftComplete = Boolean(
    draft.id.trim() &&
      draft.name.trim() &&
      !idError &&
      !envError &&
      !urlError &&
      (draft.transport === "stdio" ? draft.command?.trim() : draft.url?.trim())
  );

  return (
    <section className="skill-library-panel skill-library-panel--mcp ui-surface-frame" aria-label={t("MCP library")}>
      <div className="mcp-library-toolbar">
        <label className="mcp-library-search ui-composite-field">
          <Search size={15} strokeWidth={2.2} aria-hidden="true" />
          <input
            ref={searchInputRef}
            aria-label={t("Search MCPs")}
            placeholder={t("Search MCPs...")}
            value={search}
            onChange={(event) =>
              onViewStateChange(
                updateMcpLibraryControls(viewState, { search: event.currentTarget.value })
              )
            }
          />
        </label>
        <span className="mcp-library-count">
          {t(mcpServers.length === 1 ? "{{count}} MCP" : "{{count}} MCPs", {
            count: mcpServers.length
          })}
        </span>
      </div>

      <section
        className="resource-section"
        aria-label={t("MCPs")}
        ref={scrollOwnerRef}
      >
        {visibleServers.length > 0 ? (
          <div className="mcp-list-header" aria-hidden="true">
            <span>{t("MCP")}</span>
            <span>{t("Environment")}</span>
            <span>{t("Profiles")}</span>
            <span>{t("Actions")}</span>
          </div>
        ) : null}
        <div className="resource-list library-list">
          {visibleServers.map((server) => (
            <ResourceRow
              aria-label={t("MCP library item {{id}}", { id: server.id })}
              className="resource-row library-row mcp-library-row"
              key={server.id}
              role="group"
              icon={(
                <span className="mcp-row-icon">
                  <Network size={18} strokeWidth={2.1} />
                </span>
              )}
              title={(
                <OverflowTooltip
                  ariaLabel={t("Full MCP name {{id}}", { id: server.id })}
                  className="mcp-row-name"
                  text={server.name}
                />
              )}
              description={(
                <OverflowTooltip
                  ariaLabel={t("Full MCP endpoint {{id}}", { id: server.id })}
                  className="mcp-row-endpoint"
                  text={`${server.transport} · ${commandLabel(server)}`}
                  tooltipClassName="library-source-tooltip"
                />
              )}
              metadata={(
                <OverflowTooltip
                  ariaLabel={t("Environment summary for {{id}}", { id: server.id })}
                  className="mcp-row-meta-item"
                  text={Object.keys(server.env ?? {}).length > 0
                    ? t(
                        Object.keys(server.env ?? {}).length === 1
                          ? "{{count}} env variable"
                          : "{{count}} env variables",
                        { count: Object.keys(server.env ?? {}).length }
                      )
                    : t("No env variables")}
                />
              )}
              state={(
                <OverflowTooltip
                  ariaLabel={t("Full MCP usage {{id}}", { id: server.id })}
                  className="mcp-row-usage"
                  displayText={(mcpUsage[server.id] ?? []).length > 0
                    ? t(
                        (mcpUsage[server.id] ?? []).length === 1
                          ? "{{count}} profile"
                          : "{{count}} profiles",
                        { count: (mcpUsage[server.id] ?? []).length }
                      )
                    : t("Not referenced")}
                  text={(mcpUsage[server.id] ?? []).length > 0
                    ? t("Used by {{profiles}}", { profiles: (mcpUsage[server.id] ?? []).join(", ") })
                    : t("Not used by any profile")}
                />
              )}
              actions={(
                <>
                  <button
                    className="icon-action"
                    type="button"
                    aria-label={t("Edit {{name}}", { name: server.id })}
                    onClick={(event) => {
                      editorTriggerRef.current = event.currentTarget;
                      editServer(server);
                    }}
                  >
                    <Pencil size={15} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-action"
                    type="button"
                    aria-label={t("More actions for {{id}}", { id: server.id })}
                    aria-expanded={openAction?.id === server.id}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const width = 220;
                      setOpenAction((current) =>
                        current?.id === server.id
                          ? undefined
                          : {
                              id: server.id,
                              left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
                              top: Math.min(rect.bottom + 6, window.innerHeight - 58)
                            }
                      );
                    }}
                  >
                    <MoreHorizontal size={16} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                  {openAction?.id === server.id
                    ? createPortal(
                        <div
                          className="mcp-row-action-menu ui-action-menu"
                          role="menu"
                          aria-label={t("Actions for {{id}}", { id: server.id })}
                          style={{ left: openAction.left, top: openAction.top }}
                        >
                          {(mcpUsage[server.id] ?? []).length > 0 ? (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                onReviewUsage(server.id);
                                setOpenAction(undefined);
                              }}
                            >
                              <Users size={14} strokeWidth={2.2} aria-hidden="true" />
                              <span>{t("Review profiles")}</span>
                            </button>
                          ) : null}
                          <button
                            className="is-danger"
                            type="button"
                            role="menuitem"
                            aria-label={t("Remove {{name}}", { name: server.id })}
                            onClick={() => {
                              deleteTriggerRef.current = document.querySelector(
                                `[aria-label="${CSS.escape(t("More actions for {{id}}", { id: server.id }))}"]`
                              );
                              setDeleteCandidate(server);
                              setOpenAction(undefined);
                            }}
                          >
                            <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                            <span>{t("Delete MCP")}</span>
                          </button>
                        </div>,
                        document.body
                      )
                    : null}
                </>
              )}
            />
          ))}
          {visibleServers.length === 0 ? (
            <div className="inline-state inline-state--panel library-empty-state">
              <span>{t(mcpServers.length === 0 ? "No MCPs yet" : "No matching MCPs")}</span>
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
                  {t("Add first MCP")}
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
            aria-label={t("MCP editor")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="library-drawer__header">
              <div>
                <strong>{editingId ? t("Edit {{name}}", { name: draft.name || editingId }) : t("Add MCP")}</strong>
                <p className="muted">
                  {draft.transport === "stdio"
                    ? t("Reference environment variables without storing secret values.")
                    : t("Remote credentials are configured in the Agent after Apply.")}
                </p>
              </div>
              <button
                className="icon-action"
                type="button"
                aria-label={t("Close MCP editor")}
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
                    aria-label={t("MCP library id")}
                  placeholder="context7"
                  value={draft.id}
                  disabled={Boolean(editingId)}
                  aria-describedby={idError ? "mcp-id-error" : editingId ? "mcp-id-help" : undefined}
                  onChange={(event) => setDraft({ ...draft, id: event.currentTarget.value })}
                />
                {editingId ? (
                  <small className="field-help" id="mcp-id-help">
                    {t("ID is fixed because Profiles reference it.")}
                  </small>
                ) : idError ? (
                  <small className="field-error" id="mcp-id-error" role="alert">
                    {idError}
                  </small>
                ) : null}
              </label>
              <label>
                <span>{t("Name")}</span>
                <input
                  ref={editorNameFieldRef}
                  aria-label={t("MCP library name")}
                  placeholder="Context7"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>{t("Transport")}</span>
                <select
                  aria-label={t("MCP transport")}
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
                    <span>{t("Command")}</span>
                    <input
                      aria-label={t("MCP command")}
                      placeholder="npx"
                      value={draft.command ?? ""}
                      onChange={(event) =>
                        setDraft({ ...draft, command: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label className="mcp-server-form__wide">
                    <span>{t("Args")}</span>
                    <textarea
                      aria-label={t("MCP args")}
                      placeholder="-y&#10;@upstash/context7-mcp"
                      value={argsText}
                      onChange={(event) => setArgsText(event.currentTarget.value)}
                    />
                  </label>
                </>
              ) : (
                <label className="mcp-server-form__wide">
                  <span>{t("URL")}</span>
                  <input
                    aria-label={t("MCP URL")}
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
                  <span>{t("Environment variable references")}</span>
                  <textarea
                    aria-label={t("MCP env")}
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
                      {t("One variable name per line. Values stay in your shell environment.")}
                    </small>
                  )}
                </label>
              ) : null}
            </div>
            <footer className="library-drawer__footer mcp-editor-actions">
              <button
                className="secondary-action"
                type="button"
                disabled={isSaving}
                onClick={() => setIsEditorOpen(false)}
              >
                {t("Cancel")}
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={!isDraftComplete || isSaving}
                onClick={() => { void saveDraft(); }}
              >
                {t(isSaving ? "Saving MCP" : editingId ? "Save changes" : "Add to library")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div className="preview-modal-backdrop" onClick={() => setDeleteCandidate(undefined)}>
          <section
            ref={deleteDialogRef}
            className="profile-form-dialog profile-form-dialog--compact"
            role="dialog"
            aria-label={t("Delete MCP")}
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Delete MCP")}</div>
                <p className="muted">
                  {(mcpUsage[deleteCandidate.id] ?? []).length > 0
                    ? t("{{name}} is used by {{profiles}}. Remove it from those profiles first.", {
                        name: deleteCandidate.name,
                        profiles: (mcpUsage[deleteCandidate.id] ?? []).join(", ")
                      })
                    : t("Delete {{name}} from the MCP library?", { name: deleteCandidate.name })}
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
                {t("Cancel")}
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
                  {t("Review profiles")}
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
                  {t("Delete MCP")}
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
};
