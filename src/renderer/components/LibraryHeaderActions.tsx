import { ArrowLeft, Plus, ScanLine } from "lucide-react";
import type { FreshnessState } from "../freshness";
import { useI18n } from "../i18n";
import { Button, ControlGroup, RefreshAction } from "./ui";

interface LibraryHeaderActionsProps {
  mode: "skills" | "sources";
  freshness: FreshnessState;
  toolOpen?: boolean;
  returnTargetName?: string;
  onReturn?(): void;
  onImport(): void;
  onScanLocal(): void;
  onRefresh(): void;
}

export const LibraryHeaderActions = ({
  mode,
  freshness,
  toolOpen = false,
  returnTargetName,
  onReturn,
  onImport,
  onScanLocal,
  onRefresh
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
      {!returnTargetName ? (
        <Button
          disabled={toolOpen}
          icon={<ScanLine size={15} strokeWidth={2.2} aria-hidden="true" />}
          onClick={onScanLocal}
        >
          {t("Local Skills")}
        </Button>
      ) : null}
      <RefreshAction
        ariaLabel={t(mode === "sources" ? "Refresh sources" : "Refresh skills")}
        disabled={toolOpen}
        label={t("Refresh")}
        state={freshness}
        onRefresh={onRefresh}
      />
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
