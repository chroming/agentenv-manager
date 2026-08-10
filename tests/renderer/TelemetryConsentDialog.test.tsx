// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelemetryConsentDialog } from "../../src/renderer/components/TelemetryConsentDialog";
import { I18nProvider } from "../../src/renderer/i18n";

afterEach(cleanup);

const preview = {
  enabledInBuild: true,
  destination: "PostHog Cloud" as const,
  willCreateInstallationId: true,
  payload: {
    schemaVersion: 2 as const,
    event: "agentenv_daily_startup" as const,
    date: "2026-08-11",
    appVersion: "0.1.7",
    platform: "darwin" as const,
    osMajor: "26",
    arch: "arm64",
    locale: "en" as const,
    installChannel: "homebrew" as const
  }
};

const renderDialog = (props: Partial<React.ComponentProps<typeof TelemetryConsentDialog>> = {}) => {
  const onDismiss = vi.fn();
  const onDecide = vi.fn().mockResolvedValue(undefined);
  render(
    <I18nProvider preference="en">
      <TelemetryConsentDialog
        busy={false}
        open
        preview={preview}
        onDismiss={onDismiss}
        onDecide={onDecide}
        {...props}
      />
    </I18nProvider>
  );
  return { onDismiss, onDecide };
};

describe("TelemetryConsentDialog", () => {
  it("explains the exact data boundary before recording the default opt-in", async () => {
    const { onDecide } = renderDialog();

    expect(screen.getByText(/version, operating-system family/i)).toBeInTheDocument();
    expect(screen.getByText(/never shares actions, results, paths/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(true));
  });

  it("can opt out before continuing", async () => {
    const { onDecide } = renderDialog();

    fireEvent.click(screen.getByRole("switch", { name: "Share anonymous usage statistics" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(false));
  });

  it("dismisses only the current session with Escape", () => {
    const { onDismiss, onDecide } = renderDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDecide).not.toHaveBeenCalled();
  });
});
