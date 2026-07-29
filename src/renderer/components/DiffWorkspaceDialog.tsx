import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  Maximize2,
  Minimize2,
  X
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject
} from "react";
import type { PlannedFileChange } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { DiffViewer } from "./DiffViewer";
import { IconButton, ModalFrame } from "./ui";

interface DiffWorkspaceDialogProps {
  changes: PlannedFileChange[];
  open: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  title: string;
  onClose(): void;
}

interface DiffTreeNode {
  children: DiffTreeNode[];
  changeIndex?: number;
  id: string;
  name: string;
}

const normalizePath = (path: string) => path.replaceAll("\\", "/");

const displayPathsFor = (changes: PlannedFileChange[]) => {
  const paths = changes.map((change) => normalizePath(change.path));
  if (paths.length < 2 || paths.some((path) => !path.startsWith("/"))) {
    return { paths: paths.map((path) => path.replace(/^\/+/, "")), root: "" };
  }

  const split = paths.map((path) => path.split("/").filter(Boolean));
  const common: string[] = [];
  const directoryLimit = Math.min(...split.map((parts) => Math.max(0, parts.length - 1)));
  for (let index = 0; index < directoryLimit; index += 1) {
    const segment = split[0]?.[index];
    if (!segment || split.some((parts) => parts[index] !== segment)) break;
    common.push(segment);
  }

  return {
    paths: split.map((parts) => parts.slice(common.length).join("/")),
    root: common.length > 0 ? `/${common.join("/")}` : "/"
  };
};

