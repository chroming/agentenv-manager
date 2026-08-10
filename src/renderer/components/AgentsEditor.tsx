import { useState } from "react";
import { useI18n } from "../i18n";
import { InstructionDocumentPreviewList } from "./InstructionDocumentPreviewList";
import { InstructionDocumentDialog } from "./InstructionDocumentDialog";
import type { ProfileResourcePolicy } from "./ProfileResourcePolicyControl";

interface AgentsEditorProps {
  label: string;
  path?: string;
  policy: ProfileResourcePolicy;
  targetName: string;
  value: string;
  currentValue?: string;
  currentValueAvailable?: boolean;
  onSave(value: string): Promise<void> | void;
}

export const AgentsEditor = ({
  path,
  policy,
  targetName,
  value,
  currentValue,
  currentValueAvailable = false,
  onSave
}: AgentsEditorProps) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const fileName = "AGENTS.md";
  const documents = policy === "disable"
    ? []
    : policy === "ignore"
      ? currentValueAvailable
        ? [{
            id: "current-agent-instructions",
            name: fileName,
            path,
            content: currentValue ?? "",
            metadata: t("Current {{name}} file", { name: targetName })
          }]
        : []
      : [{
          id: "profile-instructions",
          name: fileName,
          content: value,
          metadata: t("Saved in this Profile"),
          editable: true
        }];
  const emptyLabel = policy === "disable"
    ? t("Instructions are turned off for this Agent")
    : t("Current Agent instructions unavailable");

  return (
    <>
      <InstructionDocumentPreviewList
        documents={documents}
        emptyLabel={emptyLabel}
        onOpen={documents.length > 0 ? () => setOpen(true) : undefined}
      />
      <InstructionDocumentDialog
        open={open}
        ariaLabel={t("Instruction document")}
        editable={policy === "manage"}
        editorLabel={t("Profile instruction content")}
        fileName={fileName}
        path={policy === "manage" ? t("Profile · AGENTS.md") : path}
        resetKey={value}
        value={policy === "manage" ? value : currentValue ?? ""}
        onClose={() => setOpen(false)}
        onSave={onSave}
      />
    </>
  );
};
