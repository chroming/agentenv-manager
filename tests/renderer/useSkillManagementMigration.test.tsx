// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSkillManagementMigration } from "../../src/renderer/hooks/useSkillManagementMigration";

describe("useSkillManagementMigration", () => {
  it("opens only for validated legacy ownership markers and counts each marker once", async () => {
    const { result } = renderHook(() => useSkillManagementMigration({
      inventory: [
        {
          id: "one",
          name: "One",
          description: "",
          path: "/skills/one",
          foundIn: ["codex"],
          status: "managed",
          skillKey: "one",
          contentHash: "same",
          installMethod: "linked",
          legacyOwnershipMarkerPaths: ["/skills/one.agentenv-owner.json"]
        },
        {
          id: "one-alias",
          name: "One",
          description: "",
          path: "/skills/one",
          foundIn: ["opencode"],
          status: "managed",
          skillKey: "one",
          contentHash: "same",
          installMethod: "linked",
          legacyOwnershipMarkerPaths: ["/skills/one.agentenv-owner.json"]
        }
      ],
      isLoading: false,
      telemetryOpen: false
    }));

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.legacyMarkerCount).toBe(1);
    act(() => result.current.onDismiss());
    expect(result.current.open).toBe(false);
  });

  it("does not infer migration from a linked install without a legacy marker", async () => {
    const { result } = renderHook(() => useSkillManagementMigration({
      inventory: [{
        id: "one",
        name: "One",
        description: "",
        path: "/skills/one",
        foundIn: ["codex"],
        status: "managed",
        skillKey: "one",
        contentHash: "same",
        installMethod: "linked"
      }],
      isLoading: false,
      telemetryOpen: false
    }));

    await waitFor(() => expect(result.current.open).toBe(false));
    expect(result.current.legacyMarkerCount).toBe(0);
  });

  it("does not interrupt the session when a marker appears after startup review", async () => {
    const { result, rerender } = renderHook(({ inventory }) => useSkillManagementMigration({
      inventory,
      isLoading: false,
      telemetryOpen: false
    }), { initialProps: { inventory: [] as Parameters<typeof useSkillManagementMigration>[0]["inventory"] } });
    await waitFor(() => expect(result.current.legacyMarkerCount).toBe(0));

    rerender({ inventory: [{
      id: "late",
      name: "Late",
      description: "",
      path: "/skills/late",
      foundIn: ["codex"],
      status: "managed",
      skillKey: "late",
      contentHash: "same",
      legacyOwnershipMarkerPaths: ["/skills/late.agentenv-owner.json"]
    }] });

    expect(result.current.open).toBe(false);
    expect(result.current.legacyMarkerCount).toBe(0);
  });
});
