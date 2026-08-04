// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubConnectionSettings } from "../../src/renderer/components/GitHubConnectionSettings";

afterEach(cleanup);

describe("GitHub connection settings", () => {
  it("keeps browser authorization recovery actions at the same secondary emphasis", () => {
    render(
      <GitHubConnectionSettings
        authStatus={{ state: "signed-out" }}
        busy={false}
        codeCopied={false}
        deviceLogin={{
          id: "device-login",
          userCode: "ABCD-EFGH",
          verificationUri: "https://github.com/login/device",
          expiresAt: "2026-08-04T12:00:00.000Z",
          intervalSeconds: 5
        }}
        loginChecking
        loginMessage="Waiting for authorization."
        onCheckLogin={vi.fn()}
        onCopyCode={vi.fn()}
        onOpenDevicePage={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Open GitHub" })).toHaveClass(
      "ui-button--secondary"
    );
    expect(screen.getByRole("button", { name: "Check now" })).toHaveClass(
      "ui-button--secondary"
    );
  });
});
