import { useState } from "react";
import {
  BookOpenText,
  CheckCircle2,
  ExternalLink,
  Folder,
  GitBranch,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Users,
  X
} from "lucide-react";
import type {
  GitHubSkillImportInput,
  ManageTargetSkillInput,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillSourceType,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdateSourceInput
} from "../../shared/types";

interface SkillLibraryPanelProps {
  librarySkills: SkillLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  skillInventory: SkillInventoryEntry[];
  selectedUpdatePlan?: SkillUpdatePlan;
  skillUsage: Record<string, string[]>;
  activeTool?: "import" | "discoveries";
  onCloseTool?(): void;
  onSelectLocalSkillFolder(): Promise<string | undefined>;
  onImportUnmanaged(sourcePath: string): void;
  onImportGitHubSkill(input: GitHubSkillImportInput): void;
  onManageTargetSkill(input: ManageTargetSkillInput): void;
  onSetUpdateSource(input: SkillUpdateSourceInput): void;
  onPreviewLibrarySkillUpdate(id: string): void;
  onUpdateLibrarySkill(id: string): void;
  onUpdateAllLibrarySkills(ids: string[]): void;
  onCheckUpdates(): void;
}

const sourceLabel = (skill: SkillLibraryEntry) => {
  if (skill.sourceType === "github") {
    return skill.source ?? "GitHub source";
  }
  if (skill.sourceType === "local") {
    return skill.source ?? skill.path;
  }
  return skill.source ?? skill.sourceType;
};

const shortRevision = (skill: SkillLibraryEntry) =>
  (skill.remoteRevision ?? skill.contentHash ?? "local").slice(0, 7);

const sourceName = (skill: SkillLibraryEntry) => {
  const source = sourceLabel(skill);
  if (source.startsWith("https://github.com/")) {
    return source.replace("https://github.com/", "").replace("/tree/", "/");
  }
  return source;
};

