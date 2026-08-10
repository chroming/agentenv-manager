import { useEffect, useMemo, useState } from "react";
import type { ProjectResourceFile, ProjectResourceSummary } from "../../shared/types";
import { useI18n } from "../i18n";
import {
  InstructionDocumentPreviewList,
  type InstructionDocumentPreview
} from "./InstructionDocumentPreviewList";

interface WorkspaceInstructionPreviewListProps {
  projectId: string;
  resources: ProjectResourceSummary[];
  onOpen(resource: ProjectResourceSummary): void;
}

type LoadedPreview = {
  file?: ProjectResourceFile;
  error?: string;
  loading: boolean;
};

export const WorkspaceInstructionPreviewList = ({
  projectId,
  resources,
  onOpen
}: WorkspaceInstructionPreviewListProps) => {
  const { t, formatDate } = useI18n();
  const [loaded, setLoaded] = useState<Record<string, LoadedPreview>>({});
  const signature = resources
    .map((resource) => `${resource.id}:${resource.contentHash ?? "unknown"}:${resource.modifiedAt ?? "unknown"}`)
    .join("|");

  useEffect(() => {
    let active = true;
    setLoaded(Object.fromEntries(resources.map((resource) => [resource.id, { loading: true }])));
    void Promise.all(resources.map(async (resource) => {
      try {
        const file = await window.agentEnv.readProjectResource(projectId, resource.id);
        if (active) {
          setLoaded((current) => ({
            ...current,
            [resource.id]: { file, loading: false }
          }));
        }
      } catch (unknownError) {
        if (active) {
          setLoaded((current) => ({
            ...current,
            [resource.id]: {
              error: unknownError instanceof Error ? unknownError.message : String(unknownError),
              loading: false
            }
          }));
        }
      }
    }));
    return () => {
      active = false;
    };
  }, [projectId, signature]);

  const documents = useMemo<InstructionDocumentPreview[]>(() => resources.map((resource) => {
    const preview = loaded[resource.id];
    const file = preview?.file;
    const gitLabel = resource.gitState === "tracked-clean" ? t("Tracked")
      : resource.gitState === "tracked-modified" ? t("Modified")
        : resource.gitState === "untracked" ? t("Untracked")
          : resource.gitState === "ignored" ? t("Ignored")
            : resource.gitState === "unavailable" ? t("Git status unavailable")
              : undefined;
    return {
      id: resource.id,
      name: resource.name,
      path: file?.path ?? resource.absolutePath,
      content: file?.content,
      metadata: [file?.modifiedAt ? formatDate(file.modifiedAt) : undefined, gitLabel]
        .filter(Boolean)
        .join(" · "),
      editable: resource.editable,
      loading: preview?.loading ?? true,
      error: preview?.error
    };
  }), [formatDate, loaded, resources, t]);

  return (
    <InstructionDocumentPreviewList
      documents={documents}
      emptyLabel={t("No instruction files")}
      onOpen={(document) => {
        const resource = resources.find((candidate) => candidate.id === document.id);
        if (resource) onOpen(resource);
      }}
    />
  );
};
