import { type RefObject, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileWarning,
  Folder,
  LoaderCircle,
  X
} from "lucide-react";
import type {
  SkillFileContent,
  SkillFileNode,
  SkillLibraryEntry
} from "../../shared/types";
import { highlightCode, highlightCodeFallback, languageForPath } from "../syntaxHighlighter";
import { useI18n } from "../i18n";
import { IconButton, ModalFrame } from "./ui";

interface SkillFileBrowserDialogProps {
  skill: SkillLibraryEntry;
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

const tokenStyle = (token: {
  color?: string;
  fontStyle?: number;
}) => ({
  color: token.color,
  fontStyle: token.fontStyle === 1 || token.fontStyle === 3 ? "italic" : undefined,
  fontWeight: token.fontStyle === 2 || token.fontStyle === 3 ? 700 : undefined,
  textDecoration: token.fontStyle === 4 ? "underline" : undefined
});

export const SkillFileBrowserDialog = ({
  skill,
  dialogRef,
  initialFocusRef,
  onListFiles,
  onReadFile,
  onClose
}: SkillFileBrowserDialogProps) => {
  const { t } = useI18n();
  const [tree, setTree] = useState<SkillFileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState("");
  const [file, setFile] = useState<SkillFileContent>();
  const [treeLoading, setTreeLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState("");
  const fallbackTokens = useMemo(
    () => highlightCodeFallback(file?.kind === "text" ? file.content ?? "" : ""),
    [file]
  );
  const [tokens, setTokens] = useState(fallbackTokens);

  useEffect(() => {
    let active = true;
    setTreeLoading(true);
    setError("");
    void onListFiles(skill.id)
      .then((nodes) => {
        if (!active) return;
        setTree(nodes);
        setExpanded(new Set(nodes.filter((node) => node.kind === "directory").map((node) => node.path)));
        setSelectedPath(findSkillMarkdown(nodes) ?? firstFilePath(nodes) ?? "");
      })
      .catch((unknownError) => {
        if (active) setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      })
      .finally(() => {
        if (active) setTreeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onListFiles, skill.id]);

  useEffect(() => {
    if (!selectedPath) {
      setFileLoading(false);
      return;
    }
    let active = true;
    setFileLoading(true);
    setError("");
    setFile(undefined);
    void onReadFile(skill.id, selectedPath)
      .then((content) => {
        if (active) setFile(content);
      })
      .catch((unknownError) => {
        if (active) setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      })
      .finally(() => {
        if (active) setFileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onReadFile, selectedPath, skill.id]);

  useEffect(() => {
    setTokens(fallbackTokens);
    if (file?.kind !== "text") return;
    let active = true;
    void highlightCode(file.content ?? "", file.path).then((nextTokens) => {
      if (active) setTokens(nextTokens);
    });
    return () => {
      active = false;
    };
  }, [fallbackTokens, file]);

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
              {isExpanded
                ? <ChevronDown size={13} strokeWidth={2.2} />
                : <ChevronRight size={13} strokeWidth={2.2} />}
              <Folder size={14} strokeWidth={2} />
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
            onClick={() => setSelectedPath(node.path)}
          >
            <File size={14} strokeWidth={2} />
            <span>{node.name}</span>
          </button>
        </li>
      );
    });

  return (
    <ModalFrame
      ariaLabel={t("Files in {{name}}", { name: skill.name })}
      className="skill-file-browser"
      dialogRef={dialogRef}
      onDismiss={onClose}
    >
      <header className="profile-dialog-header skill-file-browser__header">
        <div>
          <div className="section-title">{skill.name}</div>
          <p className="muted">{t("Read-only Library files")}</p>
        </div>
        <IconButton ref={initialFocusRef} label={t("Close")} onClick={onClose} variant="ghost">
          <X size={16} strokeWidth={2.2} />
        </IconButton>
      </header>
      <div className="skill-file-browser__body">
        <aside className="skill-file-tree" aria-label={t("Skill file tree")}>
          {treeLoading ? (
            <div className="skill-file-browser__state" role="status">
              <LoaderCircle className="is-spinning" size={16} />
              {t("Loading files")}
            </div>
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
              <pre>
                <code>
                  {tokens.map((line, lineIndex) => (
                    <span className="skill-file-preview__line" key={`${lineIndex}:${line.length}`}>
                      {line.length > 0
                        ? line.map((token, tokenIndex) => (
                            <span
                              key={`${tokenIndex}:${token.content}`}
                              style={tokenStyle(token)}
                            >
                              {token.content}
                            </span>
                          ))
                        : "\u00a0"}
                    </span>
                  ))}
                </code>
              </pre>
            ) : (
              <div className="skill-file-browser__state">{t("Select a file")}</div>
            )}
          </div>
        </section>
      </div>
    </ModalFrame>
  );
};
