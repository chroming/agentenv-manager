import { FileInput, FileText, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { InstructionBlock, InstructionFileSelection } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { InfoTip } from "./InfoTip";
import { InstructionBlockEditorDialog } from "./InstructionBlockEditorDialog";
import { InstructionDocumentPreviewList } from "./InstructionDocumentPreviewList";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  InspectorHeader,
  MasterDetailLayout,
  MasterDetailPane,
  MasterListPane,
  ModalFrame,
  PageHeader,
  SearchField,
  SelectableListRow,
  ToolbarOverflowMenu
} from "./ui";

interface InstructionsWorkspaceProps {
  blocks: InstructionBlock[];
  loading: boolean;
  onCreate(input: { name: string; description: string; content: string }): Promise<void>;
  onImport(): Promise<InstructionFileSelection | undefined>;
  onRefresh(): Promise<void> | void;
  onRemove(block: InstructionBlock): Promise<void>;
  onUpdate(block: InstructionBlock, input: { name: string; description: string; content: string }): Promise<void>;
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
  const { t, formatDate } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [editor, setEditor] = useState<{ block?: InstructionBlock; initial?: InstructionFileSelection }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<InstructionBlock>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteDialogRef = useRef<HTMLElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return blocks.filter((block) => !normalized || [block.name, block.description, block.content]
      .some((value) => value.toLocaleLowerCase().includes(normalized)));
  }, [blocks, query]);
  const selected = blocks.find((block) => block.id === selectedId) ?? visible[0];

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

  const save = async (input: { name: string; description: string; content: string }) => {
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
      <PageHeader
        className="page-header instructions-page-header"
        title={t("Instructions")}
        help={<InfoTip label={t("Create reusable Instruction Blocks and combine them in Profiles.")} />}
        actions={(
          <>
            <Button icon={<FileInput size={14} />} onClick={() => void onImport().then((initial) => {
              if (initial) setEditor({ initial });
            })}>{t("Import")}</Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditor({})}>{t("New Instruction")}</Button>
            <Button icon={<RefreshCw size={14} />} busy={loading} onClick={() => void onRefresh()}>{t("Refresh")}</Button>
          </>
        )}
      />
      <MasterDetailLayout className="instructions-catalog" listWidth="compact">
        <MasterListPane className="instructions-list-pane">
          <SearchField
            fieldClassName="instructions-search"
            label={t("Search Instructions")}
            placeholder={t("Search Instructions...")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <div className="instructions-list" role="list">
            {visible.map((block) => (
              <SelectableListRow
                key={block.id}
                selected={selected?.id === block.id}
                icon={<FileText size={16} strokeWidth={2} />}
                title={block.name}
                description={block.description || t("No description")}
                status={t("{{count}} Profiles", { count: block.usedByProfiles?.length ?? 0 })}
                tooltip={block.name}
                onSelect={() => setSelectedId(block.id)}
              />
            ))}
          </div>
        </MasterListPane>
        <MasterDetailPane className="instructions-detail-pane">
          {selected ? (
            <>
              <InspectorHeader
                icon={<FileText size={18} />}
                title={selected.name}
                description={(
                  <OverflowTooltip
                    className="instructions-detail-description"
                    text={selected.description || t("Reusable Profile instructions")}
                  />
                )}
                actions={(
                  <>
                    <Button icon={<Pencil size={14} />} onClick={() => setEditor({ block: selected })}>{t("Edit")}</Button>
                    <ToolbarOverflowMenu
                      items={[{
                        id: "delete",
                        icon: <Trash2 size={14} />,
                        label: t("Delete"),
                        disabled: (selected.usedByProfiles?.length ?? 0) > 0,
                        title: (selected.usedByProfiles?.length ?? 0) > 0
                          ? t("Remove this Block from its Profiles before deleting it")
                          : undefined,
                        onSelect: () => setDeleteCandidate(selected)
                      }]}
                      label={t("More actions for {{name}}", { name: selected.name })}
                      menuLabel={t("Actions for {{name}}", { name: selected.name })}
                    />
                  </>
                )}
              />
              <div className="instructions-detail-meta">
                <span>{t("Used by {{count}} Profiles", { count: selected.usedByProfiles?.length ?? 0 })}</span>
                <span>{t("Updated {{date}}", { date: formatDate(selected.updatedAt) })}</span>
              </div>
              <InstructionDocumentPreviewList
                documents={[{
                  id: selected.id,
                  name: "Instruction Block",
                  path: selected.path,
                  content: selected.content,
                  metadata: selected.name
                }]}
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
          {deleteError ? <DialogBody><p className="ui-field-error" role="alert">{deleteError}</p></DialogBody> : null}
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
    </div>
  );
};
