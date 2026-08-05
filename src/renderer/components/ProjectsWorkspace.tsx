import {
  AlertTriangle,
  BookOpen,
  Eye,
  ExternalLink,
  FileText,
  FilePlus2,
  FolderGit2,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Trash2
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectSummary } from "../../shared/types";
import type {
  ProjectEnvironmentPreview,
  ProjectEnvironmentSnapshot,
  ProjectResourceKind,
  ProjectResourceSummary,
  SkillLibraryEntry,
  TargetInfo
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { InfoTip } from "./InfoTip";
import { ProjectEnvironmentPreviewDialog } from "./ProjectEnvironmentPreviewDialog";
import { ProjectRecoveryDialog } from "./ProjectRecoveryDialog";
import {
  ProjectResourceEditorDialog,
  type ProjectEditorGuard
} from "./ProjectResourceEditorDialog";
import {
  ActionMenu,
  Button,
  focusInitialActionMenuItem,
  IconButton,
  ModalFrame,
  Notice,
  PageHeader,
  ResourceRow
} from "./ui";

type ProjectOperation = "add" | "refresh" | "rename" | "remove" | "add-skill" | "remove-skill" | "inspect" | "open" | "preview";
type ProjectMenuState = { projectId: string; left: number; top: number };

export const ProjectsWorkspace = ({
  targets,
  onEditorGuardChange,
  openRequest,
  editorGuardPromptOpen = false
}: {
  targets: TargetInfo[];
  onEditorGuardChange?(guard?: ProjectEditorGuard): void;
  openRequest?: { requestId: number; projectId: string };
  editorGuardPromptOpen?: boolean;
}) => {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [operation, setOperation] = useState<ProjectOperation>();
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState>();
  const [removeCandidate, setRemoveCandidate] = useState<ProjectSummary>();
  const [snapshot, setSnapshot] = useState<ProjectEnvironmentSnapshot>();
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<ProjectEnvironmentPreview>();
  const [previewError, setPreviewError] = useState("");
  const [editorRequest, setEditorRequest] = useState<{
    resourceId?: string;
    agentId?: string;
  }>();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const [librarySkills, setLibrarySkills] = useState<SkillLibraryEntry[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState("");
  const [skillAgentId, setSkillAgentId] = useState("");
  const [removeSkillCandidate, setRemoveSkillCandidate] = useState<ProjectResourceSummary>();
  const removeDialogRef = useRef<HTMLElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const renameDialogRef = useRef<HTMLElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skillDialogRef = useRef<HTMLElement>(null);
  const skillSelectRef = useRef<HTMLSelectElement>(null);
  const removeSkillDialogRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuReturnFocusRef = useRef<HTMLElement | null>(null);

  const selected = projects.find((project) => project.id === selectedId) ?? projects[0];
  const availableTargets = targets.filter((target) => Boolean(target.health.executablePath));
  const selectedAgent = availableTargets.find((target) => target.id === selectedAgentId)
    ?? availableTargets[0];
  const selectedAgentSupport = snapshot?.agentSupport.find(
    (support) => support.agentId === selectedAgent?.id
  );
  const skillAgents = availableTargets.filter((target) =>
    snapshot?.agentSupport.some((support) =>
      support.agentId === target.id && support.skills.mutate === "supported"
    )
  );

  const refresh = async (refreshEnvironment = false) => {
    setOperation("refresh");
    setError("");
    try {
      const next = await window.agentEnv.listProjects();
      setProjects(next);
      const nextSelectedId = selectedId && next.some((project) => project.id === selectedId)
        ? selectedId
        : next[0]?.id;
      setSelectedId(nextSelectedId);
      if (refreshEnvironment) {
        const nextSelected = next.find((project) => project.id === nextSelectedId);
        setSnapshot(nextSelected?.exists
          ? await window.agentEnv.inspectProject(nextSelected.id)
          : undefined);
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!openRequest) return;
    setSelectedId(openRequest.projectId);
  }, [openRequest?.requestId, openRequest?.projectId]);

  useEffect(() => {
    if (!selected) {
      setSnapshot(undefined);
      return;
    }
    setSelectedAgentId((current) =>
      availableTargets.some((target) => target.id === current)
        ? current
        : availableTargets.some((target) => target.id === selected.lastAgentId)
          ? selected.lastAgentId
          : availableTargets[0]?.id
    );
    if (!selected.exists) {
      setSnapshot(undefined);
      return;
    }
    let current = true;
    setOperation("inspect");
    setError("");
    void window.agentEnv.inspectProject(selected.id)
      .then((next) => {
        if (current) setSnapshot(next);
      })
      .catch((unknownError) => {
        if (current) setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      })
      .finally(() => {
        if (current) setOperation((value) => value === "inspect" ? undefined : value);
      });
    return () => {
      current = false;
    };
  }, [selected?.id, selected?.exists]);

  useModalDialog({
    open: Boolean(removeCandidate),
    dialogRef: removeDialogRef,
    initialFocusRef: removeButtonRef,
    onDismiss: () => setRemoveCandidate(undefined),
    dismissDisabled: operation === "remove"
  });

  useLayoutEffect(() => {
    if (!projectMenu) return;
    focusInitialActionMenuItem(menuRef.current);
  }, [projectMenu]);

  useEffect(() => {
    if (!projectMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !menuTriggerRef.current?.contains(event.target)
      ) setProjectMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProjectMenu(undefined);
      menuReturnFocusRef.current?.focus({ preventScroll: true });
    };
    const dismissForViewportChange = () => setProjectMenu(undefined);
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismissForViewportChange);
    window.addEventListener("scroll", dismissForViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismissForViewportChange);
      window.removeEventListener("scroll", dismissForViewportChange, true);
    };
  }, [projectMenu]);
  useModalDialog({
    open: skillDialogOpen,
    dialogRef: skillDialogRef,
    initialFocusRef: skillSelectRef,
    onDismiss: () => setSkillDialogOpen(false),
    dismissDisabled: operation === "add-skill"
  });
  useModalDialog({
    open: Boolean(removeSkillCandidate),
    dialogRef: removeSkillDialogRef,
    onDismiss: () => setRemoveSkillCandidate(undefined),
    dismissDisabled: operation === "remove-skill"
  });

  useModalDialog({
    open: renameOpen,
    dialogRef: renameDialogRef,
    initialFocusRef: renameInputRef,
    onDismiss: () => setRenameOpen(false),
    dismissDisabled: operation === "rename"
  });

  const addProject = async () => {
    setOperation("add");
    setError("");
    try {
      const path = await window.agentEnv.selectProjectFolder();
      if (!path) return;
      const added = await window.agentEnv.addProject(path);
      const next = await window.agentEnv.listProjects();
      setProjects(next);
      setSelectedId(added.id);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const removeReference = async () => {
    if (!removeCandidate) return;
    setOperation("remove");
    setModalError("");
    try {
      await window.agentEnv.removeProject(removeCandidate.id);
      setRemoveCandidate(undefined);
      await refresh();
    } catch (unknownError) {
      setModalError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setOperation(undefined);
    }
  };

  const renameProject = async () => {
    if (!selected || !renameValue.trim()) return;
    setOperation("rename");
    setModalError("");
    try {
      await window.agentEnv.updateProject({ id: selected.id, name: renameValue.trim() });
      setRenameOpen(false);
      await refresh();
    } catch (unknownError) {
      setModalError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setOperation(undefined);
    }
  };

  const openAddSkill = async () => {
    setError("");
    setModalError("");
    try {
      const next = (await window.agentEnv.listSkillLibrary())
        .filter((skill) => skill.globallyEnabled !== false);
      setLibrarySkills(next);
      setSelectedLibraryId(next[0]?.id ?? "");
      setSkillAgentId(
        skillAgents.some((agent) => agent.id === selectedAgent?.id)
          ? selectedAgent!.id
          : skillAgents[0]?.id ?? ""
      );
      setSkillDialogOpen(true);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  const showProjectMenu = (
    project: ProjectSummary,
    left: number,
    top: number,
    returnFocus: HTMLElement
  ) => {
    const width = 184;
    const estimatedHeight = 124;
    setSelectedId(project.id);
    menuReturnFocusRef.current = returnFocus;
    setProjectMenu({
      projectId: project.id,
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - estimatedHeight - 8))
    });
  };

  const runProjectMenuAction = (
    project: ProjectSummary,
    action: "rename" | "recovery" | "remove"
  ) => {
    setProjectMenu(undefined);
    setModalError("");
    setSelectedId(project.id);
    if (action === "rename") {
      setRenameValue(project.name);
      setRenameOpen(true);
      return;
    }
    if (action === "recovery") {
      setRecoveryOpen(true);
      return;
    }
    setRemoveCandidate(project);
  };

  const addSkill = async () => {
    if (!selected || !selectedLibraryId || !skillAgentId) return;
    setOperation("add-skill");
    setModalError("");
    try {
      await window.agentEnv.addProjectSkill({
        projectId: selected.id,
        agentId: skillAgentId,
        libraryId: selectedLibraryId
      });
      setSkillDialogOpen(false);
      await refreshSelectedProject();
    } catch (unknownError) {
      setModalError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const removeSkill = async () => {
    if (!selected || !removeSkillCandidate?.contentHash) return;
    setOperation("remove-skill");
    setModalError("");
    try {
      await window.agentEnv.removeProjectSkill({
        projectId: selected.id,
        resourceId: removeSkillCandidate.id,
        expectedHash: removeSkillCandidate.contentHash
      });
      setRemoveSkillCandidate(undefined);
      await refreshSelectedProject();
    } catch (unknownError) {
      setModalError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const openProject = async () => {
    if (!selected || !selectedAgent) return;
    setOperation("open");
    setError("");
    try {
      await window.agentEnv.openProject(selected.id, selectedAgent.id);
      const next = await window.agentEnv.listProjects();
      setProjects(next);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const openPreview = async () => {
    if (!selected || !selectedAgent) return;
    setPreviewOpen(true);
    setPreview(undefined);
    setPreviewError("");
    setOperation("preview");
    try {
      setPreview(await window.agentEnv.previewProject(selected.id, selectedAgent.id));
    } catch (unknownError) {
      setPreviewError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const resourcesByKind = (kind: ProjectResourceKind) =>
    snapshot?.resources.filter((resource) => resource.kind === kind) ?? [];

  const canCreateInstruction = Boolean(
    selectedAgent &&
    selectedAgentSupport?.instructions.mutate === "supported" &&
    selectedAgentSupport.instructionCreateFile &&
    !resourcesByKind("instructions").some((resource) =>
      resource.consumerAgentIds.includes(selectedAgent.id) &&
      resource.relativePath.replaceAll("\\", "/") === selectedAgentSupport.instructionCreateFile
    )
  );

  const refreshSelectedProject = async () => {
    if (!selected?.exists) return;
    setSnapshot(await window.agentEnv.inspectProject(selected.id));
  };

  return (
    <section className="projects-page" aria-label={t("Projects")}>
      <PageHeader
        className="projects-page-header"
        title={t("Projects")}
        help={<InfoTip label={t("Manage the Agent resources in your recurring project folders.")} />}
        actions={(
          <div className="projects-page-actions">
            <Button
              aria-label={t("Refresh Projects")}
              busy={operation === "refresh"}
              icon={<RefreshCw size={15} />}
              onClick={() => void refresh(true)}
            >
              {t("Refresh")}
            </Button>
            <Button
              variant="primary"
              busy={operation === "add"}
              icon={<Plus size={15} />}
              onClick={() => void addProject()}
            >
              {t("Add Project")}
            </Button>
          </div>
        )}
      />

      {error ? (
        <Notice
          className="project-scoped-error"
          icon={<AlertTriangle size={15} />}
          role="alert"
          title={t("Could not complete this step")}
          tone="danger"
        >
          {error}
        </Notice>
      ) : null}

      <div className="projects-workbench ui-surface-frame">
        <aside className="project-index" aria-label={t("Project list")}>
          {projects.length === 0 && operation !== "refresh" ? (
            <div className="project-empty-list">
              <FolderGit2 size={22} strokeWidth={1.8} aria-hidden="true" />
              <strong>{t("No Projects yet")}</strong>
              <span>{t("Add a folder you return to often.")}</span>
            </div>
          ) : null}
          {projects.map((project) => (
            <button
              className={`project-row${selected?.id === project.id ? " is-active" : ""}`}
              key={project.id}
              type="button"
              onClick={() => setSelectedId(project.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                showProjectMenu(project, event.clientX, event.clientY, event.currentTarget);
              }}
            >
              <span className="project-row__icon" aria-hidden="true">
                <FolderGit2 size={17} strokeWidth={2} />
              </span>
              <span className="project-row__copy">
                <strong>{project.name}</strong>
                <span title={project.rootPath}>{project.rootPath}</span>
              </span>
              {!project.exists ? <small>{t("Folder missing")}</small> : null}
            </button>
          ))}
        </aside>

        <section className="project-detail" aria-label={selected ? selected.name : t("Project detail")}>
          {selected ? (
            <>
              <header className="project-detail__header">
                <div className="project-detail__identity">
                  <span className="project-detail__icon" aria-hidden="true">
                    <FolderGit2 size={20} strokeWidth={1.9} />
                  </span>
                  <div>
                    <h3>{selected.name}</h3>
                    <span className="selectable" title={selected.rootPath}>{selected.rootPath}</span>
                  </div>
                </div>
                <div className="project-detail__actions">
                  <Button
                    aria-label={t("Preview environment")}
                    icon={<Eye size={15} />}
                    busy={operation === "preview"}
                    disabled={!selected.exists || !selectedAgent}
                    onClick={() => void openPreview()}
                  >
                    {t("Preview")}
                  </Button>
                  <label className="project-agent-select">
                    <span className="ui-visually-hidden">{t("Agent")}</span>
                    <select
                      aria-label={t("Agent")}
                      value={selectedAgent?.id ?? ""}
                      disabled={availableTargets.length === 0}
                      onChange={(event) => setSelectedAgentId(event.target.value)}
                    >
                      {availableTargets.map((target) => (
                        <option value={target.id} key={target.id}>{target.name}</option>
                      ))}
                    </select>
                  </label>
                  <Button
                    aria-label={selectedAgent
                      ? t("Open in {{name}}", { name: selectedAgent.name })
                      : t("No Agent available")}
                    variant="primary"
                    icon={<ExternalLink size={15} />}
                    busy={operation === "open"}
                    disabled={!selected.exists || !selectedAgent}
                    onClick={() => void openProject()}
                  >
                    {t("Open")}
                  </Button>
                  <div className="project-actions-menu-wrap">
                    <IconButton
                      ref={menuTriggerRef}
                      label={t("More Project actions")}
                      aria-expanded={projectMenu?.projectId === selected.id}
                      aria-haspopup="menu"
                      onClick={(event) => {
                        if (projectMenu?.projectId === selected.id) {
                          setProjectMenu(undefined);
                          return;
                        }
                        const rect = event.currentTarget.getBoundingClientRect();
                        showProjectMenu(
                          selected,
                          rect.right - 184,
                          rect.bottom + 6,
                          event.currentTarget
                        );
                      }}
                    >
                      <MoreHorizontal size={17} />
                    </IconButton>
                  </div>
                </div>
              </header>
              {!selected.exists ? (
                <div className="project-missing-state">
                  <strong>{t("Project folder is unavailable")}</strong>
                  <span>{t("The reference is kept. Reconnect the folder or remove the reference.")}</span>
                </div>
              ) : (
                <div className="project-resource-groups">
                  {([
                    ["instructions", t("Instructions"), <FileText size={17} aria-hidden="true" />],
                    ["skill", t("Skills"), <BookOpen size={17} aria-hidden="true" />],
                    ["mcp", t("MCPs"), <Plug size={17} aria-hidden="true" />]
                  ] as const).map(([kind, label, icon]) => {
                    const resources = resourcesByKind(kind);
                    return (
                      <section className="project-resource-section" key={kind}>
                        <header className="project-resource-row">
                          {icon}
                          <span>
                            <strong>{label}</strong>
                            <small>
                              {operation === "inspect"
                                ? t("Reading…")
                                : t("{{count}} resources", { count: resources.length })}
                            </small>
                          </span>
                          {kind === "instructions" && canCreateInstruction ? (
                            <Button
                              size="compact"
                              icon={<FilePlus2 size={13} />}
                              onClick={() => setEditorRequest({ agentId: selectedAgent!.id })}
                            >
                              {t("Add instruction")}
                            </Button>
                          ) : kind === "skill" && skillAgents.length > 0 ? (
                            <Button size="compact" icon={<Plus size={13} />} onClick={() => void openAddSkill()}>
                              {t("Add from Library")}
                            </Button>
                          ) : null}
                        </header>
                        {resources.map((resource) => (
                          <ResourceRow
                            className="project-resource-entry"
                            density="compact"
                            description={<span title={resource.absolutePath}>{resource.relativePath}</span>}
                            icon={icon}
                            key={resource.id}
                            state={resource.consumerAgentIds
                              .map((agentId) => targets.find((target) => target.id === agentId)?.name ?? agentId)
                              .join(" · ")}
                            title={resource.kind === "instructions" && resource.editable ? (
                              <button
                                className="project-resource-item__edit"
                                type="button"
                                onClick={() => setEditorRequest({ resourceId: resource.id })}
                              >
                                <span>{resource.name}</span>
                                <Pencil size={13} aria-hidden="true" />
                              </button>
                            ) : resource.name}
                            actions={resource.kind === "skill" && resource.editable ? (
                              <IconButton
                                size="compact"
                                label={t("Remove {{name}} from Project", { name: resource.name })}
                                onClick={() => {
                                  setModalError("");
                                  setRemoveSkillCandidate(resource);
                                }}
                              >
                                <Trash2 size={14} />
                              </IconButton>
                            ) : undefined}
                          />
                        ))}
                      </section>
                    );
                  })}
                  {snapshot?.partial ? (
                    <div className="project-partial-note">
                      {t("Some Agent sources are partial or unavailable.")}
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <div className="project-empty-detail">
              <FolderGit2 size={28} strokeWidth={1.7} aria-hidden="true" />
              <strong>{t("Add a Project to inspect its Agent environment")}</strong>
              <span>{t("AgentEnv stores only the folder reference until you choose an explicit resource action.")}</span>
            </div>
          )}
        </section>
      </div>

      {projectMenu ? (() => {
        const menuProject = projects.find((project) => project.id === projectMenu.projectId);
        if (!menuProject) return null;
        return createPortal(
          <ActionMenu
            ariaLabel={t("Project actions")}
            className="project-actions-menu"
            menuRef={menuRef}
            style={{ left: projectMenu.left, top: projectMenu.top }}
          >
            <button type="button" role="menuitem" onClick={() => runProjectMenuAction(menuProject, "rename")}>
              <Pencil size={15} aria-hidden="true" />
              <span>{t("Rename")}</span>
            </button>
            <button type="button" role="menuitem" onClick={() => runProjectMenuAction(menuProject, "recovery")}>
              <History size={15} aria-hidden="true" />
              <span>{t("Recovery")}</span>
            </button>
            <button
              className="is-danger"
              type="button"
              role="menuitem"
              onClick={() => runProjectMenuAction(menuProject, "remove")}
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>{t("Remove reference")}</span>
            </button>
          </ActionMenu>,
          document.body
        );
      })() : null}

      {removeCandidate ? (
        <ModalFrame
          ariaLabel={t("Remove Project reference?")}
          className="project-remove-dialog ui-dialog-shell profile-form-dialog--compact"
          dialogRef={removeDialogRef}
          dismissDisabled={operation === "remove"}
          onDismiss={() => setRemoveCandidate(undefined)}
        >
          <header className="ui-dialog-header">
            <div className="ui-dialog-header__copy">
              <div className="ui-dialog-title">{t("Remove Project reference?")}</div>
              <p className="ui-dialog-description">{removeCandidate.name}</p>
            </div>
          </header>
          <div className="ui-dialog-body">
            {modalError ? (
              <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{modalError}</Notice>
            ) : null}
            <p>{t("The folder and its files will stay unchanged.")}</p>
            <code className="selectable">{removeCandidate.rootPath}</code>
          </div>
          <footer className="ui-dialog-footer">
            <Button onClick={() => setRemoveCandidate(undefined)}>{t("Cancel")}</Button>
            <Button
              ref={removeButtonRef}
              variant="danger"
              busy={operation === "remove"}
              onClick={() => void removeReference()}
            >
              {t("Remove reference")}
            </Button>
          </footer>
        </ModalFrame>
      ) : null}
      {selected && renameOpen ? (
        <ModalFrame
          ariaLabel={t("Rename Project")}
          className="project-remove-dialog ui-dialog-shell profile-form-dialog--compact"
          dialogRef={renameDialogRef}
          dismissDisabled={operation === "rename"}
          onDismiss={() => setRenameOpen(false)}
        >
          <header className="ui-dialog-header">
            <div className="ui-dialog-header__copy">
              <div className="ui-dialog-title">{t("Rename Project")}</div>
              <p className="ui-dialog-description selectable">{selected.rootPath}</p>
            </div>
          </header>
          <div className="ui-dialog-body">
            {modalError ? (
              <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{modalError}</Notice>
            ) : null}
            <label className="ui-field-stack">
              <span>{t("Name")}</span>
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
              />
            </label>
          </div>
          <footer className="ui-dialog-footer">
            <Button disabled={operation === "rename"} onClick={() => setRenameOpen(false)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              busy={operation === "rename"}
              disabled={!renameValue.trim() || renameValue.trim() === selected.name}
              onClick={() => void renameProject()}
            >
              {t("Save")}
            </Button>
          </footer>
        </ModalFrame>
      ) : null}
      {selected && skillDialogOpen ? (
        <ModalFrame
          ariaLabel={t("Add Skill to Project")}
          className="project-remove-dialog ui-dialog-shell profile-form-dialog--compact"
          dialogRef={skillDialogRef}
          dismissDisabled={operation === "add-skill"}
          onDismiss={() => setSkillDialogOpen(false)}
        >
          <header className="ui-dialog-header">
            <div className="ui-dialog-header__copy">
              <div className="ui-dialog-title">{t("Add Skill to Project")}</div>
              <p className="ui-dialog-description">{t("A verified copy becomes part of the Project folder.")}</p>
            </div>
          </header>
          <div className="ui-dialog-body project-add-skill-fields">
            {modalError ? (
              <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{modalError}</Notice>
            ) : null}
            <label className="ui-field-stack">
              <span>{t("Agent")}</span>
              <select value={skillAgentId} onChange={(event) => setSkillAgentId(event.target.value)}>
                {skillAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </label>
            <label className="ui-field-stack">
              <span>{t("Library Skill")}</span>
              <select ref={skillSelectRef} value={selectedLibraryId} onChange={(event) => setSelectedLibraryId(event.target.value)}>
                {librarySkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
              </select>
            </label>
            {librarySkills.length === 0 ? <p>{t("No enabled Library Skills are available.")}</p> : null}
          </div>
          <footer className="ui-dialog-footer">
            <Button disabled={operation === "add-skill"} onClick={() => setSkillDialogOpen(false)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              busy={operation === "add-skill"}
              disabled={!selectedLibraryId || !skillAgentId}
              onClick={() => void addSkill()}
            >
              {t("Add")}
            </Button>
          </footer>
        </ModalFrame>
      ) : null}
      {selected && removeSkillCandidate ? (
        <ModalFrame
          ariaLabel={t("Remove Project Skill?")}
          className="project-remove-dialog ui-dialog-shell profile-form-dialog--compact"
          dialogRef={removeSkillDialogRef}
          dismissDisabled={operation === "remove-skill"}
          onDismiss={() => setRemoveSkillCandidate(undefined)}
        >
          <header className="ui-dialog-header">
            <div className="ui-dialog-header__copy">
              <div className="ui-dialog-title">{t("Remove Project Skill?")}</div>
              <p className="ui-dialog-description">{removeSkillCandidate.name}</p>
            </div>
          </header>
          <div className="ui-dialog-body">
            {modalError ? (
              <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{modalError}</Notice>
            ) : null}
            <p>{t("The Project-owned copy will be backed up before removal.")}</p>
            <code className="selectable">{removeSkillCandidate.absolutePath}</code>
          </div>
          <footer className="ui-dialog-footer">
            <Button disabled={operation === "remove-skill"} onClick={() => setRemoveSkillCandidate(undefined)}>{t("Cancel")}</Button>
            <Button variant="danger" busy={operation === "remove-skill"} onClick={() => void removeSkill()}>
              {t("Remove")}
            </Button>
          </footer>
        </ModalFrame>
      ) : null}
      <ProjectEnvironmentPreviewDialog
        open={previewOpen}
        busy={operation === "preview"}
        preview={preview}
        error={previewError}
        onClose={() => setPreviewOpen(false)}
      />
      {selected && editorRequest ? (
        <ProjectResourceEditorDialog
          open
          projectId={selected.id}
          resourceId={editorRequest.resourceId}
          agentId={editorRequest.agentId}
          onClose={() => setEditorRequest(undefined)}
          onGuardChange={onEditorGuardChange}
          onSaved={refreshSelectedProject}
          suspended={editorGuardPromptOpen}
        />
      ) : null}
      {selected ? (
        <ProjectRecoveryDialog
          open={recoveryOpen}
          projectId={selected.id}
          onClose={() => setRecoveryOpen(false)}
          onRestored={refreshSelectedProject}
        />
      ) : null}
    </section>
  );
};
