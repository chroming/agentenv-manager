import {
  ChevronDown,
  ChevronRight,
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
import { FileTypeIcon } from "./FileTypeIcon";
import { SyntaxCodePreview } from "./SyntaxCodePreview";
import { IconButton, ModalFrame } from "./ui";

interface DiffWorkspaceDialogProps {
  changes: PlannedFileChange[];
  readonlyFiles?: Array<{ content: string; path: string }>;
  open: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  title: string;
  onClose(): void;
}

interface DiffTreeNode {
  children: DiffTreeNode[];
  changeIndex?: number;
  changeKind?: "add" | "remove" | "replace";
  hasChanges: boolean;
  id: string;
  kind: "directory" | "file";
  name: string;
  readonlyPath?: string;
}

const normalizePath = (path: string) => path.replaceAll("\\", "/");

const displayPathsFor = (inputPaths: string[]) => {
  const paths = inputPaths.map(normalizePath);
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

function changeAction(change: PlannedFileChange) {
  if (change.action === "remove" || (change.before && !change.after)) return "Remove";
  if (!change.before && change.after) return "Add";
  return "Replace";
}

const treeFor = (
  paths: string[],
  sourcePaths: string[],
  changedPathIndexes: Map<string, number>,
  readonlyPaths: Set<string>,
  changes: PlannedFileChange[]
): DiffTreeNode[] => {
  const root: DiffTreeNode[] = [];
  paths.forEach((path, pathIndex) => {
    const parts = path.split("/").filter(Boolean);
    let level = root;
    parts.forEach((part, index) => {
      const id = parts.slice(0, index + 1).join("/");
      let node = level.find((candidate) => candidate.id === id);
      if (!node) {
        node = {
          children: [],
          hasChanges: false,
          id,
          kind: index === parts.length - 1 ? "file" : "directory",
          name: part
        };
        level.push(node);
      }
      if (index === parts.length - 1) {
        const changeIndex = changedPathIndexes.get(normalizePath(sourcePaths[pathIndex] ?? path));
        node.kind = "file";
        node.changeIndex = changeIndex;
        node.readonlyPath = readonlyPaths.has(normalizePath(sourcePaths[pathIndex] ?? path))
          ? normalizePath(sourcePaths[pathIndex] ?? path)
          : undefined;
        if (changeIndex !== undefined) {
          node.changeKind = changeAction(changes[changeIndex]).toLowerCase() as DiffTreeNode["changeKind"];
          node.hasChanges = true;
        }
      }
      level = node.children;
    });
  });

  const markChangedDirectories = (nodes: DiffTreeNode[]): boolean => {
    let levelHasChanges = false;
    for (const node of nodes) {
      if (node.kind === "directory") {
        node.hasChanges = markChangedDirectories(node.children);
      }
      levelHasChanges = levelHasChanges || node.hasChanges;
    }
    return levelHasChanges;
  };
  markChangedDirectories(root);

  const sort = (nodes: DiffTreeNode[]) => {
    nodes.sort((left, right) => {
      const leftDirectory = left.kind === "directory";
      const rightDirectory = right.kind === "directory";
      if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    nodes.forEach((node) => sort(node.children));
  };
  sort(root);
  return root;
};

export const DiffWorkspaceDialog = ({
  changes,
  readonlyFiles = [],
  open,
  returnFocusRef,
  title,
  onClose
}: DiffWorkspaceDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragStartRef = useRef<{ pointerX: number; width: number } | undefined>(undefined);
  const [treeWidth, setTreeWidth] = useState(248);
  const [selectedIndex, setSelectedIndex] = useState(changes.length > 0 ? 0 : -1);
  const [selectedReadonlyPath, setSelectedReadonlyPath] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const changeSetKey = useMemo(
    () => [
      ...changes.map((change) => `${change.action ?? "replace"}:${change.path}`),
      ...readonlyFiles.map((file) => `readonly:${file.path}`)
    ].join("|"),
    [changes, readonlyFiles]
  );
  const indexedPaths = useMemo(() => {
    const paths = [...new Set([
      ...readonlyFiles.map((file) => file.path),
      ...changes.map((change) => change.path)
    ].map(normalizePath))];
    return paths.length > 0 ? paths : changes.map((change) => normalizePath(change.path));
  }, [changes, readonlyFiles]);
  const display = useMemo(
    () => displayPathsFor(indexedPaths),
    [indexedPaths]
  );
  const displayPathBySource = useMemo(
    () => new Map(indexedPaths.map((path, index) => [path, display.paths[index] ?? path])),
    [display.paths, indexedPaths]
  );
  const changedPathIndexes = useMemo(
    () => new Map(changes.map((change, index) => [normalizePath(change.path), index])),
    [changes]
  );
  const readonlyFileByPath = useMemo(
    () => new Map(readonlyFiles.map((file) => [normalizePath(file.path), file])),
    [readonlyFiles]
  );
  const tree = useMemo(
    () => treeFor(
      display.paths,
      indexedPaths,
      changedPathIndexes,
      new Set(readonlyFileByPath.keys()),
      changes
    ),
    [changedPathIndexes, changes, display.paths, indexedPaths, readonlyFileByPath]
  );
  const selected = selectedIndex >= 0 ? changes[selectedIndex] : undefined;
  const firstReadonlyPath = normalizePath(readonlyFiles[0]?.path ?? "");
  const selectedReadonly = selected
    ? undefined
    : readonlyFileByPath.get(selectedReadonlyPath) ?? readonlyFiles[0];

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
    setSelectedIndex(changes.length > 0 ? 0 : -1);
    setSelectedReadonlyPath(firstReadonlyPath);
    setCollapsed(new Set());
  }, [changes.length, open, changeSetKey, firstReadonlyPath]);

  if (!open || (!selected && !selectedReadonly)) return null;

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
      const isFile = node.kind === "file";
      const isSelected = isFile && (
        (node.changeIndex === selectedIndex && selected !== undefined) ||
        node.readonlyPath === normalizePath(selectedReadonly?.path ?? "")
      );
      const isCollapsed = collapsed.has(node.id);
      const changeClass = node.changeKind ? ` is-${node.changeKind}` : "";
      return (
        <li key={node.id}>
          <button
            className={`diff-workspace__tree-item${node.hasChanges ? " has-changes" : ""}${changeClass}${isSelected ? " is-selected" : ""}`}
            style={{ paddingInlineStart: `${10 + depth * 16}px` }}
            type="button"
            aria-expanded={isFile ? undefined : !isCollapsed}
            onClick={() => {
              if (isFile) {
                if (node.changeIndex !== undefined) setSelectedIndex(node.changeIndex);
                else if (node.readonlyPath) {
                  setSelectedIndex(-1);
                  setSelectedReadonlyPath(node.readonlyPath);
                }
                return;
              }
              toggleDirectory(node.id);
            }}
          >
            {isFile ? (
              <>
                <span className="diff-workspace__tree-chevron-placeholder" aria-hidden="true" />
                <FileTypeIcon kind="file" path={node.name} />
              </>
            ) : isCollapsed ? (
              <>
                <ChevronRight className="diff-workspace__tree-chevron" size={13} aria-hidden="true" />
                <FileTypeIcon kind="directory" path={node.name} />
              </>
            ) : (
              <>
                <ChevronDown className="diff-workspace__tree-chevron" size={13} aria-hidden="true" />
                <FileTypeIcon expanded kind="directory" path={node.name} />
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
      ariaLabel={t("Full-screen preview")}
      backdropClassName="diff-workspace-backdrop"
      className="diff-workspace is-maximized"
      dialogRef={dialogRef}
      onDismiss={onClose}
    >
      <header className="diff-workspace__header ui-dialog-header">
        <div className="ui-dialog-header__copy">
          <div className="section-title ui-dialog-title">{title}</div>
          <p className="muted ui-dialog-description">
            {changes.length > 0
              ? t("{{count}} changed files", { count: changes.length })
              : t("{{count}} files", { count: readonlyFiles.length })}
          </p>
        </div>
        <div className="diff-workspace__window-actions">
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
              <strong title={selected?.path ?? selectedReadonly!.path}>
                {displayPathBySource.get(normalizePath(selected?.path ?? selectedReadonly!.path)) ??
                  selected?.path ?? selectedReadonly!.path}
              </strong>
              <span title={selected?.path ?? selectedReadonly!.path}>
                {selected?.path ?? selectedReadonly!.path}
              </span>
            </div>
            {selected ? (
              <span className={`change-kind change-kind--${changeAction(selected).toLowerCase()}`}>
                {t(changeAction(selected))}
              </span>
            ) : null}
          </header>
          <div className="diff-workspace__diff">
            {selected ? (
              <DiffViewer path={selected.path} diff={selected.diff} />
            ) : (
              <SyntaxCodePreview
                code={selectedReadonly!.content}
                path={selectedReadonly!.path}
              />
            )}
          </div>
        </main>
      </div>
    </ModalFrame>
  );
};