const treeFor = (paths: string[]): DiffTreeNode[] => {
  const root: DiffTreeNode[] = [];
  paths.forEach((path, changeIndex) => {
    const parts = path.split("/").filter(Boolean);
    let level = root;
    parts.forEach((part, index) => {
      const id = parts.slice(0, index + 1).join("/");
      let node = level.find((candidate) => candidate.id === id);
      if (!node) {
        node = { children: [], id, name: part };
        level.push(node);
      }
      if (index === parts.length - 1) node.changeIndex = changeIndex;
      level = node.children;
    });
  });

  const sort = (nodes: DiffTreeNode[]) => {
    nodes.sort((left, right) => {
      const leftDirectory = left.changeIndex === undefined;
      const rightDirectory = right.changeIndex === undefined;
      if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    nodes.forEach((node) => sort(node.children));
  };
  sort(root);
  return root;
};

const changeAction = (change: PlannedFileChange) => {
  if (change.action === "remove" || (change.before && !change.after)) return "Remove";
  if (!change.before && change.after) return "Add";
  return "Replace";
};

export const DiffWorkspaceDialog = ({
  changes,
  open,
  returnFocusRef,
  title,
  onClose
}: DiffWorkspaceDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragStartRef = useRef<{ pointerX: number; width: number } | undefined>(undefined);
  const [maximized, setMaximized] = useState(false);
  const [treeWidth, setTreeWidth] = useState(248);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const changeSetKey = useMemo(
    () => changes.map((change) => `${change.action ?? "replace"}:${change.path}`).join("|"),
    [changes]
  );
  const display = useMemo(() => displayPathsFor(changes), [changes]);
  const tree = useMemo(() => treeFor(display.paths), [display.paths]);
  const selected = changes[selectedIndex] ?? changes[0];

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: closeRef,
    fallbackFocusRef: returnFocusRef,
    onDismiss: onClose,
    focusKey: `${title}:${changes.map((change) => change.path).join("|")}`
  });

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    setCollapsed(new Set());
    setMaximized(false);
  }, [open, changeSetKey]);

  if (!open || !selected) return null;

  const toggleDirectory = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNodes = (nodes: DiffTreeNode[], depth = 0) =>
    nodes.map((node) => {
      const isFile = node.changeIndex !== undefined;
      const isCollapsed = collapsed.has(node.id);
      return (
        <li key={node.id}>
          <button
            className={`diff-workspace__tree-item${isFile && node.changeIndex === selectedIndex ? " is-selected" : ""}`}
            style={{ paddingInlineStart: `${10 + depth * 16}px` }}
            type="button"
            aria-expanded={isFile ? undefined : !isCollapsed}
            onClick={() => {
              if (isFile) setSelectedIndex(node.changeIndex!);
              else toggleDirectory(node.id);
            }}
          >
            {isFile ? (
              <FileCode2 size={15} strokeWidth={1.9} aria-hidden="true" />
            ) : isCollapsed ? (
              <>
                <ChevronRight className="diff-workspace__tree-chevron" size={13} aria-hidden="true" />
                <Folder size={15} strokeWidth={1.9} aria-hidden="true" />
              </>
            ) : (
              <>
                <ChevronDown className="diff-workspace__tree-chevron" size={13} aria-hidden="true" />
                <FolderOpen size={15} strokeWidth={1.9} aria-hidden="true" />
              </>
            )}
            <span title={node.name}>{node.name}</span>
          </button>
          {!isFile && !isCollapsed ? (
            <ul>{renderNodes(node.children, depth + 1)}</ul>
          ) : null}
        </li>
      );
    });

  const updateTreeWidth = (next: number) => {
    const max = Math.min(420, Math.max(220, window.innerWidth * 0.42));
    setTreeWidth(Math.round(Math.max(180, Math.min(max, next))));
  };
  const handleSplitterKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    updateTreeWidth(treeWidth + (event.key === "ArrowLeft" ? -16 : 16));
  };
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = { pointerX: event.clientX, width: treeWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateTreeWidth(start.width + event.clientX - start.pointerX);
  };

  return (
    <ModalFrame
      ariaLabel={t("Expanded diff preview")}
      backdropClassName="diff-workspace-backdrop"
      className={`diff-workspace${maximized ? " is-maximized" : ""}`}
      dialogRef={dialogRef}
      onDismiss={onClose}
    >
      <header className="diff-workspace__header ui-dialog-header">
        <div className="ui-dialog-header__copy">
          <div className="section-title ui-dialog-title">{title}</div>
          <p className="muted ui-dialog-description">
            {t("{{count}} changed files", { count: changes.length })}
          </p>
        </div>
        <div className="diff-workspace__window-actions">
          <IconButton
            label={t(maximized ? "Restore preview size" : "Maximize preview")}
            onClick={() => setMaximized((current) => !current)}
          >
            {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </IconButton>
          <IconButton ref={closeRef} label={t("Close")} onClick={onClose}>
            <X size={17} />
          </IconButton>
        </div>
      </header>

      <div
        className="diff-workspace__body"
        style={{ gridTemplateColumns: `${treeWidth}px 5px minmax(0, 1fr)` }}
      >
        <aside className="diff-workspace__tree" aria-label={t("Diff file tree")}>
          {display.root ? (
            <div className="diff-workspace__root" title={display.root}>{display.root}</div>
          ) : null}
          <ul>{renderNodes(tree)}</ul>
        </aside>
        <div
          className="diff-workspace__splitter"
          role="separator"
          aria-label={t("Resize file tree")}
          aria-orientation="vertical"
          aria-valuemin={180}
          aria-valuemax={420}
          aria-valuenow={treeWidth}
          tabIndex={0}
          onKeyDown={handleSplitterKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => {
            dragStartRef.current = undefined;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />
        <main className="diff-workspace__preview">
          <header>
            <div>
              <strong title={selected.path}>{display.paths[selectedIndex] ?? selected.path}</strong>
              <span title={selected.path}>{selected.path}</span>
            </div>
            <span className={`change-kind change-kind--${changeAction(selected).toLowerCase()}`}>
              {t(changeAction(selected))}
            </span>
          </header>
          <div className="diff-workspace__diff">
            <DiffViewer path={selected.path} diff={selected.diff} />
          </div>
        </main>
      </div>
    </ModalFrame>
  );
};
