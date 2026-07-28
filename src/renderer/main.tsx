import React from "react";
import { createRoot } from "react-dom/client";
import { AGENTENV_RUNTIME_VERSION, isAgentEnvRuntimeCompatible } from "../shared/runtimeVersion";
import { StartupGate } from "./StartupGate";
import { resolveAppLocale, translate } from "./i18n";
import "./ui/index.css";

const runtimeApi = window.agentEnv as Partial<typeof window.agentEnv> | undefined;
document.documentElement.dataset.platform = runtimeApi?.platform ?? "unknown";

window.addEventListener("error", (event) => {
  runtimeApi?.reportRendererError?.({
    kind: "error",
    name: event.error instanceof Error ? event.error.name : "Error",
    message: event.error instanceof Error ? event.error.message : event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined
  });
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  runtimeApi?.reportRendererError?.({
    kind: "unhandled-rejection",
    name: reason instanceof Error ? reason.name : "Error",
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

const startupLocale = resolveAppLocale("system");
const startupT = (message: string) => translate(startupLocale, message);
const runtimeMismatch = (
  <main className="runtime-mismatch" role="alert">
    <section className="runtime-mismatch__panel">
      <span className="runtime-mismatch__mark" aria-hidden="true">!</span>
      <div>
        <h1>{startupT("Restart required")}</h1>
        <p>{startupT("The interface and desktop runtime are from different builds. Close and reopen AgentEnv Manager.")}</p>
        <small>{translate(startupLocale, "Runtime {{version}} required", { version: AGENTENV_RUNTIME_VERSION })}</small>
      </div>
      <button className="ui-button ui-button--primary ui-button--default" type="button" onClick={() => window.close()}>
        {startupT("Close app")}
      </button>
    </section>
  </main>
);

createRoot(root).render(
  <React.StrictMode>
    {isAgentEnvRuntimeCompatible(runtimeApi?.runtimeVersion) ? <StartupGate /> : runtimeMismatch}
  </React.StrictMode>
);
