import { useEffect, useState } from "react";
import { AlertTriangle, FileDown, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import type { StartupStatus } from "../shared/types";
import { App } from "./App";
import { Button } from "./components/ui";
import { resolveAppLocale, translate } from "./i18n";

export const StartupGate = () => {
  const [status, setStatus] = useState<StartupStatus>({ state: "initializing" });
  const [retrying, setRetrying] = useState(false);
  const [pendingAction, setPendingAction] = useState<"folder" | "export">();
  const [actionError, setActionError] = useState("");
  const locale = resolveAppLocale("system");
  const t = (message: string) => translate(locale, message);

  useEffect(() => {
    let active = true;
    let receivedStatusEvent = false;
    const dispose = window.agentEnv.onStartupStatusChanged((next) => {
      receivedStatusEvent = true;
      if (active) setStatus(next);
      if (next.state !== "initializing") setRetrying(false);
    });
    void window.agentEnv.readStartupStatus()
      .then((next) => {
        if (active && !receivedStatusEvent) setStatus(next);
      })
      .catch((error: unknown) => {
        if (!active || receivedStatusEvent) return;
        setStatus({
          state: "failed",
          kind: "unknown",
          title: "AgentEnv Manager could not start",
          message: error instanceof Error ? error.message : String(error),
          canRetry: true
        });
      });
    return () => {
      active = false;
      dispose();
    };
  }, []);

  const retryStartup = async () => {
    setRetrying(true);
    setActionError("");
    setStatus({ state: "initializing" });
    try {
      await window.agentEnv.retryStartup();
      setStatus(await window.agentEnv.readStartupStatus());
    } catch (error) {
      setStatus({
        state: "failed",
        kind: "unknown",
        title: "AgentEnv Manager could not start",
        message: error instanceof Error ? error.message : String(error),
        canRetry: true
      });
    } finally {
      setRetrying(false);
    }
  };

  const runSupportAction = async (
    action: "folder" | "export",
    operation: () => Promise<unknown>
  ) => {
    setPendingAction(action);
    setActionError("");
    try {
      await operation();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(undefined);
    }
  };

  if (status.state === "ready") return <App />;
  if (status.state === "initializing") {
    return (
      <main className="startup-screen" aria-busy="true">
        <LoaderCircle className="is-spinning" size={24} aria-hidden="true" />
        <strong>{t("Preparing your local environment")}</strong>
        <span>{t("Checking data and recovering interrupted operations…")}</span>
      </main>
    );
  }

  return (
    <main className="startup-screen startup-screen--failed" role="alert">
      <section className="startup-failure-panel">
        <span className="startup-failure-icon"><AlertTriangle size={22} aria-hidden="true" /></span>
        <div className="startup-failure-copy">
          <h1>{t(status.title)}</h1>
          <p>{status.message}</p>
          {status.dataRoot ? <code>{status.dataRoot}</code> : null}
          {actionError ? <p className="startup-action-error">{actionError}</p> : null}
        </div>
        <div className="startup-failure-actions">
          <Button
            variant="primary"
            disabled={retrying || !status.canRetry}
            icon={<RefreshCw className={retrying ? "is-spinning" : undefined} size={15} />}
            onClick={() => void retryStartup()}
          >
            {t("Retry")}
          </Button>
          <Button
            disabled={Boolean(pendingAction)}
            icon={pendingAction === "folder" ? <LoaderCircle className="is-spinning" size={15} /> : <FolderOpen size={15} />}
            onClick={() => void runSupportAction("folder", () => window.agentEnv.openStartupDataFolder())}
          >
            {t("Open data folder")}
          </Button>
          <Button
            disabled={Boolean(pendingAction)}
            icon={pendingAction === "export" ? <LoaderCircle className="is-spinning" size={15} /> : <FileDown size={15} />}
            onClick={() => void runSupportAction("export", () => window.agentEnv.exportStartupDiagnostics())}
          >
            {t("Export diagnostics")}
          </Button>
          <button className="text-action" type="button" onClick={() => window.agentEnv.quitApp()}>
            {t("Quit")}
          </button>
        </div>
      </section>
    </main>
  );
};
