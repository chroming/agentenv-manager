import { workspaceSshCommand } from "../../shared/workspaceSshCommand";
import {
  AlertTriangle,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Eye,
  ExternalLink,
  FileText,
  FilePlus2,
  Folder,
  History,
  Info,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Plug,
  RotateCcw,
  Server,
  Terminal,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ProjectSummary,
  RemoteDevice,
  RemoteDirectoryEntry,
  UiState,
  UiStateUpdate
} from "../../shared/types";
import {
  manualProfileSkillGroup,
  sourceProfileSkillGroup,
  type AvailableProfileSkillGroup
} from "../../shared/profileSkillGroups";
import { completeOrder, defaultUiState, orderByPreference } from "../../shared/uiState";
import type {
  ProjectEnvironmentPreview,
  ProjectEnvironmentSnapshot,
  ProjectGitPathState,
  ProjectResourceKind,
  ProjectResourceSummary,
  SkillGroup,
  SkillLibraryEntry,
  SkillSourceGroupView,
  TargetInfo
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { InfoTip } from "./InfoTip";
import {
  LibrarySkillSelection,
  type LibrarySkillSelectionMode
} from "./LibrarySkillSelection";
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
  Badge,
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
  SegmentedControl,
  SelectField,
  SingleObjectWorkspace,
  TextField,
  ResourceRow,
  useExclusiveDisclosure
} from "./ui";

type ProjectOperation = "add" | "refresh" | "rename" | "remove" | "add-skill" | "remove-skill" | "inspect" | "open" | "preview";
type ProjectMenuState = { projectId: string; left: number; top: number };

export const projectSnapshotCache = new Map<string, ProjectEnvironmentSnapshot>();

export const clearProjectSnapshotCache = (projectId?: string) => {
  if (projectId) {
    projectSnapshotCache.delete(projectId);
  } else {
    projectSnapshotCache.clear();
  }
};

