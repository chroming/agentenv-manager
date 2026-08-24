import {
  AlertTriangle,
  BookOpen,
  Eye,
  ExternalLink,
  FileText,
  FilePlus2,
  Folder,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  Plug,
  RotateCcw,
  Trash2
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectSummary, UiState, UiStateUpdate } from "../../shared/types";
import { completeOrder, defaultUiState, orderByPreference } from "../../shared/uiState";
import type {
  ProjectEnvironmentPreview,
  ProjectEnvironmentSnapshot,
  ProjectGitPathState,
  ProjectResourceKind,
  ProjectResourceSummary,
  SkillLibraryEntry,
  TargetInfo
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { InfoTip } from "./InfoTip";
import { LibrarySkillPicker } from "./LibrarySkillPicker";
import { OverflowTooltip } from "./OverflowTooltip";
import { ProjectEnvironmentPreviewDialog } from "./ProjectEnvironmentPreviewDialog";
import { ProjectRecoveryDialog } from "./ProjectRecoveryDialog";
import { AgentContextSwitcher } from "./AgentContextSwitcher";
import {
  ProjectResourceEditorDialog,
  type ProjectEditorGuard
} from "./ProjectResourceEditorDialog";
import { WorkspaceInstructionPreviewList } from "./WorkspaceInstructionPreviewList";
import {
  ActionMenu,
  ActionMenuItem,
  AlignedResourceList,
  Button,
  ControlGroup,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  focusInitialActionMenuItem,
  IconButton,
  InspectorHeader,
  ModalFrame,
  Notice,
  ObjectSwitcher,
  PageHeader,
  RefreshAction,
  ResourceDisclosureSection,
  ResourcePanelToolbar,
  SelectField,
  SingleObjectWorkspace,
  TextField,
  ResourceRow,
  useExclusiveDisclosure
} from "./ui";

type ProjectOperation = "add" | "refresh" | "rename" | "remove" | "add-skill" | "remove-skill" | "inspect" | "open" | "preview";
type ProjectMenuState = { projectId: string; left: number; top: number };

export const ProjectsWorkspace = ({
  targets,
  uiState = defaultUiState(),
  onUpdateUiState = () => undefined,
  onEditorGuardChange,
  openRequest,
  editorGuardPromptOpen = false
}: {
  targets: TargetInfo[];
  uiState?: UiState;
  onUpdateUiState?(update: UiStateUpdate): void;
  onEditorGuardChange?(guard?: ProjectEditorGuard): void;
  openRequest?: { requestId: number; projectId: string };
  editorGuardPromptOpen?: boolean;
}) => {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [agentSwitcherOpen, setAgentSwitcherOpen] = useState(false);
  const [agentQuery, setAgentQuery] = useState("");
  const {
    isExpanded: resourceKindIsExpanded,
    toggleExpandedId: toggleResourceKind
  } = useExclusiveDisclosure<ProjectResourceKind>();
  const [selectedId, setSelectedId] = useState<string | undefined>(uiState.selectedWorkspaceId);
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
  const [recoveryMode, setRecoveryMode] = useState<"latest" | "history">();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const [librarySkills, setLibrarySkills] = useState<SkillLibraryEntry[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState("");
  const [skillLocationId, setSkillLocationId] = useState("");
  const [removeSkillCandidate, setRemoveSkillCandidate] = useState<ProjectResourceSummary>();
  const removeDialogRef = useRef<HTMLElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const renameDialogRef = useRef<HTMLElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skillDialogRef = useRef<HTMLElement>(null);
  const removeSkillDialogRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuReturnFocusRef = useRef<HTMLElement | null>(null);

  const selected = projects.find((project) => project.id === selectedId) ?? projects[0];
  const availableTargets = targets.filter((target) => Boolean(target.health.executablePath));
  const availableTargetIds = availableTargets.map((target) => target.id).join("|");
  const persistedAgentId = selected
    ? uiState.workspaceAgentSelections[selected.id]
    : undefined;
  const selectedAgent = availableTargets.find((target) => target.id === selectedAgentId)
    ?? availableTargets[0];
  const selectedAgentSupport = snapshot?.agentSupport.find(
    (support) => support.agentId === selectedAgent?.id
  );
  const writableSkillLocations = snapshot?.skillLocations?.filter((location) => location.writable) ?? [];
  const selectedSkillLocation = writableSkillLocations.find((location) => location.id === skillLocationId);
  const selectedLibrarySkill = librarySkills.find((skill) => skill.id === selectedLibraryId);
  const selectedSkillDestination = selectedSkillLocation && selectedLibrarySkill
    ? `${selectedSkillLocation.relativePath.replace(/[\\/]+$/, "")}/${selectedLibrarySkill.id}`
    : undefined;
  const existingProjectSkill = selectedSkillDestination
    ? snapshot?.resources.find((resource) =>
        resource.kind === "skill" &&
        resource.relativePath.replaceAll("\\", "/") === selectedSkillDestination
      )
    : undefined;
  const selectedSkillAlreadyMatches = Boolean(
    existingProjectSkill?.contentHash &&
    selectedLibrarySkill?.contentHash &&
    existingProjectSkill.contentHash === selectedLibrarySkill.contentHash
  );
  const selectedSkillConflicts = Boolean(existingProjectSkill && !selectedSkillAlreadyMatches);
  const orderProjects = (items: ProjectSummary[]) =>
    orderByPreference(items, uiState.workspaceOrder, (project) => project.id);
  const selectProject = (projectId: string | undefined) => {
    setSelectedId(projectId);
    if (uiState.selectedWorkspaceId !== projectId) {
      onUpdateUiState({ selectedWorkspaceId: projectId });
    }
  };
  const gitStateLabel = (state?: ProjectGitPathState) => {
    if (state === "tracked-clean") return t("Tracked");
    if (state === "tracked-modified") return t("Modified");
    if (state === "untracked") return t("Untracked");
    if (state === "ignored") return t("Ignored");
    if (state === "unavailable") return t("Git status unavailable");
    return undefined;
  };
  const gitChangedCount = snapshot?.git
    ? Object.values(snapshot.git.pathStates).filter((state) => state !== "tracked-clean").length
    : 0;
  const gitSummary = snapshot?.git?.repository === "git"
    ? gitChangedCount > 0
      ? t("Git · {{count}} changed", { count: gitChangedCount })
      : t("Git · Clean")
    : snapshot?.git?.repository === "unavailable"
      ? t("Git unavailable")
      : t("Local folder");

  const refresh = async (refreshEnvironment = false) => {
    setOperation("refresh");
    setError("");
    try {
      const next = orderProjects(await window.agentEnv.listProjects());
      setProjects(next);
      const preferredSelectedId = selectedId ?? uiState.selectedWorkspaceId;
      const nextSelectedId = preferredSelectedId && next.some((project) => project.id === preferredSelectedId)
        ? preferredSelectedId
        : next[0]?.id;
      selectProject(nextSelectedId);
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
    selectProject(openRequest.projectId);
  }, [openRequest?.requestId, openRequest?.projectId]);

  useEffect(() => {
    if (
      uiState.selectedWorkspaceId &&
      uiState.selectedWorkspaceId !== selectedId &&
      projects.some((project) => project.id === uiState.selectedWorkspaceId)
    ) {
      setSelectedId(uiState.selectedWorkspaceId);
    }
  }, [projects, selectedId, uiState.selectedWorkspaceId]);

  useEffect(() => {
    if (!selected) {
      setSelectedAgentId(undefined);
      return;
    }
    setSelectedAgentId((current) =>
      availableTargets.some(
            (target) => target.id === persistedAgentId
          )
          ? persistedAgentId
        : availableTargets.some((target) => target.id === selected.lastAgentId)
          ? selected.lastAgentId
          : availableTargets.some((target) => target.id === current)
            ? current
          : availableTargets[0]?.id
    );
  }, [availableTargetIds, persistedAgentId, selected?.id, selected?.lastAgentId]);

  useEffect(() => {
    if (!selected) {
      setSnapshot(undefined);
      return;
    }
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
      const loaded = await window.agentEnv.listProjects();
      const order = [
        added.id,
        ...loaded.map((project) => project.id).filter((id) => id !== added.id)
      ];
      setProjects(orderByPreference(loaded, order, (project) => project.id));
      setSelectedId(added.id);
      onUpdateUiState({ workspaceOrder: order, selectedWorkspaceId: added.id });
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
      const removedIndex = projects.findIndex((project) => project.id === removeCandidate.id);
      const loaded = await window.agentEnv.listProjects();
      const order = completeOrder(
        uiState.workspaceOrder.filter((id) => id !== removeCandidate.id),
        loaded.map((project) => project.id)
      );
      const next = orderByPreference(loaded, order, (project) => project.id);
      const nextSelected = next[Math.min(Math.max(removedIndex, 0), next.length - 1)];
      setProjects(next);
      setSelectedId(nextSelected?.id);
      onUpdateUiState({ workspaceOrder: order, selectedWorkspaceId: nextSelected?.id });
      setRemoveCandidate(undefined);
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
      setSkillLocationId(
        writableSkillLocations.find((location) => location.recommended)?.id
          ?? writableSkillLocations[0]?.id
          ?? ""
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
    if (operation) return;
    const width = 184;
    const estimatedHeight = 160;
    selectProject(project.id);
    menuReturnFocusRef.current = returnFocus;
    setProjectMenu({
      projectId: project.id,
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - estimatedHeight - 8))
    });
  };

  const runProjectMenuAction = (
    project: ProjectSummary,
    action: "details" | "undo" | "recovery" | "remove"
  ) => {
    setProjectMenu(undefined);
    setModalError("");
    selectProject(project.id);
    if (action === "details") {
      void openPreview(project.id);
      return;
    }
    if (action === "undo" || action === "recovery") {
      setRecoveryMode(action === "undo" ? "latest" : "history");
      return;
    }
    setRemoveCandidate(project);
  };

  const addSkill = async () => {
    if (!selected || !selectedLibraryId || !skillLocationId) return;
    setOperation("add-skill");
    setModalError("");
    try {
      await window.agentEnv.addProjectSkill({
        projectId: selected.id,
        locationId: skillLocationId,
        libraryId: selectedLibraryId,
        ...(selectedSkillConflicts ? { conflictResolution: "replace" as const } : {})
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
      setProjects(orderProjects(next));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const openPreview = async (projectId = selected?.id) => {
    if (!projectId || !selectedAgent) return;
    setPreviewOpen(true);
    setPreview(undefined);
    setPreviewError("");
    setOperation("preview");
    try {
      setPreview(await window.agentEnv.previewProject(projectId, selectedAgent.id));
    } catch (unknownError) {
      setPreviewError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const resourcesByKind = (kind: ProjectResourceKind) =>
    snapshot?.resources.filter((resource) => resource.kind === kind) ?? [];

  const resourceKindIsVisible = (kind: ProjectResourceKind) => {
    if (resourcesByKind(kind).length > 0) return true;
    if (!selectedAgentSupport) return false;
    if (kind === "instructions") return selectedAgentSupport.instructions.inspect !== "unsupported";
    if (kind === "skill") return selectedAgentSupport.skills.inspect !== "unsupported";
    return selectedAgentSupport.mcp.inspect !== "unsupported";
  };

  const canCreateInstruction = Boolean(
    selectedAgent &&
    selectedAgentSupport?.instructions.mutate === "supported" &&
    selectedAgentSupport.instructionCreateFile &&
    !resourcesByKind("instructions").some((resource) =>
      resource.consumerAgentIds.includes(selectedAgent.id) &&
      resource.relativePath.replaceAll("\\", "/") === selectedAgentSupport.instructionCreateFile
    )
  );

  const switcherItems = projects.map((project) => ({
    id: project.id,
    ariaLabel: t("Workspace {{name}}", { name: project.name }),
    searchText: `${project.name} ${project.rootPath}`,
    icon: <Folder size={17} strokeWidth={2} />,
    title: project.name,
    description: <span title={project.rootPath}>{project.rootPath}</span>,
    status: !project.exists
      ? t("Folder missing")
      : project.lastAgentId
        ? targets.find((target) => target.id === project.lastAgentId)?.name ?? project.lastAgentId
        : undefined,
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      showProjectMenu(project, event.clientX, event.clientY, event.currentTarget);
    }
  }));

  const refreshSelectedProject = async () => {
    if (!selected?.exists || operation === "inspect") return;
    setOperation("inspect");
    setError("");
    try {
      setSnapshot(await window.agentEnv.inspectProject(selected.id));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation((value) => value === "inspect" ? undefined : value);
    }
  };

  return (
    <section className="projects-page" aria-label={t("Workspaces")}>
      <PageHeader
        className="projects-page-header"
        title={t("Workspaces")}
        help={<InfoTip label={t("Open recurring folders with an Agent and manage only the files owned by that folder.")} />}
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

      <SingleObjectWorkspace
        className="projects-workbench"
        surface="open"
        aria-label={t("Workspace browser")}
      >
        <div className="project-detail" aria-label={selected ? selected.name : t("Workspace detail")}>
          {selected ? (
            <>
              <InspectorHeader
                className="project-detail__header"
                icon={<Folder size={18} strokeWidth={2} />}
                responsive="stack"
                titleLabel={selected.name}
                title={(
                  <span className="project-detail__title-control">
                    <ObjectSwitcher
                      ariaLabel={t("Choose Workspace")}
                      className="project-switcher"
                      emptyMessage={operation === "refresh"
                        ? t("Loading Workspaces")
                        : projects.length > 0
                          ? t("No matching folders")
                          : t("No Workspaces yet")}
                      footerAction={{
                        icon: <Plus size={15} />,
                        label: t("Add folder"),
                        onClick: () => void addProject()
                      }}
                      items={switcherItems}
                      open={switcherOpen}
                      query={query}
                      searchLabel={t("Search Workspaces")}
                      searchPlaceholder={t("Search folders...")}
                      selectedId={selected.id}
                      showTriggerIcon={false}
                      showTriggerDescription={false}
                      onOpenChange={setSwitcherOpen}
                      onQueryChange={setQuery}
                      onReorder={(projectIds) => {
                        const order = completeOrder(
                          projectIds,
                          projects.map((project) => project.id)
                        );
                        setProjects((current) =>
                          orderByPreference(current, order, (project) => project.id)
                        );
                        onUpdateUiState({ workspaceOrder: order });
                      }}
                      onSelect={selectProject}
                      triggerVariant="inline"
                    />
                    <IconButton
                      className="project-detail__edit"
                      label={t("Rename Workspace")}
                      size="compact"
                      variant="ghost"
                      onClick={() => {
                        setRenameValue(selected.name);
                        setRenameOpen(true);
                      }}
                    >
                      <Pencil size={13} strokeWidth={2.1} />
                    </IconButton>
                  </span>
                )}
                description={<span className="selectable" title={selected.rootPath}>{selected.rootPath}</span>}
                actions={(
                  <ControlGroup className="project-detail__actions">
                    <RefreshAction
                      busy={operation === "inspect"}
                      className="project-detail__refresh"
                      disabled={!selected.exists}
                      label={t("Refresh Workspace")}
                      presentation="icon"
                      variant="ghost"
                      onRefresh={() => void refreshSelectedProject()}
                    />
                    <AgentContextSwitcher
                      className="project-agent-switcher"
                      open={agentSwitcherOpen}
                      query={agentQuery}
                      selectedId={selectedAgent?.id}
                      selectionLabel={t("Choose Agent")}
                      targets={availableTargets}
                      onOpenChange={setAgentSwitcherOpen}
                      onQueryChange={setAgentQuery}
                      onSelect={(agentId) => {
                        setSelectedAgentId(agentId);
                        onUpdateUiState({
                          workspaceAgentSelections: {
                            ...uiState.workspaceAgentSelections,
                            [selected.id]: agentId
                          }
                        });
                      }}
                    />
                    <Button
                      className="ui-inspector-header__command"
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
                        label={t("More Workspace actions")}
                        aria-expanded={projectMenu?.projectId === selected.id}
                        aria-haspopup="menu"
                        disabled={Boolean(operation)}
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
                  </ControlGroup>
                )}
              />
              {!selected.exists ? (
                <EmptyState
                  className="project-missing-state"
                  title={t("Workspace folder is unavailable")}
                  description={t("The reference is kept. Reconnect the folder or remove the reference.")}
                />
              ) : (
                <div className="project-resource-groups">
                  <span className="ui-visually-hidden" role="status">
                    {gitSummary}{snapshot?.partial ? ` · ${t("Some sources unavailable")}` : ""}
                  </span>
                  {([
                    ["instructions", t("Instructions"), t("Workspace-owned guidance files"), <FileText size={17} aria-hidden="true" />],
                    ["skill", t("Skills"), t("Regular files copied into this folder"), <BookOpen size={17} aria-hidden="true" />],
                    ["mcp", t("MCPs"), t("Detected only; AgentEnv does not edit these files"), <Plug size={17} aria-hidden="true" />]
                  ] as const).filter(([kind]) => resourceKindIsVisible(kind)).map(([kind, label, description, icon]) => {
                    const resources = resourcesByKind(kind);
                    const expanded = resourceKindIsExpanded(kind);
                    return (
                      <ResourceDisclosureSection
                        className="project-resource-section"
                        density="compact"
                        description={description}
                        expanded={expanded}
                        icon={icon}
                        id={`workspace-${kind}`}
                        key={kind}
                        onToggle={() => toggleResourceKind(kind)}
                        nested={kind === "skill" || kind === "mcp"}
                        title={label}
                        toggleLabel={t(expanded ? "Collapse {{name}}" : "Expand {{name}}", { name: label })}
                        summary={operation === "inspect"
                          ? t("Reading…")
                          : String(resources.length)}
                      >
                        {kind === "instructions" && canCreateInstruction ? (
                          <ResourcePanelToolbar
                            aria-label={t("Instruction actions")}
                            className="project-resource-section__toolbar"
                          >
                            <Button
                              size="compact"
                              icon={<FilePlus2 size={13} />}
                              onClick={() => setEditorRequest({ agentId: selectedAgent!.id })}
                            >
                              {t("Add instruction")}
                            </Button>
                          </ResourcePanelToolbar>
                        ) : kind === "skill" && writableSkillLocations.length > 0 ? (
                          <ResourcePanelToolbar
                            aria-label={t("Skill actions")}
                            className="project-resource-section__toolbar"
                          >
                            <Button size="compact" icon={<Plus size={13} />} onClick={() => void openAddSkill()}>
                              {t("Copy from Library")}
                            </Button>
                          </ResourcePanelToolbar>
                        ) : null}
                        {kind === "instructions" ? (
                  <WorkspaceInstructionPreviewList
                    projectId={selected.id}
                    resources={resources}
                    onOpen={(resource) => setEditorRequest({ resourceId: resource.id })}
                  />
                        ) : (
                        <AlignedResourceList
                          actionTrack="compact"
                          className="project-resource-section__list"
                        >
                          {resources.map((resource) => {
                          const consumerNames = resource.consumerAgentIds
                            .map((agentId) => targets.find((target) => target.id === agentId)?.name ?? agentId);
                          const gitLabel = gitStateLabel(resource.gitState);
                          const consumerSummary = consumerNames.length > 1
                            ? t("{{count}} Agents", { count: consumerNames.length })
                            : consumerNames[0];
                          const compactState = [consumerSummary, gitLabel].filter(Boolean).join(" · ");
                          const fullState = [consumerNames.join(" · "), gitLabel].filter(Boolean).join(" · ");
                          return (
                            <ResourceRow
                              className="ui-resource-children__item project-resource-entry"
                              density="compact"
                              description={resource.relativePath !== resource.name
                                ? (
                                  <OverflowTooltip
                                    className="project-resource-entry__path"
                                    displayText={resource.relativePath}
                                    text={resource.absolutePath}
                                  />
                                )
                                : undefined}
                              icon={icon}
                              key={resource.id}
                              state={compactState ? (
                                <OverflowTooltip
                                  className="project-resource-entry__state"
                                  displayText={compactState}
                                  text={fullState}
                                />
                              ) : undefined}
                              title={resource.name}
                              actions={resource.kind === "skill" && resource.editable ? (
                                <IconButton
                                  size="compact"
                                  label={t("Remove {{name}} from Workspace", { name: resource.name })}
                                  onClick={() => {
                                    setModalError("");
                                    setRemoveSkillCandidate(resource);
                                  }}
                                >
                                  <Trash2 size={14} />
                                </IconButton>
                              ) : undefined}
                            />
                          );
                          })}
                          {kind === "skill" && writableSkillLocations.length === 0 ? (
                            <p className="project-resource-note">
                              {t("No enabled Agent provides a writable Workspace Skill location.")}
                            </p>
                          ) : null}
                          {resources.length === 0 ? (
                            <p className="project-resource-note">{t("No files detected")}</p>
                          ) : null}
                        </AlignedResourceList>
                        )}
                      </ResourceDisclosureSection>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <EmptyState
              className="project-empty-detail"
              icon={<Folder size={28} strokeWidth={1.7} />}
              title={t("Add a folder to open with an Agent")}
              description={t("AgentEnv stores the folder reference and changes project files only after an explicit action.")}
              actions={(
                <Button
                  variant="primary"
                  busy={operation === "add"}
                  icon={<Plus size={15} />}
                  onClick={() => void addProject()}
                >
                  {t("Add folder")}
                </Button>
              )}
            />
          )}
        </div>
      </SingleObjectWorkspace>

      {projectMenu ? (() => {
        const menuProject = projects.find((project) => project.id === projectMenu.projectId);
        if (!menuProject) return null;
        return createPortal(
          <ActionMenu
            ariaLabel={t("Workspace actions")}
            className="project-actions-menu"
            menuRef={menuRef}
            style={{ left: projectMenu.left, top: projectMenu.top }}
          >
            <ActionMenuItem onClick={() => runProjectMenuAction(menuProject, "details")}>
              <Eye size={15} aria-hidden="true" />
              <span>{t("Loaded resource details")}</span>
            </ActionMenuItem>
            <ActionMenuItem onClick={() => runProjectMenuAction(menuProject, "undo")}>
              <RotateCcw size={15} aria-hidden="true" />
              <span>{t("Undo last change")}</span>
            </ActionMenuItem>
            <ActionMenuItem onClick={() => runProjectMenuAction(menuProject, "recovery")}>
              <History size={15} aria-hidden="true" />
              <span>{t("Recovery")}</span>
            </ActionMenuItem>
            <ActionMenuItem
              tone="danger"
              onClick={() => runProjectMenuAction(menuProject, "remove")}
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>{t("Remove reference")}</span>
            </ActionMenuItem>
          </ActionMenu>,
          document.body
        );
      })() : null}

      {removeCandidate ? (
        <ModalFrame
          ariaLabel={t("Remove Workspace reference?")}
          className="project-remove-dialog ui-dialog-shell profile-form-dialog--compact"
          dialogRef={removeDialogRef}
          dismissDisabled={operation === "remove"}
          onDismiss={() => setRemoveCandidate(undefined)}
        >
          <DialogHeader title={t("Remove Workspace reference?")} description={removeCandidate.name} />
          <DialogBody>
            {modalError ? (
              <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{modalError}</Notice>
            ) : null}
            <p>{t("The folder and its files will stay unchanged.")}</p>
            <code className="selectable">{removeCandidate.rootPath}</code>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setRemoveCandidate(undefined)}>{t("Cancel")}</Button>
            <Button
              ref={removeButtonRef}
              variant="danger"
              busy={operation === "remove"}
              onClick={() => void removeReference()}
            >
              {t("Remove reference")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
      {selected && renameOpen ? (
        <ModalFrame
          ariaLabel={t("Rename Workspace")}
          className="project-remove-dialog ui-dialog-shell profile-form-dialog--compact"
          dialogRef={renameDialogRef}
          dismissDisabled={operation === "rename"}
          onDismiss={() => setRenameOpen(false)}
        >
          <DialogHeader
            title={t("Rename Workspace")}
            description={<span className="selectable">{selected.rootPath}</span>}
          />
          <DialogBody>
            {modalError ? (
              <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{modalError}</Notice>
            ) : null}
            <TextField
              ref={renameInputRef}
              label={t("Name")}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
            />
          </DialogBody>
          <DialogFooter>
            <Button disabled={operation === "rename"} onClick={() => setRenameOpen(false)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              busy={operation === "rename"}
              disabled={!renameValue.trim() || renameValue.trim() === selected.name}
              onClick={() => void renameProject()}
            >
              {t("Save")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
      {selected && skillDialogOpen ? (
        <ModalFrame
          ariaLabel={t("Copy Skill to Workspace")}
          className="resource-picker-dialog resource-picker-dialog--skills ui-dialog-shell"
          dialogRef={skillDialogRef}
          dismissDisabled={operation === "add-skill"}
          onDismiss={() => setSkillDialogOpen(false)}
        >
          <DialogHeader
            title={t("Copy Skill to Workspace")}
            description={t("A verified regular-file copy becomes part of this folder.")}
          />
          <DialogBody className="resource-picker-dialog__body project-add-skill-fields">
            {modalError ? (
              <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{modalError}</Notice>
            ) : null}
            <LibrarySkillPicker
              onChange={(ids) => setSelectedLibraryId(ids[0] ?? "")}
              selectedIds={selectedLibraryId ? [selectedLibraryId] : []}
              selectionMode="single"
              skills={librarySkills}
            />
            <SelectField
              label={t("Workspace location")}
              value={skillLocationId}
              onChange={(event) => setSkillLocationId(event.target.value)}
              description={t("Shared locations are loaded by every compatible Agent in this Workspace.")}
            >
              {writableSkillLocations.map((location) => {
                const consumers = location.consumerAgentIds
                  .map((agentId) => targets.find((target) => target.id === agentId)?.name ?? agentId)
                  .join(", ");
                return (
                  <option key={location.id} value={location.id}>
                    {location.relativePath} · {location.scope === "shared" ? t("Shared") : consumers}
                  </option>
                );
              })}
            </SelectField>
            {selectedSkillDestination ? (
              <div className="project-file-impact" aria-label={t("File impact") }>
                <span>{t("Creates or replaces regular files")}</span>
                <code className="selectable">{selectedSkillDestination}</code>
                <small>{t("Git changes stay unstaged and uncommitted.")}</small>
              </div>
            ) : null}
            {librarySkills.length === 0 ? <p>{t("No enabled Library Skills are available.")}</p> : null}
            {selectedSkillAlreadyMatches ? (
              <Notice tone="info" title={t("Already in this Workspace")}>
                {t("The Workspace copy already matches the selected Library Skill.")}
              </Notice>
            ) : selectedSkillConflicts ? (
              <Notice tone="warning" title={t("A different Workspace copy already exists")}>
                {t("Replacing it creates a recovery point first. You can keep the current Workspace copy instead.")}
              </Notice>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button disabled={operation === "add-skill"} onClick={() => setSkillDialogOpen(false)}>
              {selectedSkillConflicts ? t("Keep Workspace copy") : t("Cancel")}
            </Button>
            <Button
              variant="primary"
              busy={operation === "add-skill"}
              disabled={!selectedLibraryId || !skillLocationId || selectedSkillAlreadyMatches}
              onClick={() => void addSkill()}
            >
              {selectedSkillAlreadyMatches
                ? t("Already added")
                : selectedSkillConflicts
                  ? t("Replace with Library copy")
                  : t("Add")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
      {selected && removeSkillCandidate ? (
        <ModalFrame
          ariaLabel={t("Remove Workspace Skill?")}
          className="project-remove-dialog ui-dialog-shell profile-form-dialog--compact"
          dialogRef={removeSkillDialogRef}
          dismissDisabled={operation === "remove-skill"}
          onDismiss={() => setRemoveSkillCandidate(undefined)}
        >
          <DialogHeader title={t("Remove Workspace Skill?")} description={removeSkillCandidate.name} />
          <DialogBody>
            {modalError ? (
              <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{modalError}</Notice>
            ) : null}
            <p>{t("The Workspace-owned copy will be backed up before removal.")}</p>
            <code className="selectable">{removeSkillCandidate.absolutePath}</code>
            {removeSkillCandidate.gitState ? (
              <p className="muted">{t("Git status: {{status}}", {
                status: gitStateLabel(removeSkillCandidate.gitState) ?? t("Unavailable")
              })}</p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button disabled={operation === "remove-skill"} onClick={() => setRemoveSkillCandidate(undefined)}>{t("Cancel")}</Button>
            <Button variant="danger" busy={operation === "remove-skill"} onClick={() => void removeSkill()}>
              {t("Remove")}
            </Button>
          </DialogFooter>
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
          mode={recoveryMode ?? "history"}
          open={Boolean(recoveryMode)}
          projectId={selected.id}
          onClose={() => setRecoveryMode(undefined)}
          onRestored={refreshSelectedProject}
        />
      ) : null}
    </section>
  );
};
