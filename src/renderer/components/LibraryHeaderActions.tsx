import { ArrowLeft, Plus } from "lucide-react";
import { useI18n } from "../i18n";
import { Button, ControlGroup } from "./ui";

interface LibraryHeaderActionsProps {
  toolOpen?: boolean;
  returnTargetName?: string;
  onReturn?(): void;
  onImport(): void;
}

export const LibraryHeaderActions = ({
  toolOpen = false,
  returnTargetName,
  onReturn,
  onImport
}: LibraryHeaderActionsProps) => {
  const { t } = useI18n();
  return (
    <ControlGroup
      className="page-actions"
      aria-label={t("Library actions")}
    >
      {returnTargetName && onReturn ? (
        <AgentImportReturnButton
          targetName={returnTargetName}
          onClick={onReturn}
        />
      ) : null}
      <Button
        variant="secondary"
        aria-label={t("Import skills")}
        disabled={toolOpen}
        icon={<Plus size={16} strokeWidth={2.4} />}
        onClick={onImport}
      >
        {t("Import")}
      </Button>
    </ControlGroup>
  );
};

const AgentImportReturnButton = ({
  targetName,
  onClick
}: {
  targetName: string;
  onClick(): void;
}) => {
  const { t } = useI18n();
  return (
    <Button
      icon={<ArrowLeft size={15} strokeWidth={2.2} />}
      onClick={onClick}
    >
      {t("Back to {{name}}", { name: targetName })}
    </Button>
  );
};
