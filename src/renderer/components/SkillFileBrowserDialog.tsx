import { type RefObject, useEffect, useState } from "react";
import {
  FileWarning,
  LoaderCircle,
  RefreshCw
} from "lucide-react";
import type {
  SkillFileContent,
  SkillFileNode,
  SkillLibraryEntry,
  SkillUpdateInfo
} from "../../shared/types";
import { languageForPath } from "../syntaxHighlighter";
import { useI18n } from "../i18n";
import { DocumentDialogFrame } from "./DocumentDialogFrame";
import { FileTypeIcon } from "./FileTypeIcon";
import { SyntaxCodePreview } from "./SyntaxCodePreview";
import { Button, DetailList, DialogBody, DisclosureIcon, TextAction, TabBar } from "./ui";
import { skillMaintenanceLabel } from "./SkillMaintenanceStatus";
import { skillMaintenanceState } from "../skillMaintenanceState";

interface SkillFileBrowserDialogProps {
  skill: SkillLibraryEntry;
  update?: SkillUpdateInfo;
  profileNames?: string[];
  installations?: Array<{ agents: string; path: string; method: string; status: string }>;
  inventoryNotice?: string;
  onUpdateSettings?(): void;
  onReviewProfiles?(): void;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  onListFiles(id: string): Promise<SkillFileNode[]>;
  onReadFile(id: string, path: string): Promise<SkillFileContent>;
  onClose(): void;
}

const firstFilePath = (nodes: SkillFileNode[]): string | undefined => {
  for (const node of nodes) {
    if (node.kind === "file") return node.path;
    const child = firstFilePath(node.children ?? []);
    if (child) return child;
  }
  return undefined;
};

const findSkillMarkdown = (nodes: SkillFileNode[]): string | undefined => {
  for (const node of nodes) {
    if (node.kind === "file" && node.name.toLowerCase() === "skill.md") return node.path;
    const child = findSkillMarkdown(node.children ?? []);
    if (child) return child;
  }
  return undefined;
};

