import { useState } from "react";
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

const defaultSkill = {
  kind: "skill" as const,
  source: "skills/new-skill",
  targetName: "agentenv-new-skill"
};

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
  const firstLibrarySkill = librarySkills[0];
  const firstMcpServer = mcpServers[0];

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

  const addLibrarySkill = () => {
    const libraryId = firstLibrarySkill?.id ?? "shared-skill";
    onChange({
      ...value,
      skillRefs: (value.skillRefs ?? []).concat({
        libraryId,
        targetName: `agentenv-${libraryId}`
      })
    });
  };

  const addLibraryMcp = () => {
    const libraryId = firstMcpServer?.id ?? "shared-mcp";
    onChange({
      ...value,
      mcpRefs: (value.mcpRefs ?? []).concat({
        libraryId,
        targetName: libraryId
      })
    });
  };

  return (
    <section className="skills-editor" aria-label="Resources">
      <div className="asset-editor-header">
        <div>
          <div className="section-title">Resources</div>
          <p className="muted">Skills and MCP servers managed by this profile.</p>
        </div>
        <div className="asset-editor-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={() =>
              onChange({ ...value, ownedDirs: value.ownedDirs.concat(defaultSkill) })
            }
          >
            Add skill
          </button>
          <button className="secondary-action" type="button" onClick={addLibrarySkill}>
            Add library skill
          </button>
          <button className="secondary-action" type="button" onClick={addLibraryMcp}>
            Add library MCP
          </button>
          <button
            aria-expanded={advancedOpen}
            className="secondary-action"
            type="button"
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            Advanced
          </button>
        </div>
      </div>

      <section className="resource-section" aria-label="Resource inventory">
        <div>
          <div className="resource-heading">Inventory</div>
          <p className="muted">Review what this environment switches before previewing.</p>
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
                <strong className="resource-status">Configured</strong>
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
                <strong className="resource-status">Configured</strong>
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

      {advancedOpen ? (
        <label className="field-block resource-section--advanced">
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
      ) : null}
    </section>
  );
};
