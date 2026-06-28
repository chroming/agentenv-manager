import { useEffect, useState } from "react";
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
  TargetInfo
} from "../../shared/types";
import { InfoTip } from "./InfoTip";

interface SkillsEditorProps {
  value: AssetPolicy;
  configText: string;
  configLanguage?: TargetInfo["configLanguage"];
  preview?: ActivationPreview;
  librarySkills?: SkillLibraryEntry[];
  mcpServers?: McpLibraryEntry[];
  onChange(value: AssetPolicy): void;
}

interface McpResource {
  name: string;
  type: string;
  detail: string;
  status: "Conflict" | "Configured" | "Managed";
}

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
  value,
  configText,
  configLanguage,
  preview,
  librarySkills = [],
  mcpServers = [],
  onChange
}: SkillsEditorProps) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activePicker, setActivePicker] = useState<"skills" | "mcp">();
  const [selectedLibrarySkillIds, setSelectedLibrarySkillIds] = useState<string[]>([]);
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
  const skillEntries = value.ownedDirs
    .map((ownedDir, index) => ({ ownedDir, index }))
    .filter((entry) => entry.ownedDir.kind === "skill");
  const agentFileEntries = (value.ownedFiles ?? []).filter(
    (ownedFile) => ownedFile.kind === "agent"
  );
  const librarySkillEntries = value.skillRefs ?? [];
  const libraryMcpEntries = value.mcpRefs ?? [];
  const mcpState = getMcpResources(configText, configLanguage, preview);
  const hasResources =
    skillEntries.length > 0 ||
    agentFileEntries.length > 0 ||
    librarySkillEntries.length > 0 ||
    libraryMcpEntries.length > 0 ||
    mcpState.resources.length > 0;
  const attachedSkillIds = new Set(librarySkillEntries.map((entry) => entry.libraryId));
  const attachedMcpIds = new Set(libraryMcpEntries.map((entry) => entry.libraryId));

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

  const removeMcpRef = (index: number) => {
    onChange({
      ...value,
      mcpRefs: (value.mcpRefs ?? []).filter((_, currentIndex) => currentIndex !== index)
    });
  };

  const openSkillPicker = () => {
    setSelectedLibrarySkillIds([]);
    setActivePicker("skills");
  };

  const openMcpPicker = () => {
    setSelectedMcpIds([]);
    setActivePicker("mcp");
  };

  const closePicker = () => {
    setActivePicker(undefined);
    setSelectedLibrarySkillIds([]);
    setSelectedMcpIds([]);
  };

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
        targetName: `agentenv-${libraryId}`
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
    if (!activePicker) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePicker();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activePicker]);

  return (
    <section className="skills-editor" aria-label="Resources">
      <div className="asset-editor-header">
        <div>
          <div className="section-title">
            Resources
            <InfoTip label="Attach shared library skills and MCP servers to this profile. Preview before apply verifies target paths and ownership." />
          </div>
        </div>
        <div className="asset-editor-actions">
          <button className="secondary-action" type="button" onClick={openSkillPicker}>
            Add library skill
          </button>
          <button className="secondary-action" type="button" onClick={openMcpPicker}>
            Add library MCP
          </button>
          <button
            aria-expanded={advancedOpen}
            aria-controls="advanced-resource-settings"
            className="secondary-action"
            type="button"
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            {advancedOpen ? "Hide advanced" : "Advanced"}
          </button>
        </div>
      </div>

      {advancedOpen ? (
        <section
          aria-label="Advanced resource settings"
          className="resource-section resource-section--advanced"
          id="advanced-resource-settings"
        >
          <div>
            <div className="resource-heading">
              Advanced resource settings
              <InfoTip label="Use absolute target paths here to disable skills that should be ignored when this profile is applied." />
            </div>
          </div>
          <label className="field-block">
            <span>Disabled Skill Paths</span>
            <textarea
              aria-label="Disabled Skill Paths"
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

      <section className="resource-section" aria-label="Resource inventory">
        <div>
          <div className="resource-heading">
            Inventory
            <InfoTip label="This list shows profile-owned resources, shared library references, and MCP servers that will be considered during preview and apply." />
          </div>
        </div>
        <div className="resource-table-head" aria-hidden="true">
          <span>Type</span>
          <span>Name and source</span>
          <span>Status</span>
        </div>
        <div className="resource-list">
          {mcpState.error ? <p className="warning">Config parse error: {mcpState.error}</p> : null}
          {mcpState.note ? <p className="muted">{mcpState.note}</p> : null}
          {!mcpState.error && !mcpState.note && !hasResources ? (
            <p className="muted">No resources configured</p>
          ) : null}
          {skillEntries.length > 0 ? (
            skillEntries.map(({ ownedDir: asset, index }) => (
              <fieldset
                className="owned-skill resource-item"
                aria-label={`Skill ${asset.targetName}`}
                key={`${asset.kind}:${asset.source}:${asset.targetName}:${index}`}
              >
                <legend className="resource-legend">Skill</legend>
                <div className="resource-row resource-row--editable">
                  <span className="resource-chip">Skill</span>
                  <div className="resource-row__main">
                    <span>{asset.targetName}</span>
                    <small>Profile-owned</small>
                    <small>{asset.source}</small>
                  </div>
                  <strong className="resource-status">Configured</strong>
                </div>
                <div className="resource-edit-grid">
                  <label>
                    <span>Source</span>
                    <input
                      aria-label="Source"
                      value={asset.source}
                      onChange={(event) =>
                        updateOwnedDir(index, { source: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Target name</span>
                    <input
                      aria-label="Target name"
                      value={asset.targetName}
                      onChange={(event) =>
                        updateOwnedDir(index, { targetName: event.currentTarget.value })
                      }
                    />
                  </label>
                  <button type="button" onClick={() => removeOwnedDir(index)}>
                    Remove
                  </button>
                </div>
              </fieldset>
            ))
          ) : null}
          {agentFileEntries.map((asset, index) => (
            <div
              aria-label={`Agent ${asset.targetName}`}
              className="resource-row"
              key={`${asset.kind}:${asset.source}:${asset.targetName}:${index}`}
              role="group"
            >
              <span className="resource-chip">Agent</span>
              <div className="resource-row__main">
                <span>{asset.targetName}</span>
                <small>Profile-owned</small>
                <small>{asset.source}</small>
              </div>
              <strong className="resource-status">Configured</strong>
            </div>
          ))}
          {librarySkillEntries.map((asset, index) => {
            const librarySkill = librarySkills.find((skill) => skill.id === asset.libraryId);
            return (
              <div
                aria-label={`Library skill ${asset.targetName}`}
                className="resource-row"
                key={`${asset.libraryId}:${asset.targetName}:${index}`}
                role="group"
              >
                <span className="resource-chip">Skill</span>
                <div className="resource-row__main">
                  <span>{asset.targetName}</span>
                  <small>Library</small>
                  <small>{librarySkill?.name ?? asset.libraryId}</small>
                  <small>{librarySkill?.path ?? `skills-library/${asset.libraryId}`}</small>
                </div>
                <div className="resource-row__actions">
                  <strong className="resource-status">Configured</strong>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => removeSkillRef(index)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          {libraryMcpEntries.map((asset, index) => {
            const mcpServer = mcpServers.find((server) => server.id === asset.libraryId);
            return (
              <div
                aria-label={`MCP ${asset.targetName}`}
                className="resource-row"
                key={`${asset.libraryId}:${asset.targetName}:${index}`}
                role="group"
              >
                <span className="resource-chip">MCP</span>
                <div className="resource-row__main">
                  <span>{asset.targetName}</span>
                  <small>Library</small>
                  <small>{mcpServer?.name ?? asset.libraryId}</small>
                  <small>
                    {mcpServer?.transport === "stdio"
                      ? [mcpServer.command, ...(mcpServer.args ?? [])].filter(Boolean).join(" ")
                      : mcpServer?.url ?? `mcp-library/${asset.libraryId}`}
                  </small>
                </div>
                <div className="resource-row__actions">
                  <strong className="resource-status">Configured</strong>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => removeMcpRef(index)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          {mcpState.resources.map((resource) => (
            <div
              aria-label={`MCP ${resource.name}`}
              className="resource-row"
              key={resource.name}
              role="group"
            >
              <span className="resource-chip">MCP</span>
              <div className="resource-row__main">
                <span>{resource.name}</span>
                <small>Raw config</small>
                <small>{resource.type}</small>
                <small>{resource.detail}</small>
              </div>
              <strong
                className={`resource-status resource-status--${resource.status.toLowerCase()}`}
              >
                {resource.status}
              </strong>
            </div>
          ))}
        </div>
      </section>

      {activePicker === "skills" ? (
        <div className="preview-modal-backdrop" onClick={closePicker}>
          <section
            aria-label="Add library skills"
            aria-modal="true"
            className="profile-form-dialog resource-picker-dialog"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">
                  Add library skills
                  <InfoTip label="Select shared skills from the global library. Already attached skills stay disabled." />
                </div>
              </div>
            </header>
            <div className="resource-picker-list">
              {librarySkills.length === 0 ? (
                <div className="inline-state">
                  <span className="inline-state__icon" aria-hidden="true" />
                  <span>No library skills available</span>
                </div>
              ) : null}
              {librarySkills.map((skill) => {
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
                    {isAttached ? <em>Already added</em> : null}
                  </label>
                );
              })}
              {librarySkills.length > 0 &&
              librarySkills.every((skill) => attachedSkillIds.has(skill.id)) ? (
                <p className="muted">All library skills are already attached.</p>
              ) : null}
            </div>
            <footer className="preview-actions">
              <button className="secondary-action" type="button" onClick={closePicker}>
                Cancel
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={selectedLibrarySkillIds.length === 0}
                onClick={addSelectedLibrarySkills}
              >
                Add selected skills
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {activePicker === "mcp" ? (
        <div className="preview-modal-backdrop" onClick={closePicker}>
          <section
            aria-label="Add library MCP servers"
            aria-modal="true"
            className="profile-form-dialog resource-picker-dialog"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">
                  Add library MCP servers
                  <InfoTip label="Select reusable MCP server definitions from the global MCP library. Already attached servers stay disabled." />
                </div>
              </div>
            </header>
            <div className="resource-picker-list">
              {mcpServers.length === 0 ? (
                <div className="inline-state">
                  <span className="inline-state__icon" aria-hidden="true" />
                  <span>No library MCP servers available</span>
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
                    {isAttached ? <em>Already added</em> : null}
                  </label>
                );
              })}
              {mcpServers.length > 0 && mcpServers.every((server) => attachedMcpIds.has(server.id)) ? (
                <p className="muted">All library MCP servers are already attached.</p>
              ) : null}
            </div>
            <footer className="preview-actions">
              <button className="secondary-action" type="button" onClick={closePicker}>
                Cancel
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={selectedMcpIds.length === 0}
                onClick={addSelectedMcpServers}
              >
                Add selected MCP servers
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
};
