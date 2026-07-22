import { useEffect, useState } from "react";
import { AlertTriangle, FileDown, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import type { StartupStatus } from "../shared/types";
import { App } from "./App";

export const StartupGate = () => {
  const [status, setStatus] = useState<StartupStatus>({ state: "initializing" });
  const [retrying, setRetrying] = useState(false);
  const chinese = navigator.language.toLowerCase().startsWith("zh");

  useEffect(() => {
    let active = true;
    const dispose = window.agentEnv.onStartupStatusChanged((next) => {
      if (active) setStatus(next);
      if (next.state !== "initializing") setRetrying(false);
    });
    void window.agentEnv.readStartupStatus().then((next) => active && setStatus(next));
    return () => {
      active = false;
      dispose();
    };
  }, []);

  if (status.state === "ready") return <App />;
  if (status.state === "initializing") {
    return (
      <main className="startup-screen" aria-busy="true">
        <LoaderCircle className="is-spinning" size={24} aria-hidden="true" />
        <strong>{chinese ? "正在准备本地环境" : "Preparing your local environment"}</strong>
        <span>{chinese ? "正在验证数据并恢复未完成的操作…" : "Checking data and recovering interrupted operations…"}</span>
      </main>
    );
  }

  return (
    <main className="startup-screen startup-screen--failed" role="alert">
      <section className="startup-failure-panel">
        <span className="startup-failure-icon"><AlertTriangle size={22} aria-hidden="true" /></span>
        <div className="startup-failure-copy">
          <h1>{status.title}</h1>
          <p>{status.message}</p>
          {status.dataRoot ? <code>{status.dataRoot}</code> : null}
        </div>
        <div className="startup-failure-actions">
          <button
            className="ui-button ui-button--primary ui-button--default"
            type="button"
            disabled={retrying || !status.canRetry}
            onClick={() => {
              setRetrying(true);
              setStatus({ state: "initializing" });
              void window.agentEnv.retryStartup();
            }}
          >
            <RefreshCw className={retrying ? "is-spinning" : undefined} size={15} aria-hidden="true" />
            {chinese ? "重试" : "Retry"}
          </button>
          <button className="ui-button ui-button--secondary ui-button--default" type="button" onClick={() => void window.agentEnv.openStartupDataFolder()}>
            <FolderOpen size={15} aria-hidden="true" />
            {chinese ? "打开数据目录" : "Open data folder"}
          </button>
          <button className="ui-button ui-button--secondary ui-button--default" type="button" onClick={() => void window.agentEnv.exportStartupDiagnostics()}>
            <FileDown size={15} aria-hidden="true" />
            {chinese ? "导出诊断" : "Export diagnostics"}
          </button>
          <button className="text-action" type="button" onClick={() => window.agentEnv.quitApp()}>
            {chinese ? "退出" : "Quit"}
          </button>
        </div>
      </section>
    </main>
  );
};