export const SkillLibraryPanel = ({
  librarySkills,
  skillUpdates,
  skillInventory,
  selectedUpdatePlan,
  skillUsage,
  activeTool,
  onCloseTool,
  onSelectLocalSkillFolder,
  onImportUnmanaged,
  onImportGitHubSkill,
  onManageTargetSkill,
  onSetUpdateSource,
  onPreviewLibrarySkillUpdate,
  onUpdateLibrarySkill,
  onUpdateAllLibrarySkills,
  onCheckUpdates
}: SkillLibraryPanelProps) => {
  const [githubUrl, setGithubUrl] = useState("");
  const [githubId, setGithubId] = useState("");
  const [localSkillPath, setLocalSkillPath] = useState("");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | SkillSourceType>("all");
  const [usageFilter, setUsageFilter] = useState<"all" | "used" | "unused">("all");
  const [targetFilter, setTargetFilter] = useState<
    "all" | SkillInventoryEntry["status"] | "not-installed"
  >("all");
  const [updateFilter, setUpdateFilter] = useState<"all" | "updates">("all");
  const [openActionId, setOpenActionId] = useState<string>();
  const [sourceDrafts, setSourceDrafts] = useState<
    Record<string, { sourceType: SkillSourceType; source: string }>
  >({});
  const updatesById = new Map(skillUpdates.map((update) => [update.id, update]));
  const updateableSkillIds = skillUpdates
    .filter((update) => update.updateAvailable && !update.error)
    .map((update) => update.id);
  const availableUpdateCount = updateableSkillIds.length;
  const installsFor = (libraryId: string) =>
    skillInventory.filter((skill) => skill.libraryId === libraryId || skill.id === libraryId);
  const filteredSkills = librarySkills.filter((skill) => {
    const installs = installsFor(skill.id);
    const usage = skillUsage[skill.id] ?? [];
    const query = search.trim().toLowerCase();
    const matchesSearch =
      query.length === 0 ||
      [skill.id, skill.name, skill.description, sourceLabel(skill)]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query));
    const matchesSource = sourceFilter === "all" || skill.sourceType === sourceFilter;
    const matchesUsage =
      usageFilter === "all" ||
      (usageFilter === "used" ? usage.length > 0 : usage.length === 0);
    const matchesTarget =
      targetFilter === "all" ||
      (targetFilter === "not-installed"
        ? installs.length === 0
        : installs.some((install) => install.status === targetFilter));
    const matchesUpdate =
      updateFilter === "all" || Boolean(updatesById.get(skill.id)?.updateAvailable);

    return matchesSearch && matchesSource && matchesUsage && matchesTarget && matchesUpdate;
  });
  const resetFilters = () => {
    setSearch("");
    setSourceFilter("all");
    setUsageFilter("all");
    setTargetFilter("all");
    setUpdateFilter("all");
  };
  const hasActiveFilters =
    search.trim().length > 0 ||
    sourceFilter !== "all" ||
    usageFilter !== "all" ||
    targetFilter !== "all" ||
    updateFilter !== "all";
  const usedSkillCount = librarySkills.filter((skill) => (skillUsage[skill.id] ?? []).length > 0).length;
  const unusedSkillCount = Math.max(librarySkills.length - usedSkillCount, 0);

  const importGitHubSkill = () => {
    const url = githubUrl.trim();
    if (!url) {
      return;
    }
    onImportGitHubSkill({
      url,
      id: githubId.trim() || undefined
    });
    setGithubUrl("");
    setGithubId("");
  };

  const importLocalSkill = () => {
    const sourcePath = localSkillPath.trim();
    if (!sourcePath) {
      return;
    }
    onImportUnmanaged(sourcePath);
    setLocalSkillPath("");
  };

  const selectLocalSkillFolder = async () => {
    const sourcePath = await onSelectLocalSkillFolder();
    if (sourcePath) {
      setLocalSkillPath(sourcePath);
    }
  };

  return (
    <section className="skill-library-panel" aria-label="Skill library">
      <div className="library-control-deck">
        <div className="library-quick-tabs" role="tablist" aria-label="Skill status filters">
          <button
            className={`library-quick-tab${updateFilter === "all" && usageFilter === "all" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={updateFilter === "all" && usageFilter === "all"}
            onClick={() => {
              setUpdateFilter("all");
              setUsageFilter("all");
            }}
          >
            All <strong>{librarySkills.length}</strong>
          </button>
          <button
            className={`library-quick-tab${updateFilter === "updates" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={updateFilter === "updates"}
            onClick={() => setUpdateFilter("updates")}
          >
            Updates <strong>{availableUpdateCount}</strong>
          </button>
          <button
            className={`library-quick-tab${usageFilter === "used" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={usageFilter === "used"}
            onClick={() => {
              setUsageFilter("used");
              setUpdateFilter("all");
            }}
          >
            In use <strong>{usedSkillCount}</strong>
          </button>
          <button
            className={`library-quick-tab${usageFilter === "unused" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={usageFilter === "unused"}
            onClick={() => {
              setUsageFilter("unused");
              setUpdateFilter("all");
            }}
          >
            Unused <strong>{unusedSkillCount}</strong>
          </button>
        </div>
        <div className="library-toolbar">
          <label className="library-search">
            <span>Search</span>
            <Search size={16} strokeWidth={2.1} aria-hidden="true" />
            <input
              aria-label="Search skills"
              placeholder="Search skill name or description..."
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </label>
          {hasActiveFilters ? (
            <button className="secondary-action" type="button" onClick={resetFilters}>
              <RotateCcw size={15} strokeWidth={2.2} />
              Reset filters
            </button>
          ) : null}
          <select
            aria-label="Skill source filter"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.currentTarget.value as typeof sourceFilter)}
          >
            <option value="all">Source: All</option>
            <option value="github">GitHub</option>
            <option value="local">Local</option>
          </select>
          <select
            aria-label="Skill target filter"
            value={targetFilter}
            onChange={(event) => setTargetFilter(event.currentTarget.value as typeof targetFilter)}
          >
            <option value="all">Target: All</option>
            <option value="managed">Managed</option>
            <option value="library">Imported</option>
            <option value="unmanaged">Unmanaged</option>
            <option value="not-installed">Not installed</option>
          </select>
          <button className="secondary-action" type="button" onClick={onCheckUpdates}>
            <RefreshCw size={15} strokeWidth={2.2} />
            Check updates
          </button>
          <button
            className="secondary-action"
            type="button"
            aria-label="Update all skills"
            disabled={updateableSkillIds.length === 0}
            onClick={() => onUpdateAllLibrarySkills(updateableSkillIds)}
          >
            <Sparkles size={15} strokeWidth={2.2} />
            Update all
          </button>
        </div>
      </div>

      <section className="library-table" aria-label="Library skills">
        <div className="library-table__head">
          <span>Skill</span>
          <span>Source</span>
          <span>Version</span>
          <span>Update status</span>
          <span>Usage</span>
          <span>Installs</span>
          <span>Actions</span>
        </div>
        <div className="library-table__body">
          {librarySkills.length === 0 ? (
            <p className="muted library-empty">Import a skill from a folder or GitHub to start the library.</p>
          ) : null}
          {librarySkills.length > 0 && filteredSkills.length === 0 ? (
            <p className="muted library-empty">No skills match the current filters.</p>
          ) : null}
          {filteredSkills.map((skill) => {
            const updateInfo = updatesById.get(skill.id);
            const installs = installsFor(skill.id);
            const sourceDraft = sourceDrafts[skill.id] ?? {
              sourceType: skill.sourceType,
              source: sourceLabel(skill)
            };
            const updateLabel = updateInfo?.error
              ? "Check failed"
              : updateInfo?.updateAvailable
                ? "Update available"
                : updateInfo
                  ? "Up to date"
                  : skill.sourceType === "local"
                    ? "Local source"
                    : skill.sourceType;
            const hasUpdate = Boolean(updateInfo?.updateAvailable);
            const hasError = Boolean(updateInfo?.error);
            return (
              <div
                aria-label={`Library item ${skill.id}`}
                className="library-table-row"
                key={skill.id}
                role="group"
              >
                <div className="library-resource-cell">
                  <span className="resource-avatar" aria-hidden="true">
                    <BookOpenText size={18} strokeWidth={2.2} />
                  </span>
                  <div className="skill-title-stack">
                    <strong className="skill-title">{skill.name}</strong>
                    <p className="skill-description" title={skill.description || skill.id}>
                      {skill.description || skill.id}
                    </p>
                  </div>
                </div>
                <div className="library-source-cell">
                  <span className={`resource-chip resource-chip--${skill.sourceType}`}>
                    {skill.sourceType === "github" ? (
                      <GitBranch size={13} strokeWidth={2.2} />
                    ) : (
                      <Folder size={13} strokeWidth={2.2} />
                    )}
                    {skill.sourceType === "github" ? "GitHub" : "Local"}
                  </span>
                  <small title={sourceLabel(skill)}>{sourceName(skill)}</small>
                </div>
                <div className="library-version-cell">
                  <strong>{skill.remoteRef ?? "v1.0.0"}</strong>
                  <small>{shortRevision(skill)}</small>
                </div>
                <div className="library-update-cell">
                  <strong
                    className={`resource-status${hasUpdate ? " is-warning" : ""}${
                      hasError ? " is-error" : ""
                    }`}
                  >
                    {hasError ? (
                      <TriangleAlert size={13} strokeWidth={2.2} />
                    ) : hasUpdate ? (
                      <Sparkles size={13} strokeWidth={2.2} />
                    ) : (
                      <CheckCircle2 size={13} strokeWidth={2.2} />
                    )}
                    {updateLabel}
                  </strong>
                  {updateInfo?.latestRevision ? (
                    <small>
                      {updateInfo.latestRevision.slice(0, 7)} {hasUpdate ? "available" : "current"}
                    </small>
                  ) : null}
                </div>
                <div className="library-usage-cell">
                  <strong className="usage-summary">
                    <Users size={13} strokeWidth={2.2} />
                    {(skillUsage[skill.id] ?? []).length || 0} profiles
                  </strong>
                  <small>
                    {(skillUsage[skill.id] ?? []).length > 0
                      ? (skillUsage[skill.id] ?? []).join(", ")
                      : "Not used"}
                  </small>
                </div>
                <div className="library-installs-cell">
                  {installs.length === 0 ? <small>Not installed</small> : null}
                  {installs.slice(0, 3).map((install) => (
                    <span key={install.path}>
                      {install.foundIn.join(", ")}
                      <strong className={`resource-chip resource-chip--${install.status}`}>
                        <SlidersHorizontal size={13} strokeWidth={2.2} />
                        {install.status === "managed"
                          ? "Managed"
                          : install.status === "library"
                            ? "Imported"
                            : "Unmanaged"}
                      </strong>
                    </span>
                  ))}
                </div>
                <div className="library-actions-cell">
                  <button
                    className="icon-action"
                    type="button"
                    aria-label={`Preview update ${skill.id}`}
                    onClick={() => onPreviewLibrarySkillUpdate(skill.id)}
                  >
                    <ExternalLink size={15} strokeWidth={2.2} />
                  </button>
                  <div className="row-action-menu">
                    <button
                      className="icon-action"
                      type="button"
                      aria-label={`More actions for ${skill.id}`}
                      onClick={() => setOpenActionId(openActionId === skill.id ? undefined : skill.id)}
                    >
                      <MoreHorizontal size={16} strokeWidth={2.2} />
                    </button>
                    {openActionId === skill.id ? (
                      <div className="row-action-popover">
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => onPreviewLibrarySkillUpdate(skill.id)}
                      >
                        <ExternalLink size={14} strokeWidth={2.2} />
                        Preview update
                      </button>
                      <div className="row-action-source">
                        <div className="row-action-source-title">
                          <Settings2 size={14} strokeWidth={2.2} />
                          Source and actions
                        </div>
                        <div className="library-source-editor row-action-source-editor">
                          <select
                            aria-label={`Update source type for ${skill.id}`}
                            value={sourceDraft.sourceType}
                            onChange={(event) =>
                              setSourceDrafts({
                                ...sourceDrafts,
                                [skill.id]: {
                                  ...sourceDraft,
                                  sourceType: event.currentTarget.value as SkillSourceType
                                }
                              })
                            }
                          >
                            <option value="local">Local folder</option>
                            <option value="github">GitHub directory</option>
                          </select>
                          <input
                            aria-label={`Update source for ${skill.id}`}
                            placeholder={
                              sourceDraft.sourceType === "github"
                                ? "https://github.com/owner/repo/tree/main/path/to/skill"
                                : "/path/to/skill"
                            }
                            value={sourceDraft.source}
                            onChange={(event) =>
                              setSourceDrafts({
                                ...sourceDrafts,
                                [skill.id]: { ...sourceDraft, source: event.currentTarget.value }
                              })
                            }
                          />
                          <button
                            className="secondary-action"
                            type="button"
                            disabled={!sourceDraft.source.trim()}
                            onClick={() =>
                              onSetUpdateSource({
                                id: skill.id,
                                sourceType: sourceDraft.sourceType,
                                source: sourceDraft.source.trim()
                              })
                            }
                          >
                            Save source for {skill.id}
                          </button>
                        </div>
                      </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                {selectedUpdatePlan?.id === skill.id ? (
                  <section
                    className="library-update-preview"
                    aria-label={`Update preview for ${skill.id}`}
                  >
                    <div>
                      <strong>
                        {selectedUpdatePlan.errors.length > 0
                          ? "Update source needs attention"
                          : selectedUpdatePlan.updateAvailable
                            ? `${selectedUpdatePlan.changes.length} file change${
                                selectedUpdatePlan.changes.length === 1 ? "" : "s"
                              }`
                            : "No file changes"}
                      </strong>
                      <small>
                        {selectedUpdatePlan.latestRevision
                          ? `${selectedUpdatePlan.currentRevision ?? "current"} -> ${
                              selectedUpdatePlan.latestRevision
                            }`
                          : selectedUpdatePlan.source ?? "No source"}
                      </small>
                    </div>
                    {selectedUpdatePlan.errors.map((item) => (
                      <p className="error" key={item}>
                        {item}
                      </p>
                    ))}
                    {selectedUpdatePlan.changes.length > 0 ? (
                      <div className="update-change-list">
                        {selectedUpdatePlan.changes.map((change) => (
                          <details key={change.path}>
                            <summary>{change.path}</summary>
                            <pre>{change.diff}</pre>
                          </details>
                        ))}
                      </div>
                    ) : null}
                    <button
                      className="primary-action"
                      type="button"
                      aria-label={`Apply update ${skill.id}`}
                      disabled={
                        selectedUpdatePlan.errors.length > 0 ||
                        selectedUpdatePlan.changes.length === 0
                      }
                      onClick={() => onUpdateLibrarySkill(skill.id)}
                    >
                      Apply update
                    </button>
                  </section>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {activeTool === "discoveries" ? (
        <section className="library-drawer" aria-label="Environment skills">
          <div className="library-drawer__header">
            <div>
              <strong>Target discoveries</strong>
              <p className="muted">Skills detected on targets that may need import or management.</p>
            </div>
            <button className="icon-action" type="button" aria-label="Close library tool" onClick={onCloseTool}>
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>
        <section className="resource-section target-discovery-section">
          <div>
            <div className="resource-heading">Target discoveries</div>
            <p className="muted">Skills detected on targets that may need import or management.</p>
          </div>
          <div className="resource-list resource-list--unmanaged">
            {skillInventory.length === 0 ? (
              <p className="muted library-empty">
                No target skills detected. Install skills into a supported target and scan again.
              </p>
            ) : null}
            {skillInventory.map((skill) => (
              <div
                aria-label={`Environment skill ${skill.id}`}
                className="resource-row"
                key={skill.path}
                role="group"
              >
                <span className={`resource-chip resource-chip--${skill.status}`}>
                  {skill.status === "managed"
                    ? "Managed"
                    : skill.status === "library"
                      ? "Imported"
                      : "Unmanaged"}
                </span>
                <div className="resource-row__main">
                  <span>{skill.name}</span>
                  <small>{skill.description || skill.id}</small>
                  <small title={skill.path}>
                    {skill.foundIn.join(", ")}
                    {skill.libraryId ? ` · ${skill.libraryId}` : ""} · {skill.path}
                  </small>
                </div>
                {skill.status === "library" && skill.libraryId ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() =>
                      onManageTargetSkill({
                        targetId: skill.foundIn[0] ?? "",
                        targetName: skill.id,
                        libraryId: skill.libraryId ?? skill.id
                      })
                    }
                  >
                    Manage {skill.id}
                  </button>
                ) : null}
                {skill.status === "unmanaged" ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => onImportUnmanaged(skill.path)}
                  >
                    Import {skill.id}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        </section>
      ) : null}

      {activeTool === "import" ? (
        <section className="library-drawer" aria-label="GitHub skill import">
          <div className="library-drawer__header">
            <div>
              <strong>Import Skill</strong>
              <p className="muted">Import a local skill folder or track a GitHub skill directory.</p>
            </div>
            <button className="icon-action" type="button" aria-label="Close library tool" onClick={onCloseTool}>
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>
          <section className="resource-section library-import-panel">
            <div>
              <div className="resource-heading">Import from local folder</div>
              <p className="muted">Choose an existing skill folder that contains a SKILL.md file.</p>
            </div>
            <div className="library-import-grid">
              <label>
                <span>Selected folder</span>
                <input
                  aria-label="Local skill folder path"
                  placeholder="No folder selected"
                  readOnly
                  value={localSkillPath}
                />
              </label>
              <button
                className="secondary-action"
                aria-label="Choose local skill folder"
                type="button"
                onClick={() => {
                  void selectLocalSkillFolder();
                }}
              >
                Choose folder
              </button>
              <button
                className="primary-action library-import-action"
                type="button"
                disabled={!localSkillPath.trim()}
                onClick={importLocalSkill}
              >
                Import local skill
              </button>
            </div>
          </section>
      <section className="resource-section library-import-panel">
        <div>
          <div className="resource-heading">Import from GitHub directory</div>
          <p className="muted">
            Paste a public GitHub skill folder URL. AgentEnv tracks the directory revision for
            future updates.
          </p>
        </div>
        <div className="library-import-grid">
          <label>
            <span>GitHub URL</span>
            <input
              aria-label="GitHub skill URL"
              placeholder="https://github.com/owner/repo/tree/main/path/to/skill"
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Library ID</span>
            <input
              aria-label="GitHub skill library id"
              placeholder="Optional"
              value={githubId}
              onChange={(event) => setGithubId(event.currentTarget.value)}
            />
          </label>
          <button
            className="primary-action library-import-action"
            type="button"
            disabled={!githubUrl.trim()}
            onClick={importGitHubSkill}
          >
            Import from GitHub
          </button>
        </div>
      </section>
        </section>
      ) : null}
    </section>
  );
};