export const SkillFileBrowserDialog = ({
  skill,
  update,
  profileNames = [],
  installations = [],
  inventoryNotice,
  onUpdateSettings,
  onReviewProfiles,
  dialogRef,
  initialFocusRef,
  onListFiles,
  onReadFile,
  onClose
}: SkillFileBrowserDialogProps) => {
  const { t, localeTag } = useI18n();
  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short" }).format(date);
  };
  const [tree, setTree] = useState<SkillFileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<{ skillId: string; path: string }>();
  const selectedPath = selection?.skillId === skill.id ? selection.path : "";
  const [file, setFile] = useState<SkillFileContent>();
  const [treeLoading, setTreeLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [treeError, setTreeError] = useState("");
  const [fileError, setFileError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [fileRetryVersion, setFileRetryVersion] = useState(0);
  const error = treeError || fileError;
  const [tab, setTab] = useState<"files" | "details">("files");
  useEffect(() => setTab("files"), [skill.id]);
  const detailItems = [
    { label: t("Description"), value: skill.description || t("Unavailable") },
    { label: t("Status"), value: t(skillMaintenanceLabel(skillMaintenanceState(skill, update))) },
    ...(update?.error ? [{ label: t("Check failed"), value: update.error }] : []),
    ...(update?.sourceStatus === "removed" ? [{ label: t("Removed upstream"), value: t("The tracked source no longer contains this Skill. The Library copy is unchanged.") }] : []),
    { label: t("Check updates"), value: skill.updatePolicy === "tracked" ? t("Enabled") : t("No update checks"),
      action: onUpdateSettings ? <TextAction onClick={onUpdateSettings}>{t("Update settings")}</TextAction> : undefined },
    { label: t("Profiles"), value: profileNames.join("\n") || t("Not referenced"),
      action: onReviewProfiles && profileNames.length > 0 ? <TextAction onClick={onReviewProfiles}>{t("Review Profiles")}</TextAction> : undefined },
    { label: t("Agent copies"), value: [installations.length ? installations.map((install) =>
      `${install.agents} · ${install.method} · ${install.status}\n${install.path}`
    ).join("\n\n") : inventoryNotice ? undefined : t("No detected copies"), inventoryNotice].filter(Boolean).join("\n\n") },
    { label: t("Library path"), value: skill.path },
    { label: t("Source"), value: skill.source ?? skill.upstream?.locator ?? t("Local") },
    ...(skill.version ? [{ label: t("Version"), value: skill.version }] : []),
    ...(skill.remoteRef || skill.upstream?.ref ? [{ label: t("Ref"), value: skill.remoteRef ?? skill.upstream?.ref }] : []),
    { label: t("Library revision"), value: skill.remoteRevision ?? skill.upstream?.revision ?? t("Unavailable") },
    ...(update?.latestRevision ? [{ label: t("Upstream revision"), value: update.latestRevision }] : []),
    { label: t("Hash"), value: skill.contentHash },
    { label: t("Library updated"), value: formatDate(skill.updatedAt) },
    ...(update?.latestUpdatedAt || skill.upstream?.updatedAt ? [{ label: t("Source updated"), value: formatDate((update?.latestUpdatedAt ?? skill.upstream?.updatedAt)!) }] : []),
  ];

  useEffect(() => {
    let active = true;
    setTreeLoading(true);
    setTree([]);
    setSelection(undefined);
    setTreeError("");
    void onListFiles(skill.id)
      .then((nodes) => {
        if (!active) return;
        setTree(nodes);
        setExpanded(new Set(nodes.filter((node) => node.kind === "directory").map((node) => node.path)));
        setSelection({ skillId: skill.id, path: findSkillMarkdown(nodes) ?? firstFilePath(nodes) ?? "" });
      })
      .catch((unknownError) => {
        if (active) setTreeError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      })
      .finally(() => {
        if (active) setTreeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onListFiles, skill.id, reloadVersion]);

  useEffect(() => {
    if (!selectedPath) {
      setFile(undefined);
      setFileError("");
      setFileLoading(false);
      return;
    }
    let active = true;
    setFileLoading(true);
    setFileError("");
    setFile(undefined);
    void onReadFile(skill.id, selectedPath)
      .then((content) => {
        if (active) setFile(content);
      })
      .catch((unknownError) => {
        if (active) setFileError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      })
      .finally(() => {
        if (active) setFileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onReadFile, selectedPath, skill.id, fileRetryVersion]);

  const renderNodes = (nodes: SkillFileNode[], depth = 0) =>
    nodes.map((node) => {
      const isExpanded = expanded.has(node.path);
      if (node.kind === "directory") {
        return (
          <li key={node.path} role="treeitem" aria-expanded={isExpanded}>
            <button
              className="skill-file-tree__item is-directory"
              type="button"
              style={{ paddingInlineStart: `${10 + depth * 14}px` }}
              onClick={() => setExpanded((current) => {
                const next = new Set(current);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              })}
            >
              <DisclosureIcon open={isExpanded} size={13} />
              <FileTypeIcon expanded={isExpanded} kind="directory" path={node.path} />
              <span>{node.name}</span>
            </button>
            {isExpanded && node.children?.length ? (
              <ul role="group">{renderNodes(node.children, depth + 1)}</ul>
            ) : null}
          </li>
        );
      }
      return (
        <li key={node.path} role="treeitem" aria-selected={selectedPath === node.path}>
          <button
            className={`skill-file-tree__item is-file${selectedPath === node.path ? " is-selected" : ""}`}
            type="button"
            style={{ paddingInlineStart: `${27 + depth * 14}px` }}
            onClick={() => setSelection({ skillId: skill.id, path: node.path })}
          >
            <FileTypeIcon kind="file" path={node.path} />
            <span>{node.name}</span>
          </button>
        </li>
      );
    });

  return (
    <DocumentDialogFrame
      ariaLabel={t("Files in {{name}}", { name: skill.name })}
      backdropClassName="skill-file-browser-backdrop"
      className="skill-file-browser"
      closeButtonRef={initialFocusRef}
      description={t("Read-only Library files")}
      dialogRef={dialogRef}
      resetKey={skill.id}
      title={skill.name}
      onClose={onClose}
    >
      <div className="skill-file-browser__navigation">
      <TabBar<"files" | "details"> label={t("Skill details")} value={tab} onChange={setTab}
        idPrefix="skill-inspector" panelId="skill-inspector-panel"
        options={[{ value: "files", label: t("Files") }, { value: "details", label: t("Details") }]} />
      </div>
      <DialogBody hidden={tab !== "details"} id={tab === "details" ? "skill-inspector-panel" : undefined} role="tabpanel" aria-labelledby="skill-inspector-details">
        <DetailList items={detailItems} />
      </DialogBody>
      <div hidden={tab !== "files"} className="skill-file-browser__body" id={tab === "files" ? "skill-inspector-panel" : undefined} role="tabpanel" aria-labelledby="skill-inspector-files">
        <aside className="skill-file-tree" aria-label={t("Skill file tree")}>
          {treeLoading ? (
            <div className="skill-file-browser__state" role="status">
              <LoaderCircle className="is-spinning" size={16} />
              {t("Loading files")}
            </div>
          ) : treeError ? (
            <div className="skill-file-browser__state">{t("Could not load files")}</div>
          ) : tree.length > 0 ? (
            <ul role="tree">{renderNodes(tree)}</ul>
          ) : (
            <div className="skill-file-browser__state">{t("No previewable files")}</div>
          )}
        </aside>
        <section className="skill-file-preview" aria-label={t("File preview")}>
          <header>
            <span>{selectedPath || t("Select a file")}</span>
            {file?.kind === "text" ? <code>{languageForPath(file.path)}</code> : null}
          </header>
          <div className="skill-file-preview__content">
            {fileLoading ? (
              <div className="skill-file-browser__state" role="status">
                <LoaderCircle className="is-spinning" size={16} />
                {t("Loading preview")}
              </div>
            ) : error ? (
              <div className="skill-file-browser__state is-error" role="alert">
                <FileWarning size={17} />
                <span>{error}</span>
                <Button icon={<RefreshCw size={15} />} onClick={() => treeError
                  ? setReloadVersion((value) => value + 1)
                  : setFileRetryVersion((value) => value + 1)}>{t("Retry")}</Button>
              </div>
            ) : file?.kind === "binary" ? (
              <div className="skill-file-browser__state">
                <FileWarning size={17} />
                <span>{t("Binary files cannot be previewed")}</span>
              </div>
            ) : file?.kind === "too-large" ? (
              <div className="skill-file-browser__state">
                <FileWarning size={17} />
                <span>{t("This file is too large to preview")}</span>
              </div>
            ) : file?.kind === "text" ? (
              <SyntaxCodePreview code={file.content ?? ""} path={file.path} />
            ) : (
              <div className="skill-file-browser__state">{t("Select a file")}</div>
            )}
          </div>
        </section>
      </div>
    </DocumentDialogFrame>
  );
};
