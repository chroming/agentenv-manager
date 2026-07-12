import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser";
import type {
  ActivationPreview,
  AssetPolicy,
  McpLibraryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo,
  TargetInfo
} from "../../shared/types";
import { InfoTip } from "./InfoTip";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIcon } from "./ResourceIconPicker";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { Switch } from "./ui";

interface SkillsEditorProps {
  mode?: "skills" | "mcp" | "advanced";
  value: AssetPolicy;
  configText: string;
  configLanguage?: TargetInfo["configLanguage"];
  preview?: ActivationPreview;
  librarySkills?: SkillLibraryEntry[];
  skillUpdates?: SkillUpdateInfo[];
  checkingSkillUpdates?: boolean;
  mcpServers?: McpLibraryEntry[];
  onCheckSkillUpdates?(ids: string[]): void;
  onPreviewSkillUpdate?(id: string): void;
  onChange(value: AssetPolicy): void;
}

interface McpResource {
  name: string;
  type: string;
  detail: string;
  status: "Conflict" | "Configured" | "Managed";
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const describeMcpServer = (server: unknown): Pick<McpResource, "type" | "detail"> => {
  if (!isRecord(server)) {
    return { type: "server", detail: "configured" };
  }

  const type = typeof server.type === "string" && server.type ? server.type : "server";
  if (typeof server.url === "string" && server.url) {
    return { type, detail: server.url };
  }
  if (Array.isArray(server.command) && server.command.every((item) => typeof item === "string")) {
    return { type, detail: server.command.join(" ") };
  }
  if (typeof server.command === "string" && server.command) {
    const args = Array.isArray(server.args) && server.args.every((item) => typeof item === "string")
      ? server.args
      : [];
    return { type, detail: [server.command, ...args].join(" ") };
  }
  return { type, detail: "configured" };
};

const getMcpTable = (
  parsed: Record<string, unknown>,
  configLanguage: TargetInfo["configLanguage"]
) => {
  if (configLanguage !== "jsonc") {
    return undefined;
  }

  return isRecord(parsed.mcp)
    ? parsed.mcp
    : isRecord(parsed.mcpServers)
      ? parsed.mcpServers
      : undefined;
};

const parseTomlString = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (!match) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return undefined;
  }
};

const parseTomlStringArray = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
};

const parseTomlMcpResources = (configText: string) => {
  const servers: Record<string, Record<string, unknown>> = {};
  let current: Record<string, unknown> | undefined;

  for (const rawLine of configText.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const sectionMatch = line.match(
      /^\[mcp_servers\.([A-Za-z0-9_-]+|"((?:[^"\\]|\\.)*)")\]$/
    );
    if (sectionMatch) {
      const name = sectionMatch[2]
        ? (parseTomlString(`"${sectionMatch[2]}"`) ?? sectionMatch[2])
        : sectionMatch[1];
      current = servers[name] ?? {};
      servers[name] = current;
      continue;
    }

    if (!current) {
      continue;
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!keyValueMatch) {
      continue;
    }

    const [, key, value] = keyValueMatch;
    if (key === "url" || key === "command") {
      current[key] = parseTomlString(value) ?? value.trim();
    }
    if (key === "args") {
      current[key] = parseTomlStringArray(value) ?? [];
    }
  }

  return servers;
};

const parseConfigObject = (
  configText: string,
  configLanguage: TargetInfo["configLanguage"]
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } => {
  if (configLanguage === "jsonc") {
    const errors: ParseError[] = [];
    const parsed = parseJsonc(configText.trim().length > 0 ? configText : "{}", errors, {
      allowTrailingComma: true
    });
    if (errors.length > 0) {
      return {
        ok: false,
        message: errors.map((error) => printParseErrorCode(error.error)).join(", ")
      };
    }
    return isRecord(parsed) ? { ok: true, value: parsed } : { ok: true, value: {} };
  }

  return { ok: true, value: {} };
};

const getMcpResources = (
  configText: string,
  configLanguage: TargetInfo["configLanguage"] | undefined,
  preview: ActivationPreview | undefined
): { resources: McpResource[]; error?: string; note?: string } => {
  if (configLanguage !== "jsonc" && configLanguage !== "toml") {
    return { resources: [] };
  }

  if (configLanguage === "toml") {
    const mcp = parseTomlMcpResources(configText);
    const managedNames = new Set(preview?.targetState.managedMcpNames ?? []);
    return {
      resources: Object.entries(mcp).map(([name, server]) => {
        const hasConflict = preview?.errors.some((error) => error.includes(`MCP server ${name}`));
        return {
          name,
          ...describeMcpServer(server),
          status: hasConflict ? "Conflict" : managedNames.has(name) ? "Managed" : "Configured"
        };
      })
    };
  }

  const parsed = parseConfigObject(configText, configLanguage);
  if (!parsed.ok) {
    return { resources: [], error: parsed.message };
  }
  const mcp = getMcpTable(parsed.value, configLanguage);
  if (!mcp) {
    return { resources: [] };
  }

  const managedNames = new Set(preview?.targetState.managedMcpNames ?? []);
  return {
    resources: Object.entries(mcp).map(([name, server]) => {
      const hasConflict = preview?.errors.some((error) => error.includes(`MCP server ${name}`));
      return {
        name,
        ...describeMcpServer(server),
        status: hasConflict ? "Conflict" : managedNames.has(name) ? "Managed" : "Configured"
      };
    })
  };
};

