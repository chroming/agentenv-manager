import { Expand, Eye, FileInput, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import type {
  CreateInstructionBlockInput,
  InstructionBlock,
  InstructionFileSelection
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { InstructionBlockEditorDialog } from "./InstructionBlockEditorDialog";
import { InstructionDocumentDialog } from "./InstructionDocumentDialog";
import { InstructionDocumentPreviewList } from "./InstructionDocumentPreviewList";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIcon } from "./ResourceIconPicker";
import {
  ActionMenu,
  ActionMenuItem,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  InspectorHeader,
  IconButton,
  MasterDetailLayout,
  MasterDetailPane,
  MasterListPane,
  ModalFrame,
  SearchField,
  SelectableListRow,
  ToolbarOverflowMenu,
  focusInitialActionMenuItem
} from "./ui";

interface InstructionsWorkspaceProps {
  blocks: InstructionBlock[];
  loading: boolean;
  onCreate(input: CreateInstructionBlockInput): Promise<void>;
  onImport(): Promise<InstructionFileSelection | undefined>;
  onRefresh(): Promise<void> | void;
  onRemove(block: InstructionBlock): Promise<void>;
  onUpdate(block: InstructionBlock, input: CreateInstructionBlockInput): Promise<void>;
}

export const InstructionsWorkspace = ({
  blocks,
  loading,
  onCreate,
  onImport,
  onRefresh,
  onRemove,
  onUpdate
}: InstructionsWorkspaceProps) => {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [editor, setEditor] = useState<{ block?: InstructionBlock; initial?: InstructionFileSelection }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<InstructionBlock>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [previewBlock, setPreviewBlock] = useState<InstructionBlock>();
  const [contextMenu, setContextMenu] = useState<{
    blockId: string;
    left: number;
    top: number;
  }>();
  const deleteDialogRef = useRef<HTMLElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextReturnFocusRef = useRef<HTMLElement>(null);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return blocks.filter((block) => !normalized || [block.name, block.description, block.content]
      .some((value) => value.toLocaleLowerCase().includes(normalized)));
  }, [blocks, query]);
  const selected = blocks.find((block) => block.id === selectedId) ?? visible[0];
  const contextBlock = blocks.find((block) => block.id === contextMenu?.blockId);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(
      Math.max(margin, contextMenu.left),
      Math.max(margin, window.innerWidth - rect.width - margin)
    );
    const top = Math.min(
      Math.max(margin, contextMenu.top),
      Math.max(margin, window.innerHeight - rect.height - margin)
    );
    if (left !== contextMenu.left || top !== contextMenu.top) {
      setContextMenu((current) => current ? { ...current, left, top } : current);
      return;
    }
    focusInitialActionMenuItem(contextMenuRef.current);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const dismiss = (restoreFocus = false) => {
      setContextMenu(undefined);
      if (restoreFocus) {
        window.requestAnimationFrame(() => contextReturnFocusRef.current?.focus());
      }
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest(".instruction-row-context-menu")) {
        dismiss();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss(true);
      }
    };
    const handleWindowChange = () => dismiss();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [contextMenu]);

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteCandidate(undefined);
    setDeleteError("");
  };

  useModalDialog({
    open: Boolean(deleteCandidate),
    dialogRef: deleteDialogRef,
    initialFocusRef: deleteCancelRef,
    onDismiss: closeDeleteDialog,
    dismissDisabled: deleting
  });

  const save = async (input: CreateInstructionBlockInput) => {
    setSaving(true);
    setError("");
    try {
      if (editor?.block) await onUpdate(editor.block, input);
      else await onCreate(input);
      setEditor(undefined);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="instructions-workspace">
      <h2 className="ui-visually-hidden">{t("Instructions")}</h2>
      <MasterDetailLayout className="instructions-catalog" listWidth="compact" appearance="canvas">
        <MasterListPane className="instructions-list-pane">
          <div className="instructions-list-toolbar" role="toolbar" aria-label={t("Instruction actions")}>
          <SearchField
            fieldClassName="instructions-search"
            label={t("Search Instructions")}
            placeholder={t("Search Instructions...")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
            <IconButton label={t("New")} variant={blocks.length === 0 ? "primary" : "secondary"} onClick={() => setEditor({})}><Plus size={15} /></IconButton>
            <ToolbarOverflowMenu label={t("More")} menuLabel={t("Instruction actions")} busy={loading} items={[
              { id: "import", label: t("Import"), icon: <FileInput size={14} />, onSelect: () => void onImport().then((initial) => { if (initial) setEditor({ initial }); }) },
              { id: "refresh", label: t("Refresh"), icon: <RefreshCw size={14} />, disabled: loading, onSelect: () => void onRefresh() }
            ]} />

          </div>
          <div className="instructions-list" role="list">
            {visible.map((block) => {
              return (
                <SelectableListRow
                  className="instructions-list-row"
                  key={block.id}
                  selected={selected?.id === block.id}
                  icon={<ResourceIcon iconKey={block.iconKey ?? "file"} size={17} />}
                  title={block.name}
                  titleEmphasis="selected"
                  tooltip={[block.name, block.description].filter(Boolean).join("\n")}
                  onSelect={() => setSelectedId(block.id)}
                  onContextMenu={(event: ReactMouseEvent<HTMLElement>) => {
                    event.preventDefault();
                    contextReturnFocusRef.current = event.currentTarget;
                    setSelectedId(block.id);
                    setContextMenu({ blockId: block.id, left: event.clientX, top: event.clientY });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    contextReturnFocusRef.current = event.currentTarget;
                    setSelectedId(block.id);
                    setContextMenu({ blockId: block.id, left: rect.left + 24, top: rect.top + 24 });
                  }}
                />
              );
            })}
          </div>
        </MasterListPane>
        <MasterDetailPane className="instructions-detail-pane">
          {selected ? (
            <>
              <InspectorHeader
                icon={<ResourceIcon iconKey={selected.iconKey ?? "file"} size={18} />}
                title={selected.name}
                description={selected.description || selected.usedByProfiles?.length ? (
                  <span className="instructions-context">
                    {selected.description ? (
                      <OverflowTooltip
                        className="instructions-detail-description"
                        text={selected.description}
                      />
                    ) : null}
                    {(selected.usedByProfiles?.length ?? 0) > 0 ? (
                      <OverflowTooltip
                        className="instructions-detail-usage"
                        ariaLabel={`${selected.usedByProfiles!.length === 1 ? t("Used by 1 Profile") : t("Used by {{count}} Profiles", { count: selected.usedByProfiles!.length })}: ${selected.usedByProfiles!.join(", ")}`}
                        displayContent={t(selected.usedByProfiles!.length === 1 ? "{{count}} Profile" : "{{count}} Profiles", { count: selected.usedByProfiles!.length })}
                        text={selected.usedByProfiles!.join(", ")}
                        focusable
                      />
                    ) : null}
                  </span>
                ) : undefined}
                actions={(
                  <>
                    <IconButton
                      label={t("Open {{name}}", { name: "CONTENT.md" })}
                      variant="ghost"
                      onClick={() => setPreviewBlock(selected)}
                    >
                      <Expand size={14} />
                    </IconButton>
                    <IconButton label={t("Edit")} variant="ghost" onClick={() => setEditor({ block: selected })}><Pencil size={14} /></IconButton>
                    <ToolbarOverflowMenu
                      items={[{
                        id: "delete",
                        icon: <Trash2 size={14} />,
                        label: t("Delete"),
                        onSelect: () => setDeleteCandidate(selected)
                      }]}
                      label={t("More actions for {{name}}", { name: selected.name })}
                      menuLabel={t("Actions for {{name}}", { name: selected.name })}
                    />
                  </>
                )}
              />
              <InstructionDocumentPreviewList
                showHeader={false}
                appearance="canvas"
                fillAvailable
                documents={[{
                  id: selected.id,
                  name: "CONTENT.md",
                  syntaxPath: "CONTENT.md",
                  content: selected.content
                }]}
                onOpen={() => setPreviewBlock(selected)}
              />
            </>
          ) : (
            <EmptyState
              title={t("No Instruction Blocks")}
              description={t("Create reusable instructions, then add them to Profiles.")}
              actions={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditor({})}>{t("New Instruction")}</Button>}
            />
          )}
        </MasterDetailPane>
      </MasterDetailLayout>
      <InstructionBlockEditorDialog
        block={editor?.block}
        initial={editor?.initial}
        open={Boolean(editor)}
        saving={saving}
        error={error}
        onClose={() => { if (!saving) { setEditor(undefined); setError(""); } }}
        onSave={save}
      />
      {previewBlock ? (
        <InstructionDocumentDialog
          open
          ariaLabel={t("Instruction document")}
          editable={false}
          editorLabel={t("Instruction content")}
          fileName="CONTENT.md"
          path={previewBlock.path}
          resetKey={`${previewBlock.id}:${previewBlock.contentHash}`}
          value={previewBlock.content}
          onClose={() => setPreviewBlock(undefined)}
          onSave={() => undefined}
        />
      ) : null}
      {deleteCandidate ? (
        <ModalFrame
          ariaLabel={t("Delete Instruction Block")}
          className="instruction-delete-dialog ui-dialog-shell"
          dialogRef={deleteDialogRef}
          dismissDisabled={deleting}
          onDismiss={closeDeleteDialog}
        >
          <DialogHeader
            title={t("Delete Instruction Block")}
            description={t("Delete {{name}} from the Instruction Library? A recovery copy remains in AgentEnv Trash.", {
              name: deleteCandidate.name
            })}
          />
          <DialogBody>
            {(deleteCandidate.usedByProfiles?.length ?? 0) > 0 ? (
              <div className="instruction-delete-impact">
                <strong>{t(
                  deleteCandidate.usedByProfiles!.length === 1
                    ? "This Instruction will be removed from 1 Profile"
                    : "This Instruction will be removed from {{count}} Profiles",
                  { count: deleteCandidate.usedByProfiles!.length }
                )}</strong>
                <span>{deleteCandidate.usedByProfiles!.join(", ")}</span>
                <p>{t("Agent files stay unchanged until those Profiles are applied again.")}</p>
              </div>
            ) : null}
            {deleteError ? <p className="ui-field-error" role="alert">{deleteError}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button ref={deleteCancelRef} disabled={deleting} onClick={closeDeleteDialog}>
              {t("Cancel")}
            </Button>
            <Button
              variant="danger"
              busy={deleting}
              onClick={() => {
                setDeleting(true);
                setDeleteError("");
                void onRemove(deleteCandidate)
                  .then(() => {
                    setDeleteCandidate(undefined);
                    setSelectedId(undefined);
                  })
                  .catch((unknownError) => {
                    setDeleteError(unknownError instanceof Error ? unknownError.message : String(unknownError));
                  })
                  .finally(() => setDeleting(false));
              }}
            >
              {t("Delete")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
      {contextMenu && contextBlock ? createPortal(
        <ActionMenu
          ariaLabel={t("Instruction actions")}
          className="instruction-row-context-menu"
          menuRef={contextMenuRef}
          style={{ left: contextMenu.left, top: contextMenu.top }}
        >
          <ActionMenuItem onClick={() => {
            setContextMenu(undefined);
            setPreviewBlock(contextBlock);
          }}>
            <Eye size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t("Preview")}</span>
          </ActionMenuItem>
          <ActionMenuItem onClick={() => {
            setContextMenu(undefined);
            setEditor({ block: contextBlock });
          }}>
            <Pencil size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t("Edit")}</span>
          </ActionMenuItem>
          <ActionMenuItem
            tone="danger"
            onClick={() => {
              setContextMenu(undefined);
              setDeleteCandidate(contextBlock);
            }}
          >
            <Trash2 size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t("Delete")}</span>
          </ActionMenuItem>
        </ActionMenu>,
        document.body
      ) : null}
    </div>
  );
};
