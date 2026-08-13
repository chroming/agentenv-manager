// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEnvSettings } from "../../src/shared/types";
import { SkillSettingsSection } from "../../src/renderer/components/SkillSettingsSection";

const settings: AgentEnvSettings = {
  locale: "system",
  conversationTerminal: "default",
  skillSyncMethod: "copy",
  skillStorageLocation: "appData",
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 1440,
  backupRetentionDays: 30
};

afterEach(cleanup);

describe("SkillSettingsSection", () => {
  it("keeps Auto-check in the shared trailing control lane", () => {
    render(
      <SkillSettingsSection
        busy={false}
        settings={settings}
        onChange={vi.fn()}
      />
    );

    const control = screen.getByRole("switch", { name: "Skill auto update check" });
    const row = control.closest(".settings-preference-row");
    const lane = control.closest(".settings-preference-control");

    expect(row).not.toBeNull();
    expect(lane?.parentElement).toBe(row);
    expect(control.parentElement).toBe(lane);
    expect(row?.querySelector(".settings-preference-copy .ui-switch")).toBeNull();
  });

  it("uses one shared trailing control lane for every preference row", () => {
    const { container } = render(
      <SkillSettingsSection
        busy={false}
        settings={settings}
        onChange={vi.fn()}
      />
    );

    const rows = [...container.querySelectorAll<HTMLElement>(".settings-preference-row")];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.lastElementChild?.matches(
      ".settings-preference-control"
    ))).toEqual([true, true, true]);
    expect(rows.map((row) => row.lastElementChild?.firstElementChild?.matches(
      "select, .ui-switch, .settings-interval-field"
    ))).toEqual([true, true, true]);
  });

  it("uses a bounded interval menu and commits the selected schedule", () => {
    const onChange = vi.fn();
    render(<SkillSettingsSection busy={false} settings={settings} onChange={onChange} />);

    const interval = screen.getByRole("combobox", { name: "Skill auto check interval" });
    expect(interval).toHaveValue("1440");
    expect(screen.getByRole("option", { name: "Daily" })).toBeInTheDocument();
    fireEvent.change(interval, { target: { value: "360" } });
    expect(onChange).toHaveBeenCalledWith({ skillAutoCheckIntervalMinutes: 360 });
  });

  it("preserves an existing custom interval until the user chooses a standard schedule", () => {
    render(<SkillSettingsSection
      busy={false}
      settings={{ ...settings, skillAutoCheckIntervalMinutes: 15 }}
      onChange={vi.fn()}
    />);

    expect(screen.getByRole("combobox", { name: "Skill auto check interval" }))
      .toHaveValue("15");
    expect(screen.getByRole("option", { name: "Every 15 minutes" })).toBeInTheDocument();
  });
});