export const SkillsEditor = ({
  mode: requestedMode,
  value,
  configText,
  configLanguage,
  preview,
  librarySkills = [],
  skillUpdates = [],
  checkingSkillUpdates = false,
  mcpServers = [],
  onCheckSkillUpdates,
  onPreviewSkillUpdate,
  onChange
}: SkillsEditorProps) => {
  const { t } = useI18n();
  const mode = requestedMode ?? "all";
  const showsSkills = mode === "skills" || mode === "all";
  const showsMcp = mode === "mcp" || mode === "all";
  const [activePicker, setActivePicker] = useState<"skills" | "mcp">();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedLibrarySkillIds, setSelectedLibrarySkillIds] = useState<string[]>([]);
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
  const [profileSkillMenu, setProfileSkillMenu] = useState<{
    kind: "owned" | "library";
    index: number;
    left: number;
    top: number;
  }>();
  const [editingOwnedSkillIndex, setEditingOwnedSkillIndex] = useState<number>();
  const [editingOwnedSkillTarget, setEditingOwnedSkillTarget] = useState("");
  const skillPickerButtonRef = useRef<HTMLButtonElement>(null);
  const mcpPickerButtonRef = useRef<HTMLButtonElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pickerCancelButtonRef = useRef<HTMLButtonElement>(null);
  const pickerDialogRef = useRef<HTMLElement>(null);
  const ownedSkillDialogRef = useRef<HTMLElement>(null);
  const ownedSkillInputRef = useRef<HTMLInputElement>(null);
  const profileSkillMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const skillEntries = value.ownedDirs
    .map((ownedDir, index) => ({ ownedDir, index }))
    .filter((entry) => entry.ownedDir.kind === "skill");
  const agentFileEntries = (value.ownedFiles ?? []).filter(
    (ownedFile) => ownedFile.kind === "agent"
  );
  const librarySkillEntries = value.skillRefs ?? [];
  const availableLibrarySkills = librarySkills.filter((skill) => skill.globallyEnabled !== false);
  const libraryMcpEntries = value.mcpRefs ?? [];
  const mcpState = getMcpResources(configText, configLanguage, preview);
  const hasResources =
    mode === "all"
      ? skillEntries.length > 0 ||
        agentFileEntries.length > 0 ||
        librarySkillEntries.length > 0 ||
        libraryMcpEntries.length > 0 ||
        mcpState.resources.length > 0
      : mode === "skills"
      ? skillEntries.length > 0 || librarySkillEntries.length > 0
      : libraryMcpEntries.length > 0 || mcpState.resources.length > 0;
  const activePickerIsValid =
    !activePicker ||
    (activePicker === "skills" && showsSkills) ||
    (activePicker === "mcp" && showsMcp);
  const attachedSkillIds = new Set(librarySkillEntries.map((entry) => entry.libraryId));
  const attachedMcpIds = new Set(libraryMcpEntries.map((entry) => entry.libraryId));
  const enabledLibrarySkillCount = librarySkillEntries.filter(
    (entry) =>
      entry.enabled !== false &&
      librarySkills.find((skill) => skill.id === entry.libraryId)?.globallyEnabled !== false
  ).length;
  const checkableSkillIds = librarySkillEntries
    .filter((entry) => entry.enabled !== false)
    .map((entry) => librarySkills.find((skill) => skill.id === entry.libraryId))
    .filter((skill): skill is SkillLibraryEntry => Boolean(skill))
    .filter((skill) => skill.globallyEnabled !== false)
    .filter((skill) => skill.updatePolicy === "tracked")
    .map((skill) => skill.id);

  const updateOwnedDir = (
    index: number,
    patch: Partial<AssetPolicy["ownedDirs"][number]>
  ) => {
    onChange({
      ...value,
      ownedDirs: value.ownedDirs.map((ownedDir, currentIndex) =>
        currentIndex === index ? { ...ownedDir, ...patch } : ownedDir
      )
    });
  };

  const removeOwnedDir = (index: number) => {
    onChange({
      ...value,
      ownedDirs: value.ownedDirs.filter((_, currentIndex) => currentIndex !== index)
    });
  };

  const removeSkillRef = (index: number) => {
    onChange({
      ...value,
      skillRefs: (value.skillRefs ?? []).filter((_, currentIndex) => currentIndex !== index)
    });
  };

  const toggleSkillRef = (index: number) => {
    onChange({
      ...value,
      skillRefs: (value.skillRefs ?? []).map((entry, currentIndex) =>
        currentIndex === index ? { ...entry, enabled: entry.enabled === false } : entry
      )
    });
  };

  const removeMcpRef = (index: number) => {
    onChange({
      ...value,
      mcpRefs: (value.mcpRefs ?? []).filter((_, currentIndex) => currentIndex !== index)
    });
  };

  const openSkillPicker = () => {
    pickerTriggerRef.current = skillPickerButtonRef.current;
    setSelectedLibrarySkillIds([]);
    setActivePicker("skills");
  };

  const openMcpPicker = () => {
    pickerTriggerRef.current = mcpPickerButtonRef.current;
    setSelectedMcpIds([]);
    setActivePicker("mcp");
  };

  const closePicker = useCallback(() => {
    setActivePicker(undefined);
    setSelectedLibrarySkillIds([]);
    setSelectedMcpIds([]);
  }, []);

  const toggleSelectedSkill = (id: string) => {
    setSelectedLibrarySkillIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.concat(id)
    );
  };

  const toggleSelectedMcp = (id: string) => {
    setSelectedMcpIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.concat(id)
    );
  };

  const addSelectedLibrarySkills = () => {
    const additions = selectedLibrarySkillIds
      .filter((libraryId) => !attachedSkillIds.has(libraryId))
      .map((libraryId) => ({
        libraryId,
        targetName: libraryId,
        enabled: true
      }));
    if (additions.length === 0) {
      return;
    }
    onChange({
      ...value,
      skillRefs: (value.skillRefs ?? []).concat(additions)
    });
    closePicker();
  };

  const addSelectedMcpServers = () => {
    const additions = selectedMcpIds
      .filter((libraryId) => !attachedMcpIds.has(libraryId))
      .map((libraryId) => ({
        libraryId,
        targetName: libraryId
      }));
    if (additions.length === 0) {
      return;
    }
    onChange({
      ...value,
      mcpRefs: (value.mcpRefs ?? []).concat(additions)
    });
    closePicker();
  };

  useEffect(() => {
    if (!activePicker || !activePickerIsValid) {
      return undefined;
    }

    const trigger = pickerTriggerRef.current;
    pickerCancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const dialog = pickerDialogRef.current;
      const focusableControls = dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        : [];
      if (focusableControls.length === 0) {
        return;
      }

      const firstControl = focusableControls[0];
      const lastControl = focusableControls.at(-1);
      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl?.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const restoreTarget = trigger?.isConnected
        ? trigger
        : skillPickerButtonRef.current ?? mcpPickerButtonRef.current;
      restoreTarget?.focus();
      if (pickerTriggerRef.current === trigger) {
        pickerTriggerRef.current = null;
      }
    };
  }, [activePicker, activePickerIsValid, closePicker]);

  useEffect(() => {
    if (activePicker && !activePickerIsValid) {
      closePicker();
    }
  }, [activePicker, activePickerIsValid, closePicker]);

  useEffect(() => {
    if (!profileSkillMenu) {
      return undefined;
    }
    const dismiss = () => setProfileSkillMenu(undefined);
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [profileSkillMenu]);

  const closeOwnedSkillDialog = useCallback(() => {
    setEditingOwnedSkillIndex(undefined);
    setEditingOwnedSkillTarget("");
  }, []);

  useModalDialog({
    open: editingOwnedSkillIndex !== undefined,
    dialogRef: ownedSkillDialogRef,
    initialFocusRef: ownedSkillInputRef,
    fallbackFocusRef: profileSkillMenuTriggerRef,
    onDismiss: closeOwnedSkillDialog,
    focusKey: String(editingOwnedSkillIndex ?? "closed")
  });

  const openProfileSkillMenu = (
    kind: "owned" | "library",
    index: number,
    button: HTMLButtonElement
  ) => {
    const rect = button.getBoundingClientRect();
    const width = 220;
    const height = kind === "owned" ? 92 : 52;
    profileSkillMenuTriggerRef.current = button;
    setProfileSkillMenu({
      kind,
      index,
      left: Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width)),
      top:
        rect.bottom + height + 8 <= window.innerHeight
          ? rect.bottom + 6
          : Math.max(12, rect.top - height - 6)
    });
  };

  if (mode === "skills") {
    return (
      <section className="profile-skill-manager" aria-label={t("Profile skills")}>
        <header className="profile-skill-toolbar">
          <div className="profile-skill-summary">
            <strong>{t("Skills")}</strong>
            <span>
              {t("{{count}} on", { count: enabledLibrarySkillCount })}
              {librarySkillEntries.length > enabledLibrarySkillCount
                ? ` · ${t("{{count}} off", { count: librarySkillEntries.length - enabledLibrarySkillCount })}`
                : ""}
            </span>
          </div>
          <div className="profile-skill-toolbar__actions">
            <button
              className="secondary-action profile-skill-check"
              type="button"
              aria-label={t("Check profile skill updates")}
              title={
                checkableSkillIds.length > 0
                  ? t("Check updates for enabled tracked skills")
                  : t("No enabled tracked skills")
              }
              disabled={checkingSkillUpdates || checkableSkillIds.length === 0}
              onClick={() => onCheckSkillUpdates?.(checkableSkillIds)}
            >
              <RefreshCw
                className={checkingSkillUpdates ? "is-spinning" : undefined}
                size={14}
                strokeWidth={2.2}
                aria-hidden="true"
              />
              {t(checkingSkillUpdates ? "Checking" : "Check")}
            </button>
            <button
              className="secondary-action"
              ref={skillPickerButtonRef}
              type="button"
              aria-label={t("Add library skill")}
              onClick={openSkillPicker}
            >
              <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
              {t("Add")}
            </button>
          </div>
        </header>

        <div className="profile-skill-list" role="list">
          {skillEntries.map(({ ownedDir: asset, index }) => (
            <div
              className="profile-skill-row profile-skill-row--owned"
              key={`${asset.source}:${asset.targetName}:${index}`}
              role="listitem"
              aria-label={t("Profile-owned skill {{name}}", { name: asset.targetName })}
            >
              <span className="profile-skill-icon" aria-hidden="true">
                <ResourceIcon iconKey="folder" size={16} />
              </span>
              <div className="profile-skill-main">
                <OverflowTooltip
                  className="profile-skill-name"
                  text={asset.targetName}
                  ariaLabel={t("Full skill name {{id}}", { id: asset.targetName })}
                />
                <OverflowTooltip
                  className="profile-skill-detail"
                  text={`${t("Profile-owned")} · ${asset.source}`}
                  ariaLabel={t("Full skill source {{id}}", { id: asset.targetName })}
                />
              </div>
              <span className="profile-skill-state">{t("Profile-owned")}</span>
              <button
                className="icon-action"
                type="button"
                aria-label={t("More actions for profile-owned skill {{name}}", { name: asset.targetName })}
                aria-expanded={
                  profileSkillMenu?.kind === "owned" && profileSkillMenu.index === index
                }
                onClick={(event) => {
                  event.stopPropagation();
                  openProfileSkillMenu("owned", index, event.currentTarget);
                }}
              >
                <MoreHorizontal size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
          ))}

          {librarySkillEntries.map((entry, index) => {
            const skill = librarySkills.find((item) => item.id === entry.libraryId);
            const update = skillUpdates.find((item) => item.id === entry.libraryId);
            const profileEnabled = entry.enabled !== false;
            const globallyEnabled = skill?.globallyEnabled !== false;
            const enabled = profileEnabled && globallyEnabled;
            const status = !skill
              ? "Missing"
              : !globallyEnabled
                ? "Disabled in Library"
              : !profileEnabled
                ? "Disabled in Profile"
              : update?.error
                ? "Check failed"
                : update?.updateAvailable
                  ? "Update available"
                  : skill.updatePolicy === "untracked"
                    ? "Not tracked"
                    : update
                      ? "Up to date"
                      : "Tracked";
            const iconKey = skill?.iconKey ?? (skill?.sourceType === "github" ? "github" : "folder");
            const revision = skill?.remoteRevision?.slice(0, 7);
            const detail = skill
              ? `${skill.sourceType === "github" ? "GitHub" : t("Local")}${revision ? ` · ${revision}` : ""} · ${skill.path}${entry.targetName !== skill.id ? ` · ${t("installs as {{name}}", { name: entry.targetName })}` : ""}`
              : t("Library skill {{id}} is missing", { id: entry.libraryId });
            return (
              <div
                className={`profile-skill-row${enabled ? "" : " is-disabled"}`}
                key={`${entry.libraryId}:${entry.targetName}:${index}`}
                role="listitem"
                aria-label={t("Profile skill {{name}}", { name: entry.targetName })}
              >
                <span className="profile-skill-icon" aria-hidden="true">
                  <ResourceIcon iconKey={iconKey} size={16} />
                </span>
                <div className="profile-skill-main">
                  <OverflowTooltip
                    className="profile-skill-name"
                    text={skill?.name ?? entry.targetName}
                    ariaLabel={t("Full skill name {{id}}", { id: entry.targetName })}
                  />
                  <OverflowTooltip
                    className="profile-skill-detail"
                    text={detail}
                    ariaLabel={t("Full skill detail {{id}}", { id: entry.targetName })}
                  />
                </div>
                <span
                  className={`profile-skill-state${update?.updateAvailable ? " is-update" : ""}${update?.error || !skill ? " is-error" : ""}`}
                  title={update?.error ?? t(status)}
                >
                  {t(status)}
                </span>
                {enabled && update?.updateAvailable ? (
                  <button
                    className="secondary-action profile-skill-update"
                    type="button"
                    onClick={() => onPreviewSkillUpdate?.(entry.libraryId)}
                  >
                    {t("Update")}
                  </button>
                ) : null}
                <Switch
                  checked={enabled}
                  className="profile-skill-switch"
                  disabled={!globallyEnabled}
                  label={t(
                    !globallyEnabled
                      ? "{{name}} is disabled in Library"
                      : profileEnabled
                        ? "Disable {{name}}"
                        : "Enable {{name}}",
                    { name: skill?.name ?? entry.targetName }
                  )}
                  title={t(
                    !globallyEnabled
                      ? "Enable this skill in Library first"
                      : profileEnabled
                        ? "Disable in this profile"
                        : "Enable in this profile"
                  )}
                  onClick={() => toggleSkillRef(index)}
                />
                <button
                  className="icon-action"
                  type="button"
                  aria-label={t("More actions for profile skill {{name}}", { name: entry.targetName })}
                  aria-expanded={
                    profileSkillMenu?.kind === "library" && profileSkillMenu.index === index
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    openProfileSkillMenu("library", index, event.currentTarget);
                  }}
                >
                  <MoreHorizontal size={15} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            );
          })}

          {!hasResources ? (
            <div className="profile-skill-empty">
              <strong>{t("No skills in this profile")}</strong>
              <span>{t("Add reusable skills from Library.")}</span>
            </div>
          ) : null}
        </div>

        {profileSkillMenu
          ? createPortal(
              <div
                className="row-action-menu profile-skill-menu"
                role="menu"
                aria-label={t("Profile skill actions")}
                style={{ left: profileSkillMenu.left, top: profileSkillMenu.top }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                {profileSkillMenu.kind === "owned" ? (
                  <button
                    className="row-action-item"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const ownedDir = value.ownedDirs[profileSkillMenu.index];
                      setEditingOwnedSkillIndex(profileSkillMenu.index);
                      setEditingOwnedSkillTarget(ownedDir?.targetName ?? "");
                      setProfileSkillMenu(undefined);
                    }}
                  >
                    <Pencil size={14} strokeWidth={2.2} aria-hidden="true" />
                    <span>{t("Edit install name")}</span>
                  </button>
                ) : null}
                <button
                  className="row-action-item row-action-item--danger"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (profileSkillMenu.kind === "owned") {
                      removeOwnedDir(profileSkillMenu.index);
                    } else {
                      removeSkillRef(profileSkillMenu.index);
                    }
                    setProfileSkillMenu(undefined);
                  }}
                >
                  <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                  <span>{t("Remove from profile")}</span>
                </button>
              </div>,
              document.body
            )
          : null}

        {editingOwnedSkillIndex !== undefined ? (
          <div className="preview-modal-backdrop" onClick={closeOwnedSkillDialog}>
            <section
              ref={ownedSkillDialogRef}
              className="profile-form-dialog profile-form-dialog--compact profile-owned-skill-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("Edit profile-owned skill")}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="profile-dialog-header">
                <div className="section-title">{t("Edit install name")}</div>
              </header>
              <label className="field-block">
                <span>{t("Target name")}</span>
                <input
                  ref={ownedSkillInputRef}
                  value={editingOwnedSkillTarget}
                  onChange={(event) => setEditingOwnedSkillTarget(event.currentTarget.value)}
                />
              </label>
              <footer className="preview-actions">
                <button className="secondary-action" type="button" onClick={closeOwnedSkillDialog}>
                  {t("Cancel")}
                </button>
                <button
                  className="primary-action"
                  type="button"
                  disabled={editingOwnedSkillTarget.trim().length === 0}
                  onClick={() => {
                    updateOwnedDir(editingOwnedSkillIndex, {
                      targetName: editingOwnedSkillTarget.trim()
                    });
                    closeOwnedSkillDialog();
                  }}
                >
                  {t("Save")}
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        {activePicker === "skills" ? (
          <div className="preview-modal-backdrop" onClick={closePicker}>
            <section
              aria-label={t("Add library skills")}
              aria-modal="true"
              className="profile-form-dialog resource-picker-dialog"
              ref={pickerDialogRef}
              role="dialog"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="profile-dialog-header">
                <div className="section-title">{t("Add library skills")}</div>
              </header>
              <div className="resource-picker-list">
                {availableLibrarySkills.length === 0 ? (
                  <div className="inline-state">{t("No library skills available")}</div>
                ) : null}
                {availableLibrarySkills.map((skill) => {
                  const isAttached = attachedSkillIds.has(skill.id);
                  return (
                    <label className="resource-picker-option" key={skill.id}>
                      <input
                        aria-label={skill.name}
                        checked={selectedLibrarySkillIds.includes(skill.id)}
                        disabled={isAttached}
                        type="checkbox"
                        onChange={() => toggleSelectedSkill(skill.id)}
                      />
                      <span>
                        <strong>{skill.name}</strong>
                        <small>{skill.description || skill.id}</small>
                      </span>
                      {isAttached ? <em>{t("Already added")}</em> : null}
                    </label>
                  );
                })}
              </div>
              <footer className="preview-actions">
                <button
                  className="secondary-action"
                  ref={pickerCancelButtonRef}
                  type="button"
                  onClick={closePicker}
                >
                  {t("Cancel")}
                </button>
                <button
                  className="primary-action"
                  type="button"
                  aria-label={t("Add selected skills")}
                  disabled={selectedLibrarySkillIds.length === 0}
                  onClick={addSelectedLibrarySkills}
                >
                  {selectedLibrarySkillIds.length > 0
                    ? t("Add {{count}}", { count: selectedLibrarySkillIds.length })
                    : t("Add selected")}
                </button>
              </footer>
            </section>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="skills-editor" aria-label={t("Resources")}>
      {mode !== "advanced" ? (
        <div className={`asset-editor-header${mode === "mcp" ? " asset-editor-header--compact" : ""}`}>
          {mode === "all" ? (
            <div>
              <div className="section-title">
                {t("Resources")}
                <InfoTip label={t("Attach shared library skills and MCP servers to this profile. Preview before apply verifies target paths and ownership.")} />
              </div>
            </div>
          ) : null}
          <div className="asset-editor-actions">
            {showsSkills ? (
              <button
                className="secondary-action"
                ref={skillPickerButtonRef}
                type="button"
                onClick={openSkillPicker}
              >
                {t("Add library skill")}
              </button>
            ) : null}
            {showsMcp ? (
              <button
                className="secondary-action"
                ref={mcpPickerButtonRef}
                type="button"
                onClick={openMcpPicker}
              >
                {t("Add library MCP")}
              </button>
            ) : null}
            {mode === "all" ? (
              <button
                aria-expanded={advancedOpen}
                aria-controls="advanced-resource-settings"
                className="secondary-action"
                type="button"
                onClick={() => setAdvancedOpen((current) => !current)}
              >
                {t(advancedOpen ? "Hide advanced" : "Advanced")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {mode === "advanced" || (mode === "all" && advancedOpen) ? (
        <section
          aria-label={t("Advanced resource settings")}
          className="resource-section resource-section--advanced"
          id="advanced-resource-settings"
        >
          <div>
            <div className="resource-heading">
              {t("Advanced resource settings")}
              <InfoTip label={t("Use absolute target paths here to disable skills that should be ignored when this profile is applied.")} />
            </div>
          </div>
          <label className="field-block">
            <span>{t("Disabled Skill Paths")}</span>
            <textarea
              aria-label={t("Disabled Skill Paths")}
              spellCheck={false}
              value={value.disabledSkillPaths.join("\n")}
              onChange={(event) =>
                onChange({
                  ...value,
                  disabledSkillPaths: event.currentTarget.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                })
              }
            />
          </label>
        </section>
      ) : null}

      {mode !== "advanced" ? (
        <section className="resource-section" aria-label={t("Resource inventory")}>
          <div>
            <div className="resource-heading">
              {t("Inventory")}
              <InfoTip label={t("This list shows profile-owned resources, shared library references, and MCP servers that will be considered during preview and apply.")} />
            </div>
          </div>
          <div className="resource-table-head" aria-hidden="true">
            <span>{t("Type")}</span>
            <span>{t("Name and source")}</span>
            <span>{t("Status")}</span>
          </div>
          <div className="resource-list">
            {showsMcp && mcpState.error ? (
              <p className="warning">{t("Config parse error: {{error}}", { error: mcpState.error })}</p>
            ) : null}
            {showsMcp && mcpState.note ? <p className="muted">{mcpState.note}</p> : null}
            {!(showsMcp && mcpState.error) && !(showsMcp && mcpState.note) && !hasResources ? (
              <p className="muted">{t("No resources configured")}</p>
            ) : null}
            {showsSkills && skillEntries.length > 0
              ? skillEntries.map(({ ownedDir: asset, index }) => (
                  <fieldset
                    className="owned-skill resource-item"
                    aria-label={t("Skill {{name}}", { name: asset.targetName })}
                    key={`${asset.kind}:${asset.source}:${asset.targetName}:${index}`}
                  >
                    <legend className="resource-legend">{t("Skill")}</legend>
                    <div className="resource-row resource-row--editable">
                      <span className="resource-chip">{t("Skill")}</span>
                      <div className="resource-row__main">
                        <span>{asset.targetName}</span>
                        <small>{t("Profile-owned")}</small>
                        <small>{asset.source}</small>
                      </div>
                      <strong className="resource-status">{t("Configured")}</strong>
                    </div>
                    <div className="resource-edit-grid">
                      <label>
                        <span>{t("Source")}</span>
                        <input
                          aria-label={t("Source")}
                          value={asset.source}
                          onChange={(event) =>
                            updateOwnedDir(index, { source: event.currentTarget.value })
                          }
                        />
                      </label>
                      <label>
                        <span>{t("Target name")}</span>
                        <input
                          aria-label={t("Target name")}
                          value={asset.targetName}
                          onChange={(event) =>
                            updateOwnedDir(index, { targetName: event.currentTarget.value })
                          }
                        />
                      </label>
                      <button type="button" onClick={() => removeOwnedDir(index)}>
                        {t("Remove profile skill")}
                      </button>
                    </div>
                  </fieldset>
                ))
              : null}
            {mode === "all"
              ? agentFileEntries.map((asset, index) => (
                  <div
                    aria-label={t("Agent {{name}}", { name: asset.targetName })}
                    className="resource-row"
                    key={`${asset.kind}:${asset.source}:${asset.targetName}:${index}`}
                    role="group"
                  >
                    <span className="resource-chip">{t("Agent")}</span>
                    <div className="resource-row__main">
                      <span>{asset.targetName}</span>
                      <small>{t("Profile-owned")}</small>
                      <small>{asset.source}</small>
                    </div>
                    <strong className="resource-status">{t("Configured")}</strong>
                  </div>
                ))
              : null}
            {showsSkills
              ? librarySkillEntries.map((asset, index) => {
                  const librarySkill = librarySkills.find(
                    (skill) => skill.id === asset.libraryId
                  );
                  return (
                    <div
                      aria-label={t("Library skill {{name}}", { name: asset.targetName })}
                      className="resource-row"
                      key={`${asset.libraryId}:${asset.targetName}:${index}`}
                      role="group"
                    >
                      <span className="resource-chip">{t("Skill")}</span>
                      <div className="resource-row__main">
                        <span>{asset.targetName}</span>
                        <small>{t("Library")}</small>
                        <small>{librarySkill?.name ?? asset.libraryId}</small>
                        <small>
                          {librarySkill?.path ?? `skills-library/${asset.libraryId}`}
                        </small>
                      </div>
                      <div className="resource-row__actions">
                        <strong className="resource-status">{t("Configured")}</strong>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => removeSkillRef(index)}
                        >
                          {t("Remove from profile")}
                        </button>
                      </div>
                    </div>
                  );
                })
              : null}
            {showsMcp
              ? libraryMcpEntries.map((asset, index) => {
                  const mcpServer = mcpServers.find(
                    (server) => server.id === asset.libraryId
                  );
                  return (
                    <div
                      aria-label={t("MCP {{name}}", { name: asset.targetName })}
                      className="resource-row"
                      key={`${asset.libraryId}:${asset.targetName}:${index}`}
                      role="group"
                    >
                      <span className="resource-chip">MCP</span>
                      <div className="resource-row__main">
                        <span>{asset.targetName}</span>
                        <small>{t("Library")}</small>
                        <small>{mcpServer?.name ?? asset.libraryId}</small>
                        <small>
                          {mcpServer?.transport === "stdio"
                            ? [mcpServer.command, ...(mcpServer.args ?? [])]
                                .filter(Boolean)
                                .join(" ")
                            : mcpServer?.url ?? `mcp-library/${asset.libraryId}`}
                        </small>
                      </div>
                      <div className="resource-row__actions">
                        <strong className="resource-status">{t("Configured")}</strong>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => removeMcpRef(index)}
                        >
                          {t("Remove from profile")}
                        </button>
                      </div>
                    </div>
                  );
                })
              : null}
            {showsMcp
              ? mcpState.resources.map((resource) => (
                  <div
                    aria-label={t("MCP {{name}}", { name: resource.name })}
                    className="resource-row"
                    key={resource.name}
                    role="group"
                  >
                    <span className="resource-chip">MCP</span>
                    <div className="resource-row__main">
                      <span>{resource.name}</span>
                      <small>{t("Raw config")}</small>
                      <small>{resource.type}</small>
                      <small>{resource.detail}</small>
                    </div>
                    <strong
                      className={`resource-status resource-status--${resource.status.toLowerCase()}`}
                    >
                      {t(resource.status)}
                    </strong>
                  </div>
                ))
              : null}
          </div>
        </section>
      ) : null}

      {showsSkills && activePicker === "skills" ? (
        <div className="preview-modal-backdrop" onClick={closePicker}>
          <section
            aria-label={t("Add library skills")}
            aria-modal="true"
            className="profile-form-dialog resource-picker-dialog"
            ref={pickerDialogRef}
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">
                  {t("Add library skills")}
                  <InfoTip label={t("Select shared skills from the global library. Already attached skills stay disabled.")} />
                </div>
              </div>
            </header>
            <div className="resource-picker-list">
              {availableLibrarySkills.length === 0 ? (
                <div className="inline-state">
                  <span className="inline-state__icon" aria-hidden="true" />
                  <span>{t("No library skills available")}</span>
                </div>
              ) : null}
              {availableLibrarySkills.map((skill) => {
                const isAttached = attachedSkillIds.has(skill.id);
                return (
                  <label className="resource-picker-option" key={skill.id}>
                    <input
                      aria-label={skill.name}
                      checked={selectedLibrarySkillIds.includes(skill.id)}
                      disabled={isAttached}
                      type="checkbox"
                      onChange={() => toggleSelectedSkill(skill.id)}
                    />
                    <span>
                      <strong>{skill.name}</strong>
                      <small>{skill.description || skill.id}</small>
                    </span>
                    {isAttached ? <em>{t("Already added")}</em> : null}
                  </label>
                );
              })}
              {availableLibrarySkills.length > 0 &&
              availableLibrarySkills.every((skill) => attachedSkillIds.has(skill.id)) ? (
                <p className="muted">{t("All library skills are already attached.")}</p>
              ) : null}
            </div>
            <footer className="preview-actions">
              <button
                className="secondary-action"
                ref={pickerCancelButtonRef}
                type="button"
                onClick={closePicker}
              >
                {t("Cancel")}
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={selectedLibrarySkillIds.length === 0}
                onClick={addSelectedLibrarySkills}
              >
                {t("Add selected skills")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {showsMcp && activePicker === "mcp" ? (
        <div className="preview-modal-backdrop" onClick={closePicker}>
          <section
            aria-label={t("Add library MCP servers")}
            aria-modal="true"
            className="profile-form-dialog resource-picker-dialog"
            ref={pickerDialogRef}
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">
                  {t("Add library MCP servers")}
                  <InfoTip label={t("Select reusable MCP server definitions from the global MCP library. Already attached servers stay disabled.")} />
                </div>
              </div>
            </header>
            <div className="resource-picker-list">
              {mcpServers.length === 0 ? (
                <div className="inline-state">
                  <span className="inline-state__icon" aria-hidden="true" />
                  <span>{t("No library MCP servers available")}</span>
                </div>
              ) : null}
              {mcpServers.map((server) => {
                const isAttached = attachedMcpIds.has(server.id);
                const detail =
                  server.transport === "stdio"
                    ? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
                    : server.url;
                return (
                  <label className="resource-picker-option" key={server.id}>
                    <input
                      aria-label={server.name}
                      checked={selectedMcpIds.includes(server.id)}
                      disabled={isAttached}
                      type="checkbox"
                      onChange={() => toggleSelectedMcp(server.id)}
                    />
                    <span>
                      <strong>{server.name}</strong>
                      <small>{detail || server.id}</small>
                    </span>
                    {isAttached ? <em>{t("Already added")}</em> : null}
                  </label>
                );
              })}
              {mcpServers.length > 0 && mcpServers.every((server) => attachedMcpIds.has(server.id)) ? (
                <p className="muted">{t("All library MCP servers are already attached.")}</p>
              ) : null}
            </div>
            <footer className="preview-actions">
              <button
                className="secondary-action"
                ref={pickerCancelButtonRef}
                type="button"
                onClick={closePicker}
              >
                {t("Cancel")}
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={selectedMcpIds.length === 0}
                onClick={addSelectedMcpServers}
              >
                {t("Add selected MCP servers")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
};
