import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, FileDown, RefreshCw } from "lucide-react";
import { Button } from "./components/ui";
import { resolveAppLocale, translate } from "./i18n";

interface RendererErrorBoundaryProps {
  children: ReactNode;
  onReload?: () => void;
}

interface RendererErrorBoundaryState {
  error?: Error;
  exportError?: string;
  exportPath?: string;
  exporting: boolean;
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { exporting: false };

  static getDerivedStateFromError(error: Error): Partial<RendererErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      window.agentEnv.reportRendererError({
        kind: "react-render-error",
        name: error.name,
        message: error.message,
        stack: [error.stack, info.componentStack].filter(Boolean).join("\n")
      });
    } catch (reportError) {
      console.error("[AgentEnv] Renderer failure could not be recorded", reportError);
    }
  }

  private readonly exportDiagnostics = async () => {
    this.setState({ exporting: true, exportError: undefined, exportPath: undefined });
    try {
      const exportPath = await window.agentEnv.exportDiagnostics();
      this.setState({ exportPath });
    } catch (error) {
      this.setState({ exportError: error instanceof Error ? error.message : String(error) });
    } finally {
      this.setState({ exporting: false });
    }
  };

  private readonly reload = () => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const locale = resolveAppLocale("system");
    const t = (message: string, values?: Record<string, string | number>) =>
      translate(locale, message, values);

    return (
      <main className="startup-screen startup-screen--failed" role="alert">
        <section className="startup-failure-panel renderer-failure-panel">
          <span className="startup-failure-icon"><AlertTriangle size={22} aria-hidden="true" /></span>
          <div className="startup-failure-copy">
            <h1>{t("The interface stopped unexpectedly")}</h1>
            <p>{t("Your AgentEnv data was not changed. Reload the interface or export diagnostics for support.")}</p>
            <code>{this.state.error.message}</code>
            {this.state.exportPath ? (
              <p>{t("Diagnostic report exported to {{path}}", { path: this.state.exportPath })}</p>
            ) : null}
            {this.state.exportError ? <p className="startup-action-error">{this.state.exportError}</p> : null}
          </div>
          <div className="startup-failure-actions">
            <Button
              variant="primary"
              icon={<RefreshCw size={15} />}
              onClick={this.reload}
            >
              {t("Reload interface")}
            </Button>
            <Button
              busy={this.state.exporting}
              icon={<FileDown size={15} />}
              onClick={() => void this.exportDiagnostics()}
            >
              {t("Export diagnostics")}
            </Button>
            <Button variant="ghost" onClick={() => window.agentEnv.quitApp()}>
              {t("Quit")}
            </Button>
          </div>
        </section>
      </main>
    );
  }
}
