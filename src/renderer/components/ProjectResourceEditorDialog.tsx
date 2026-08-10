import { useEffect, useMemo, useState } from "react";
import type {
  ProjectInstructionDraft,
  ProjectMutationResult,
  ProjectResourceFile
} from "../../shared/types";
import { useI18n } from "../i18n";
import {
  InstructionDocumentDialog,
  type InstructionDocumentGuard
} from "./InstructionDocumentDialog";

export type ProjectEditorGuard = InstructionDocumentGuard;

interface ProjectResourceEditorDialogProps {
  open: boolean;
  projectId: string;
  resourceId?: string;
  agentId?: string;
  onClose(): void;
  onSaved(result: ProjectMutationResult): Promise<void> | void;
  onGuardChange?(guard?: ProjectEditorGuard): void;
  suspended?: boolean;
}

export const ProjectResourceEditorDialog = ({
  open,
  projectId,
  resourceId,
  agentId,
  onClose,
  onSaved,
  onGuardChange,
  suspended = false
}: ProjectResourceEditorDialogProps) => {
  const { t, formatDate } = useI18n();
  const [file, setFile] = useState<ProjectResourceFile | ProjectInstructionDraft>();
  const [busy, setBusy] = useState<"load" | "save" | undefined>(open ? "load" : undefined);
  const [error, setError] = useState("");
  const stale = error.includes("changed outside AgentEnv");

  const load = async () => {
    if (!resourceId && !agentId) return;
    setBusy("load");
    setError("");
    setFile(undefined);
    try {
      const next = resourceId
        ? await window.agentEnv.readProjectResource(projectId, resourceId)
        : await window.agentEnv.prepareProjectInstruction(projectId, agentId!);
      setFile(next);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(undefined);
    }
  };

  useEffect(() => {
    if (!open || (!resourceId && !agentId)) return;
    void load();
  }, [open, projectId, resourceId, agentId]);

  const save = async (content: string) => {
    if (!file || content === file.content) return;
    setBusy("save");
    setError("");
    try {
      const result = "resourceId" in file
        ? await window.agentEnv.saveProjectResource({
            projectId,
            resourceId: file.resourceId,
            expectedHash: file.contentHash,
            content
          })
        : await window.agentEnv.createProjectInstruction({
            projectId,
            agentId: file.agentId,
            content
          });
      if ("resourceId" in file) {
        setFile({ ...file, content, contentHash: result.contentHash });
      }
      await onSaved(result);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      throw unknownError;
    } finally {
      setBusy(undefined);
    }
  };

  const metadata = useMemo(() => file
    ? file.modifiedAt
      ? `${file.path} · ${formatDate(file.modifiedAt)}${"gitState" in file && file.gitState ? ` · ${
          file.gitState === "tracked-clean" ? t("Tracked")
            : file.gitState === "tracked-modified" ? t("Modified")
              : file.gitState === "untracked" ? t("Untracked")
                : file.gitState === "ignored" ? t("Ignored")
                  : t("Git status unavailable")
        }` : ""}`
      : file.path
    : t("Reading Workspace file…"), [file, formatDate, t]);

  return (
    <InstructionDocumentDialog
      open={open}
      ariaLabel={t("Workspace instruction")}
      editable={file?.editable ?? true}
      editorLabel={t("Workspace instruction content")}
      error={error}
      fileName={file?.name ?? t("Workspace instruction")}
      initialMode={resourceId ? "preview" : "edit"}
      loading={busy === "load"}
      path={metadata}
      resetKey={`${resourceId ?? agentId ?? "instruction"}:${file?.contentHash ?? "loading"}`}
      saving={busy === "save"}
      stale={stale}
      suspended={suspended}
      value={file?.content ?? ""}
      onClose={onClose}
      onGuardChange={onGuardChange}
      onReload={load}
      onSave={save}
    />
  );
};
