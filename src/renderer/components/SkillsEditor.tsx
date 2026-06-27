import { useState } from "react";
import {
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser";
import type { ActivationPreview, AssetPolicy, TargetInfo } from "../../shared/types";

interface SkillsEditorProps {
  value: AssetPolicy;
  configText: string;
  configLanguage?: TargetInfo["configLanguage"];
  preview?: ActivationPreview;
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
    return { type, detail: server.command };
  }
  return { type, detail: "configured" };
};

const getMcpResources = (
  configText: string,
  configLanguage: TargetInfo["configLanguage"] | undefined,
  preview: ActivationPreview | undefined
): { resources: McpResource[]; error?: string; note?: string } => {
  if (configLanguage !== "jsonc") {
    return {
      resources: [],
      note: "MCP resources are listed here for JSONC targets. Preview still validates this profile."
    };
  }

  const errors: ParseError[] = [];
  const parsed = parseJsonc(configText.trim().length > 0 ? configText : "{}", errors, {
    allowTrailingComma: true
  });
  if (errors.length > 0) {
    return {
      resources: [],
      error: errors.map((error) => printParseErrorCode(error.error)).join(", ")
    };
  }
  if (!isRecord(parsed)) {
    return { resources: [] };
  }
  const mcp = isRecord(parsed.mcp)
    ? parsed.mcp
    : isRecord(parsed.mcpServers)
      ? parsed.mcpServers
      : undefined;
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
  onChange
}: SkillsEditorProps) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const skillEntries = value.ownedDirs
    .map((ownedDir, index) => ({ ownedDir, index }))
    .filter((entry) => entry.ownedDir.kind === "skill");
  const mcpState = getMcpResources(configText, configLanguage, preview);
  const hasResources = skillEntries.length > 0 || mcpState.resources.length > 0;

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