export const ProjectsWorkspace = ({
  initialProjects,
  onProjectsChange,
  targets,
  skillGroups = [],
  sourceGroups = [],
  uiState = defaultUiState(),
  onUpdateUiState = () => undefined,
  onEditorGuardChange,
  openRequest,
  editorGuardPromptOpen = false,
  onConfigureRemoteDevices
}: {
  initialProjects?: ProjectSummary[];
  onProjectsChange?(projects: ProjectSummary[]): void;
  targets: TargetInfo[];
  skillGroups?: SkillGroup[];
  sourceGroups?: SkillSourceGroupView[];
  uiState?: UiState;
  onUpdateUiState?(update: UiStateUpdate): void;
  onEditorGuardChange?(guard?: ProjectEditorGuard): void;
  openRequest?: { requestId: number; projectId: string };
  editorGuardPromptOpen?: boolean;
  onConfigureRemoteDevices?(): void;
}) => {
  const { t } = useI18n();
  const orderProjects = (items: ProjectSummary[]) =>
    orderByPreference(items, uiState.workspaceOrder, (project) => project.id);
  const [projects, setProjects] = useState<ProjectSummary[]>(() =>
    initialProjects && initialProjects.length > 0 ? orderProjects(initialProjects) : []
  );
  const [hasLoadedProjects, setHasLoadedProjects] = useState(
    Boolean(initialProjects && initialProjects.length > 0)
  );

  const applyProjects = (next: ProjectSummary[] | ((current: ProjectSummary[]) => ProjectSummary[])) => {
    setProjects((current) => (typeof next === "function" ? next(current) : next));
  };

  useEffect(() => {
    onProjectsChange?.(projects);
  }, [projects, onProjectsChange]);
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
  const [notice, setNotice] = useState("");
  const [modalError, setModalError] = useState("");
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState>();
  const [removeCandidate, setRemoveCandidate] = useState<ProjectSummary>();
  const initialSnapshot = uiState.selectedWorkspaceId
    ? projectSnapshotCache.get(uiState.selectedWorkspaceId)
    : undefined;
  const [loadedSnapshot, setSnapshot] = useState<ProjectEnvironmentSnapshot | undefined>(initialSnapshot);
  const snapshot = loadedSnapshot?.projectId === selectedId ? loadedSnapshot : undefined;
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
  const [skillPickerMode, setSkillPickerMode] = useState<LibrarySkillSelectionMode>("skills");
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [selectedSkillGroupKeys, setSelectedSkillGroupKeys] = useState<string[]>([]);
  const [skillLocationId, setSkillLocationId] = useState("");
  const [removeSkillCandidate, setRemoveSkillCandidate] = useState<ProjectResourceSummary>();
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [addMenu, setAddMenu] = useState<{ left: number; top: number }>();
  const addMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const [remoteDevices, setRemoteDevices] = useState<RemoteDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [testingPath, setTestingPath] = useState(false);
  const [testResult, setTestResult] = useState<{ exists: boolean; canonicalPath?: string; error?: string }>();
  const [browsingPath, setBrowsingPath] = useState<string>("");
  const [parentBrowsingPath, setParentBrowsingPath] = useState<string | undefined>();
  const [remoteDirectories, setRemoteDirectories] = useState<RemoteDirectoryEntry[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState(false);
  const [directoryError, setDirectoryError] = useState<string>();
  const directoryRequestRef = useRef(0);
  const pathRequestRef = useRef(0);
  const remoteContextRef = useRef({ open: addWorkspaceOpen, deviceId: selectedDeviceId, path: remotePath });
  remoteContextRef.current = { open: addWorkspaceOpen, deviceId: selectedDeviceId, path: remotePath };
  const addDialogRef = useRef<HTMLElement>(null);
  const addInitialFocusRef = useRef<HTMLElement>(null);
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
  const availableSkillGroups = useMemo<AvailableProfileSkillGroup[]>(() => [
    ...skillGroups.map(manualProfileSkillGroup),
    ...sourceGroups.map(sourceProfileSkillGroup)
  ], [skillGroups, sourceGroups]);
  const availableSkillGroupsByKey = useMemo(
    () => new Map(availableSkillGroups.map((group) => [`${group.kind}:${group.groupId}`, group])),
    [availableSkillGroups]
  );
  const selectedWorkspaceLibraryIds = useMemo(() => {
    const selected = skillPickerMode === "skills"
      ? selectedLibraryIds
      : selectedSkillGroupKeys.flatMap((key) => availableSkillGroupsByKey.get(key)?.memberIds ?? []);
    const available = new Set(librarySkills.map((skill) => skill.id));
    return [...new Set(selected)].filter((id) => available.has(id)).sort();
  }, [availableSkillGroupsByKey, librarySkills, selectedLibraryIds, selectedSkillGroupKeys, skillPickerMode]);
  const selectedWorkspaceSkillPlans = useMemo(() => {
    if (!selectedSkillLocation) return [];
    const root = selectedSkillLocation.relativePath.replaceAll("\\", "/").replace(/\/+$/, "");
    const resourcesByPath = new Map(
      (snapshot?.resources ?? [])
        .filter((resource) => resource.kind === "skill")
        .map((resource) => [resource.relativePath.replaceAll("\\", "/"), resource])
    );
    const skillsById = new Map(librarySkills.map((skill) => [skill.id, skill]));
    return selectedWorkspaceLibraryIds.flatMap((libraryId) => {
      const skill = skillsById.get(libraryId);
      if (!skill) return [];
      const existing = resourcesByPath.get(`${root}/${skill.id}`);
      const matches = Boolean(existing?.contentHash && existing.contentHash === skill.contentHash);
      return [{ libraryId, existing, matches, conflicts: Boolean(existing && !matches) }];
    });
  }, [librarySkills, selectedSkillLocation, selectedWorkspaceLibraryIds, snapshot?.resources]);
  const selectedSkillMatches = selectedWorkspaceSkillPlans.filter((plan) => plan.matches).length;
  const selectedSkillConflicts = selectedWorkspaceSkillPlans.filter((plan) => plan.conflicts).length;
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
      : selected?.isRemote
        ? t("SSH Remote")
        : t("Local folder");

  const refresh = async (refreshEnvironment = false) => {
    setOperation("refresh");
    setError("");
    try {
      const next = orderProjects(await window.agentEnv.listProjects());
      applyProjects(next);
      setHasLoadedProjects(true);
      const preferredSelectedId = selectedId ?? uiState.selectedWorkspaceId;
      const nextSelectedId = preferredSelectedId && next.some((project) => project.id === preferredSelectedId)
        ? preferredSelectedId
        : next[0]?.id;
      selectProject(nextSelectedId);
      if (refreshEnvironment) {
        const nextSelected = next.find((project) => project.id === nextSelectedId);
        if (nextSelected?.exists) {
          const inspected = await window.agentEnv.inspectProject(nextSelected.id);
          projectSnapshotCache.set(nextSelected.id, inspected);
          setSnapshot(inspected);
        } else {
          setSnapshot(undefined);
        }
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
      setHasLoadedProjects(true);
    }
  };

  useEffect(() => {
    if (initialProjects && initialProjects.length > 0 && projects.length === 0) {
      const ordered = orderProjects(initialProjects);
      applyProjects(ordered);
      setHasLoadedProjects(true);
      const preferred = selectedId ?? uiState.selectedWorkspaceId;
      const nextSelectedId = preferred && ordered.some((p) => p.id === preferred)
        ? preferred
        : ordered[0]?.id;
      if (!selectedId && nextSelectedId) {
        selectProject(nextSelectedId);
      }
    }
  }, [initialProjects]);

  useEffect(() => {
    void refresh();
    void window.agentEnv.listRemoteDevices?.().then((devices) => {
      if (Array.isArray(devices)) setRemoteDevices(devices);
    }).catch(() => {});
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
    const cached = projectSnapshotCache.get(selected.id);
    setSnapshot(cached);
    let current = true;
    setOperation("inspect");
    setError("");
    void window.agentEnv.inspectProject(selected.id)
      .then((next) => {
        if (current) {
          projectSnapshotCache.set(selected.id, next);
          setSnapshot(next);
        }
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

  useEffect(() => {
    if (!addMenu) return;
    focusInitialActionMenuItem(addMenuRef.current);
  }, [addMenu]);

  useEffect(() => {
    if (!addMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !addMenuRef.current?.contains(event.target) &&
        !addMenuButtonRef.current?.contains(event.target)
      ) {
        setAddMenu(undefined);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAddMenu(undefined);
      addMenuButtonRef.current?.focus({ preventScroll: true });
    };
    const dismissForViewportChange = () => setAddMenu(undefined);
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
  }, [addMenu]);

  const toggleAddMenu = (button: HTMLElement) => {
    if (addMenu) {
      setAddMenu(undefined);
      return;
    }
    const rect = button.getBoundingClientRect();
    const width = 200;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = rect.bottom + 4;
    setAddMenu({ left, top });
  };

  useModalDialog({
    open: skillDialogOpen,
    dialogRef: skillDialogRef,
    onDismiss: () => closeSkillPicker(),
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

  useModalDialog({
    open: addWorkspaceOpen,
    dialogRef: addDialogRef,
    initialFocusRef: addInitialFocusRef,
    onDismiss: () => setAddWorkspaceOpen(false),
    dismissDisabled: operation === "add" || testingPath
  });

  const loadRemoteDirectories = useCallback(
    async (path?: string) => {
      if (!selectedDeviceId || !addWorkspaceOpen) return;
      const requestId = ++directoryRequestRef.current;
      const isCurrent = () => requestId === directoryRequestRef.current &&
        remoteContextRef.current.open && remoteContextRef.current.deviceId === selectedDeviceId;
      setLoadingDirectories(true);
      setDirectoryError(undefined);
      try {
        const result = await window.agentEnv.listRemoteDirectories?.(selectedDeviceId, path);
        if (!isCurrent()) return;
        if (result?.error) {
          setDirectoryError(result.error);
        } else if (result) {
          setBrowsingPath(result.currentPath);
          setParentBrowsingPath(result.parentPath);
          setRemoteDirectories(result.directories ?? []);
        }
      } catch (err) {
        if (isCurrent()) setDirectoryError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isCurrent()) setLoadingDirectories(false);
      }
    },
    [selectedDeviceId, addWorkspaceOpen]
  );

  useEffect(() => {
    setTestingPath(false);
    if (addWorkspaceOpen && selectedDeviceId) {
      void loadRemoteDirectories();
    }
    return () => {
      directoryRequestRef.current += 1;
      pathRequestRef.current += 1;
    };
  }, [addWorkspaceOpen, selectedDeviceId, loadRemoteDirectories]);

  const openAddWorkspaceDialog = async () => {
    setModalError("");
    setTestResult(undefined);
    setRemotePath("");
    setRemoteName("");
    setBrowsingPath("");
    setParentBrowsingPath(undefined);
    setRemoteDirectories([]);
    setDirectoryError(undefined);
    try {
      const devices = await window.agentEnv.listRemoteDevices?.() ?? [];
      setRemoteDevices(devices);
      if (devices.length > 0) {
        setSelectedDeviceId(devices[0].id);
      }
    } catch {
      setRemoteDevices([]);
    }
    setAddWorkspaceOpen(true);
  };

  const addLocalProject = async () => {
    setOperation("add");
    setModalError("");
    try {
      const path = await window.agentEnv.selectProjectFolder();
      if (!path) return;
      const added = await window.agentEnv.addProject(path);
      const loaded = await window.agentEnv.listProjects();
      const order = [
        added.id,
        ...loaded.map((project) => project.id).filter((id) => id !== added.id)
      ];
      applyProjects(orderByPreference(loaded, order, (project) => project.id));
      setSelectedId(added.id);
      onUpdateUiState({ workspaceOrder: order, selectedWorkspaceId: added.id });
      setAddWorkspaceOpen(false);
    } catch (unknownError) {
      setModalError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const testRemotePath = async () => {
    if (!selectedDeviceId || !remotePath.trim() || testingPath) return;
    const requestId = ++pathRequestRef.current;
    const isCurrent = () => requestId === pathRequestRef.current && remoteContextRef.current.open &&
      remoteContextRef.current.deviceId === selectedDeviceId && remoteContextRef.current.path === remotePath;
    setTestingPath(true);
    setTestResult(undefined);
    try {
      const probe = await window.agentEnv.testRemoteProjectPath?.(selectedDeviceId, remotePath.trim());
      if (!isCurrent()) return;
      if (probe?.exists && probe.isDirectory) {
        setTestResult({ exists: true, canonicalPath: probe.canonicalPath });
        if (probe.canonicalPath) {
          void loadRemoteDirectories(probe.canonicalPath);
        }
      } else {
        setTestResult({
          exists: false,
          error: probe?.error || (probe?.exists
            ? t("Remote path exists but is not a directory")
            : t("Remote path does not exist or is not a directory"))
        });
      }
    } catch (unknownError) {
      if (!isCurrent()) return;
      setTestResult({
        exists: false,
        error: unknownError instanceof Error ? unknownError.message : String(unknownError)
      });
    } finally {
      if (requestId === pathRequestRef.current) setTestingPath(false);
    }
  };

  const addRemoteProject = async () => {
    if (!selectedDeviceId || !remotePath.trim()) return;
    setOperation("add");
    setModalError("");
    try {
      const added = await window.agentEnv.addProject({
        deviceId: selectedDeviceId,
        rootPath: remotePath.trim(),
        name: remoteName.trim() || undefined
      });
      const loaded = await window.agentEnv.listProjects();
      const order = [
        added.id,
        ...loaded.map((project) => project.id).filter((id) => id !== added.id)
      ];
      applyProjects(orderByPreference(loaded, order, (project) => project.id));
      setSelectedId(added.id);
      onUpdateUiState({ workspaceOrder: order, selectedWorkspaceId: added.id });
      setAddWorkspaceOpen(false);
    } catch (unknownError) {
      setModalError(unknownError instanceof Error ? unknownError.message : String(unknownError));
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
      applyProjects(next);
      projectSnapshotCache.delete(removeCandidate.id);
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
      projectSnapshotCache.delete(selected.id);
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
      setSkillPickerMode("skills");
      setSelectedLibraryIds([]);
      setSelectedSkillGroupKeys([]);
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

  const closeSkillPicker = () => {
    if (operation === "add-skill") return;
    setSkillDialogOpen(false);
    setSkillPickerMode("skills");
    setSelectedLibraryIds([]);
    setSelectedSkillGroupKeys([]);
    setModalError("");
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

  const addSkills = async () => {
    if (!selected || selectedWorkspaceSkillPlans.length === 0 || !skillLocationId) return;
    setOperation("add-skill");
    setModalError("");
    try {
      await window.agentEnv.addProjectSkills({
        projectId: selected.id,
        locationId: skillLocationId,
        items: selectedWorkspaceSkillPlans.map((plan) => ({
          libraryId: plan.libraryId,
          ...(plan.conflicts ? { conflictResolution: "replace" as const } : {})
        }))
      });
      setSkillDialogOpen(false);
      setSelectedLibraryIds([]);
      setSelectedSkillGroupKeys([]);
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
    if (selected.isRemote && selectedAgent.id !== "vscode" && selectedAgent.id !== "cursor") {
      await copySshCommand(selected);
      return;
    }
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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const copySshCommand = async (project: ProjectSummary) => {
    setProjectMenu(undefined);
    setNotice("");
    const device = remoteDevices.find((d) => d.id === project.deviceId);
    const host = device?.host || project.deviceHost || "host";
    const cmd = workspaceSshCommand({ host, port: device?.port, user: device?.user }, project.rootPath);
    try {
      await navigator.clipboard.writeText(cmd);
      setNotice(t("SSH command copied to clipboard"));
      setError("");
    } catch {
      setError(t("Failed to copy SSH command"));
    }
  };

  const resourcesByKind = (kind: ProjectResourceKind) =>
    snapshot?.resources.filter((resource) => resource.kind === kind) ?? [];

  const resourceKindIsVisible = (kind: ProjectResourceKind) => {
    if (resourcesByKind(kind).length > 0) return true;
    if (!snapshot) return true;
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

  const orderedProjects = useMemo(() => {
    const local = projects.filter((project) => !project.isRemote);
    const remote = projects.filter((project) => project.isRemote);
    return [...local, ...remote];
  }, [projects]);

  const switcherItems = orderedProjects.map((project) => {
    const isRemote = Boolean(project.isRemote);
    const deviceName = project.deviceName || project.deviceHost || "SSH";
    const groupLabel = isRemote
      ? t("SSH: {{device}}", { device: deviceName })
      : t("This Mac");

    return {
      id: project.id,
      ariaLabel: isRemote
        ? t("SSH Workspace {{name}} on {{device}}", { name: project.name, device: deviceName })
        : t("Workspace {{name}}", { name: project.name }),
      searchText: `${project.name} ${project.rootPath} ${project.deviceName ?? ""} ${project.deviceHost ?? ""} ${isRemote ? "ssh remote" : "local"}`,
      groupLabel,
      icon: isRemote ? <Server size={17} strokeWidth={2} /> : <Folder size={17} strokeWidth={2} />,
      title: project.name,
      description: <span title={project.rootPath}>{project.rootPath}</span>,
      status: !project.exists
        ? (isRemote ? t("Remote path unreachable or missing") : t("Folder missing"))
        : project.lastAgentId
          ? targets.find((target) => target.id === project.lastAgentId)?.name ?? project.lastAgentId
          : undefined,
      onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault();
        showProjectMenu(project, event.clientX, event.clientY, event.currentTarget);
      }
    };
  });

  const refreshSelectedProject = async () => {
    if (!selected?.exists || operation === "inspect") return;
    setOperation("inspect");
    setError("");
    try {
      const next = await window.agentEnv.inspectProject(selected.id);
      projectSnapshotCache.set(selected.id, next);
      setSnapshot(next);
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
        actions={(
          <Button
            ref={addMenuButtonRef}
            variant="secondary"
            size="compact"
            icon={<Plus size={14} />}
            onClick={(e) => toggleAddMenu(e.currentTarget)}
            aria-haspopup="menu"
            aria-expanded={Boolean(addMenu)}
          >
            {t("Add Workspace")}
          </Button>
        )}
      />

      {notice ? (
        <Notice
          className="project-scoped-notice"
          icon={<Info size={15} />}
          tone="info"
          role="status"
        >
          {notice}
        </Notice>
      ) : null}

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
                icon={selected.isRemote ? <Server size={18} strokeWidth={2} /> : <Folder size={18} strokeWidth={2} />}
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
                        onClick: () => void addLocalProject()
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
                        applyProjects((current) =>
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
                description={(
                  <span className="selectable" title={selected.rootPath}>
                    {selected.isRemote
                      ? `${selected.deviceName ?? selected.deviceHost} · ${selected.rootPath}`
                      : selected.rootPath}
                  </span>
                )}
                actions={(
                  <ControlGroup className="project-detail__actions">
                    <RefreshAction
                      busy={operation === "inspect"}
                      className="project-detail__refresh"
                      disabled={!selected.exists}
                      label={t("Refresh Workspace")}
                      presentation="icon"
                      variant="secondary"
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
                        ? selected.isRemote && selectedAgent.id !== "vscode" && selectedAgent.id !== "cursor"
                          ? t("Copy SSH")
                          : t("Open in {{name}}", { name: selectedAgent.name })
                        : t("No Agent available")}
                      variant="primary"
                      icon={selected.isRemote && selectedAgent?.id !== "vscode" && selectedAgent?.id !== "cursor" ? <Terminal size={15} /> : <ExternalLink size={15} />}
                      busy={operation === "open"}
                      disabled={!selected.exists || !selectedAgent}
                      onClick={() => void openProject()}
                    >
                      {selected.isRemote && selectedAgent?.id !== "vscode" && selectedAgent?.id !== "cursor"
                        ? t("Copy SSH")
                        : t("Open")}
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
              {selected.isRemote ? (
                <div className="project-remote-banner">
                  <div className="project-remote-banner__info">
                    <span className="project-remote-banner__device">
                      <Server size={14} aria-hidden="true" />
                      <span>{selected.deviceName ?? "SSH"}</span>
                    </span>
                    {selected.deviceHost ? (
                      <span className="project-remote-banner__host">
                        {selected.deviceHost}
                      </span>
                    ) : null}
                    <Badge tone={selected.remoteStatus === "ready" || selected.exists ? "success" : "danger"}>
                      {selected.remoteStatus === "ready" || selected.exists ? t("Connected") : t("Unreachable")}
                    </Badge>
                  </div>
                  <div className="project-remote-banner__actions">
                    <Button
                      size="compact"
                      variant="secondary"
                      icon={<Terminal size={13} />}
                      onClick={() => void copySshCommand(selected)}
                    >
                      {t("Copy SSH command")}
                    </Button>
                  </div>
                </div>
              ) : null}
              {!selected.exists ? (
                <EmptyState
                  className="project-missing-state"
                  title={selected.isRemote ? t("Remote path unreachable or missing") : t("Workspace folder is unavailable")}
                  description={selected.isRemote
                    ? t("The remote device may be offline, or the path does not exist on the remote machine.")
                    : t("The reference is kept. Reconnect the folder or remove the reference.")}
                />
              ) : (
                <div className="project-resource-groups">
                  <span className="ui-visually-hidden" role="status">
                    {gitSummary}{snapshot?.partial ? ` · ${t("Some sources unavailable")}` : ""}
                  </span>
                  {([
                    ["instructions", t("Instructions"), undefined, <FileText size={17} aria-hidden="true" />],
                    ["skill", t("Skills"), undefined, <BookOpen size={17} aria-hidden="true" />],
                    ["mcp", t("MCPs"), t("Read-only"), <Plug size={17} aria-hidden="true" />]
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
                        summary={operation === "inspect" && !snapshot ? (
                          <span className="project-section-reading">
                            <LoaderCircle className="is-spinning" size={12} aria-hidden="true" />
                            <span>{t("Reading…")}</span>
                          </span>
                        ) : operation === "inspect" ? (
                          <span className="project-section-reading">
                            <LoaderCircle className="is-spinning" size={12} aria-hidden="true" />
                            <span>{resources.length}</span>
                          </span>
                        ) : (
                          String(resources.length)
                        )}
                      >
                        {kind === "instructions" && canCreateInstruction ? (
                          <ResourcePanelToolbar
                            aria-label={t("Instruction actions")}
                            className="project-resource-section__toolbar"
                            variant="embedded"
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
                            variant="embedded"
                          >
                            <Button
                              size="compact"
                              variant="secondary"
                              icon={<Plus size={13} />}
                              onClick={() => void openAddSkill()}
                            >
                              {t("Add Skills")}
                            </Button>
                          </ResourcePanelToolbar>
                        ) : null}
                        {!snapshot && operation === "inspect" ? (
                          <div className="project-resource-loading" role="status">
                            <LoaderCircle className="is-spinning" size={14} aria-hidden="true" />
                            <span>{t("Reading Workspace resources...")}</span>
                          </div>
                        ) : kind === "instructions" ? (
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
                                  actionsVisibility="contextual"
                                  className="ui-resource-children__item project-resource-entry"
                                  density="compact"
                                  icon={icon}
                                  key={resource.id}
                                  state={compactState ? (
                                    <OverflowTooltip
                                      className="project-resource-entry__state"
                                      displayText={compactState}
                                      text={fullState}
                                    />
                                  ) : undefined}
                                  title={(
                                    <OverflowTooltip
                                      className="project-resource-entry__name"
                                      displayText={resource.name}
                                      text={resource.absolutePath}
                                    />
                                  )}
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
                            {kind === "skill" && writableSkillLocations.length === 0 && snapshot ? (
                              <p className="project-resource-note">
                                {t("No enabled Agent provides a writable Workspace Skill location.")}
                              </p>
                            ) : null}
                            {resources.length === 0 && snapshot ? (
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
          ) : !hasLoadedProjects && (operation === "refresh" || projects.length === 0) ? (
            <div className="project-loading-state" role="status" aria-live="polite">
              <LoaderCircle className="is-spinning" size={24} aria-hidden="true" />
              <span>{t("Loading Workspaces")}</span>
            </div>
          ) : (
            <EmptyState
              className="project-empty-detail"
              icon={<Folder size={28} strokeWidth={1.7} />}
              title={t("Add a folder to open with an Agent")}
              description={t("AgentEnv stores the folder reference and changes project files only after an explicit action.")}
              actions={(
                <ControlGroup>
                  <Button
                    variant="primary"
                    busy={operation === "add"}
                    icon={<Folder size={15} />}
                    onClick={() => void addLocalProject()}
                  >
                    {t("Add folder")}
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Server size={15} />}
                    onClick={() => void openAddWorkspaceDialog()}
                  >
                    {t("Add SSH remote workspace")}
                  </Button>
                </ControlGroup>
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
            {menuProject.isRemote ? (
              <ActionMenuItem onClick={() => void copySshCommand(menuProject)}>
                <Terminal size={15} aria-hidden="true" />
                <span>{t("Copy SSH command")}</span>
              </ActionMenuItem>
            ) : null}
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

      {addMenu ? (
        createPortal(
          <ActionMenu
            ariaLabel={t("Add Workspace")}
            className="project-actions-menu project-add-menu"
            menuRef={addMenuRef}
            style={{ left: addMenu.left, top: addMenu.top }}
          >
            <ActionMenuItem
              onClick={() => {
                setAddMenu(undefined);
                void addLocalProject();
              }}
            >
              <Folder size={15} aria-hidden="true" />
              <span>{t("Add local folder")}</span>
            </ActionMenuItem>
            <ActionMenuItem
              onClick={() => {
                setAddMenu(undefined);
                void openAddWorkspaceDialog();
              }}
            >
              <Server size={15} aria-hidden="true" />
              <span>{t("Add SSH remote workspace...")}</span>
            </ActionMenuItem>
          </ActionMenu>,
          document.body
        )
      ) : null}

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
          ariaLabel={t("Add Skills to Workspace")}
          className="resource-picker-dialog resource-picker-dialog--skills resource-picker-dialog--workspace-skills ui-dialog-shell"
          dialogRef={skillDialogRef}
          dismissDisabled={operation === "add-skill"}
          onDismiss={closeSkillPicker}
        >
          <DialogHeader
            title={t("Add Skills to Workspace")}
            description={t("Choose individual Skills or copy every Skill in a reusable Group.")}
          />
          <DialogBody className="resource-picker-dialog__body project-add-skill-fields">
            {modalError ? (
              <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{modalError}</Notice>
            ) : null}
            <div className="project-workspace-skill-selection">
              <LibrarySkillSelection
                groups={availableSkillGroups.filter((group) => group.memberIds.length > 0)}
                mode={skillPickerMode}
                selectedGroupKeys={selectedSkillGroupKeys}
                selectedSkillIds={selectedLibraryIds}
                skillSelectionMode="multiple"
                skills={librarySkills}
                onModeChange={setSkillPickerMode}
                onSelectedGroupKeysChange={setSelectedSkillGroupKeys}
                onSelectedSkillIdsChange={setSelectedLibraryIds}
              />
            </div>
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
            {selectedWorkspaceSkillPlans.length > 0 && selectedSkillLocation ? (
              <div className="project-file-impact" aria-label={t("File impact") }>
                <span>{t("{{count}} regular-file Skill copies", {
                  count: selectedWorkspaceSkillPlans.length
                })}</span>
                <code className="selectable">
                  {selectedSkillLocation.relativePath.replace(/[\\/]+$/, "")}/
                </code>
                <small>{t("Git changes stay unstaged and uncommitted.")}</small>
              </div>
            ) : null}
            {librarySkills.length === 0 ? <p>{t("No enabled Library Skills are available.")}</p> : null}
            {selectedSkillConflicts > 0 ? (
              <Notice tone="warning" title={t("{{count}} Workspace Skills will be replaced", {
                count: selectedSkillConflicts
              })}>
                {t("Each existing copy gets a recovery point before the batch is changed.")}
              </Notice>
            ) : null}
            {selectedSkillMatches > 0 ? (
              <Notice tone="info">
                {t("{{count}} selected Skills already match and will be skipped.", {
                  count: selectedSkillMatches
                })}
              </Notice>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button disabled={operation === "add-skill"} onClick={closeSkillPicker}>
              {t("Cancel")}
            </Button>
            <Button
              variant="primary"
              busy={operation === "add-skill"}
              disabled={!skillLocationId || selectedWorkspaceSkillPlans.length === 0 ||
                selectedSkillMatches === selectedWorkspaceSkillPlans.length}
              onClick={() => void addSkills()}
            >
              {selectedWorkspaceSkillPlans.length > 0 &&
              selectedSkillMatches === selectedWorkspaceSkillPlans.length
                ? t("Already added")
                : selectedSkillConflicts > 0
                  ? t("Replace and add {{count}}", { count: selectedWorkspaceSkillPlans.length })
                  : t("Add {{count}}", { count: selectedWorkspaceSkillPlans.length })}
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
      {addWorkspaceOpen ? (
        <ModalFrame
          ariaLabel={t("Add SSH remote workspace")}
          className="project-add-dialog ui-dialog-shell profile-form-dialog--compact"
          dialogRef={addDialogRef}
          dismissDisabled={operation === "add" || testingPath}
          onDismiss={() => setAddWorkspaceOpen(false)}
        >
          <DialogHeader
            title={t("Add SSH remote workspace")}
            description={t("Connect to a workspace folder on a configured SSH device.")}
          />
          <DialogBody>
            {modalError ? (
              <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>
                {modalError}
              </Notice>
            ) : null}
            <div className="add-workspace-remote-pane">
              {remoteDevices.length === 0 ? (
                <div className="add-workspace-no-devices">
                  <Notice tone="info" icon={<Info size={15} />}>
                    {t("No SSH devices found. Please configure an SSH device first.")}
                  </Notice>
                  {onConfigureRemoteDevices ? (
                    <div className="add-workspace-no-devices__action">
                      <Button
                        variant="secondary"
                        size="compact"
                        icon={<Server size={14} />}
                        onClick={() => {
                          setAddWorkspaceOpen(false);
                          onConfigureRemoteDevices();
                        }}
                      >
                        {t("Go to Agents to configure SSH devices")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <SelectField
                    ref={addInitialFocusRef as any}
                    label={t("SSH device")}
                    value={selectedDeviceId}
                    onChange={(event) => {
                      setSelectedDeviceId(event.target.value);
                      setTestResult(undefined);
                      setRemotePath("");
                      setRemoteName("");
                      setBrowsingPath("");
                      setParentBrowsingPath(undefined);
                      setRemoteDirectories([]);
                      setDirectoryError(undefined);
                    }}
                  >
                    {remoteDevices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name} ({device.host})
                      </option>
                    ))}
                  </SelectField>

                  <div className="add-workspace-browser-field">
                    <label className="ui-field__label">{t("Browse remote directories")}</label>
                    <div className="remote-directory-browser">
                      <div className="remote-directory-browser__header">
                        <div className="remote-directory-browser__current-path" title={browsingPath}>
                          <Folder size={14} className="remote-directory-browser__path-icon" />
                          <span className="remote-directory-browser__path-text">{browsingPath || "/"}</span>
                        </div>
                        <div className="remote-directory-browser__nav-actions">
                          {browsingPath && remotePath !== browsingPath ? (
                            <Button
                              variant="secondary"
                              size="compact"
                              className="remote-directory-browser__select-current-btn"
                              onClick={() => {
                                setRemotePath(browsingPath);
                                const parts = browsingPath.split("/").filter(Boolean);
                                if (parts.length > 0) setRemoteName(parts[parts.length - 1]);
                                setTestResult({ exists: true, canonicalPath: browsingPath });
                              }}
                            >
                              {t("Select this folder")}
                            </Button>
                          ) : null}
                          {parentBrowsingPath ? (
                            <IconButton
                              size="compact"
                              variant="ghost"
                              label={t("Parent folder")}
                              onClick={() => {
                                setRemotePath(parentBrowsingPath);
                                const parts = parentBrowsingPath.split("/").filter(Boolean);
                                if (parts.length > 0) setRemoteName(parts[parts.length - 1]);
                                setTestResult({ exists: true, canonicalPath: parentBrowsingPath });
                                void loadRemoteDirectories(parentBrowsingPath);
                              }}
                              disabled={loadingDirectories}
                            >
                              <ArrowUp size={13} />
                            </IconButton>
                          ) : null}
                          <IconButton
                            size="compact"
                            variant="ghost"
                            label={t("Refresh directories")}
                            onClick={() => void loadRemoteDirectories(browsingPath || undefined)}
                            disabled={loadingDirectories}
                            busy={loadingDirectories}
                          >
                            <RotateCcw size={13} />
                          </IconButton>
                        </div>
                      </div>

                      <div className="remote-directory-browser__body">
                        {loadingDirectories && remoteDirectories.length === 0 ? (
                          <div className="remote-directory-browser__status">
                            <LoaderCircle size={16} className="is-spinning" />
                            <span>{t("Loading remote directories...")}</span>
                          </div>
                        ) : directoryError ? (
                          <div className="remote-directory-browser__status remote-directory-browser__status--error">
                            <AlertTriangle size={14} />
                            <span>{t("Failed to load remote directories: {{error}}", { error: directoryError })}</span>
                          </div>
                        ) : remoteDirectories.length === 0 ? (
                          <div className="remote-directory-browser__status">
                            <span>{t("No subdirectories found in this folder")}</span>
                          </div>
                        ) : (
                          <ul className="remote-directory-browser__list" role="listbox">
                            {remoteDirectories.map((dir) => {
                              const isSelected = remotePath === dir.path;
                              return (
                                <li
                                  key={dir.path}
                                  className={`remote-directory-browser__item${isSelected ? " is-selected" : ""}`}
                                  onClick={() => {
                                    setRemotePath(dir.path);
                                    setRemoteName(dir.name);
                                    setTestResult({ exists: true, canonicalPath: dir.path });
                                  }}
                                  onDoubleClick={() => {
                                    setRemotePath(dir.path);
                                    setRemoteName(dir.name);
                                    setTestResult({ exists: true, canonicalPath: dir.path });
                                    void loadRemoteDirectories(dir.path);
                                  }}
                                  role="option"
                                  aria-selected={isSelected}
                                >
                                  <div className="remote-directory-browser__item-main">
                                    <Folder size={14} className="remote-directory-browser__item-icon" />
                                    <span className="remote-directory-browser__item-name">{dir.name}</span>
                                  </div>
                                  <IconButton
                                    size="compact"
                                    variant="ghost"
                                    className="remote-directory-browser__item-open"
                                    label={t("Navigate into folder")}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRemotePath(dir.path);
                                      setRemoteName(dir.name);
                                      setTestResult({ exists: true, canonicalPath: dir.path });
                                      void loadRemoteDirectories(dir.path);
                                    }}
                                  >
                                    <ChevronRight size={13} />
                                  </IconButton>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                  <TextField
                    label={t("Remote directory path")}
                    placeholder={t("e.g. /home/ubuntu/repo or ~/projects/app")}
                    value={remotePath}
                    onChange={(event) => {
                      setRemotePath(event.target.value);
                      setTestResult(undefined);
                    }}
                  />
                  <TextField
                    label={t("Workspace name (optional)")}
                    placeholder={t("Leave blank to use folder name")}
                    value={remoteName}
                    onChange={(event) => setRemoteName(event.target.value)}
                  />
                  <div className="add-workspace-test-row">
                    <Button
                      variant="secondary"
                      size="compact"
                      disabled={!remotePath.trim() || testingPath}
                      busy={testingPath}
                      onClick={() => void testRemotePath()}
                    >
                      {t("Test path")}
                    </Button>
                    {testResult ? (
                      testResult.exists ? (
                        <span className="add-workspace-test-success">
                          <CheckCircle2 size={14} />
                          <span>{t("Remote path verified: {{path}}", { path: testResult.canonicalPath ?? remotePath })}</span>
                        </span>
                      ) : (
                        <span className="add-workspace-test-error">
                          <AlertTriangle size={14} />
                          <span>{testResult.error ?? t("Remote path does not exist or is not a directory")}</span>
                        </span>
                      )
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button disabled={operation === "add" || testingPath} onClick={() => setAddWorkspaceOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="primary"
              busy={operation === "add"}
              disabled={remoteDevices.length === 0 || !remotePath.trim() || testingPath}
              onClick={() => void addRemoteProject()}
            >
              {t("Add remote workspace")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
    </section>
  );
};
