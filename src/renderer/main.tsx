import React from "react";
import { createRoot } from "react-dom/client";
import { AGENTENV_RUNTIME_VERSION, isAgentEnvRuntimeCompatible } from "../shared/runtimeVersion";
import { App } from "./App";
import "./ui/index.css";

const runtimeApi = window.agentEnv as Partial<typeof window.agentEnv> | undefined;
document.documentElement.dataset.platform = runtimeApi?.platform ?? "unknown";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

const chinese = navigator.language.toLowerCase().startsWith("zh");
const runtimeMismatch = (
  <main className="runtime-mismatch" role="alert">
    <section className="runtime-mismatch__panel">
      <span className="runtime-mismatch__mark" aria-hidden="true">!</span>
      <div>
        <h1>{chinese ? "需要重新启动" : "Restart required"}</h1>
        <p>
          {chinese
            ? "界面与桌面运行时来自不同构建。请关闭并重新打开 AgentEnv Manager。"
            : "The interface and desktop runtime are from different builds. Close and reopen AgentEnv Manager."}
        </p>
        <small>
          {chinese
            ? `需要运行时版本 ${AGENTENV_RUNTIME_VERSION}`
            : `Runtime ${AGENTENV_RUNTIME_VERSION} required`}
        </small>
      </div>
      <button className="ui-button ui-button--primary ui-button--default" type="button" onClick={() => window.close()}>
        {chinese ? "关闭应用" : "Close app"}
      </button>
    </section>
  </main>
);

createRoot(root).render(
  <React.StrictMode>
    {isAgentEnvRuntimeCompatible(runtimeApi?.runtimeVersion) ? <App /> : runtimeMismatch}
  </React.StrictMode>
);
