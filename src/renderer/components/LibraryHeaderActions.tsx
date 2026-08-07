import { ArrowLeft, Plus, RefreshCw, ScanLine } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { Button, ControlGroup } from "./ui";

interface LibraryHeaderActionsProps {
  mode: "skills" | "sources";
  refreshing: boolean;
  freshness?: ReactNode;
  toolOpen?: boolean;
  returnTargetName?: string;
  onReturn?(): void;
  onImport(): void;
  onScanLocal(): void;
  onRefresh(): void;
}

export const LibraryHeaderActions = ({
  mode,
  refreshing,
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
      {freshness}
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
      <Button
        aria-label={t(mode === "sources" ? "Refresh sources" : "Refresh skills")}
        disabled={refreshing || toolOpen}
        icon={(
          <RefreshCw
            className={refreshing ? "is-spinning" : ""}
            size={15}
            strokeWidth={2.2}
          />
        )}
        onClick={onRefresh}
      >
        {t("Refresh")}
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
