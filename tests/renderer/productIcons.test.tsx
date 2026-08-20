// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileSummary, SkillLibraryEntry, TargetInfo } from "../../src/shared/types";
import { buildQuickOpenItems } from "../../src/renderer/quickOpenItems";
import {
  defaultProfileIconKey,
  ProductIcon,
  type ProductIconName
} from "../../src/renderer/productIcons";

afterEach(cleanup);

describe("product icon semantics", () => {
  it("uses one stable semantic icon for each top-level product object", () => {
    const names: ProductIconName[] = [
      "agents",
      "profiles",
      "conversations",
      "skills",
      "instructions",
      "mcps",
      "settings"
    ];
    const { container } = render(
      <>{names.map((name) => <ProductIcon name={name} key={name} />)}</>
    );

    expect(
      [...container.querySelectorAll("[data-product-icon]")].map((icon) =>
        icon.getAttribute("data-product-icon")
      )
    ).toEqual(names);
    expect(defaultProfileIconKey).toBe("layers");
  });

  it("keeps navigation and matching Quick Open entries on the same icon vocabulary", () => {
    const noop = vi.fn();
    const items = buildQuickOpenItems({
      profiles: [{ id: "daily", name: "Daily", description: "" } as ProfileSummary],
      skills: [{
        id: "review",
        name: "Review",
        description: "",
        tags: ["Code Review"]
      } as SkillLibraryEntry],
      targets: [{
        id: "codex",
        name: "Codex",
        health: { summary: "Ready" }
      } as unknown as TargetInfo],
      t: (message) => message,
      onOpenWorkspace: noop,
      onOpenProfile: noop,
      onOpenSkill: noop,
      onOpenTarget: noop,
      onOpenLocalSkills: noop,
      onRefreshSkills: noop,
      onRefreshTargets: noop
    });
    expect(items.find((candidate) => candidate.id === "action:local-skills"))
      .toMatchObject({ label: "Local Skills" });
    expect(items.find((candidate) => candidate.id === "skill:review")?.keywords)
      .toContain("Code Review");
    const expected = new Map([
      ["workspace:targets", "agents"],
      ["workspace:profiles", "profiles"],
      ["workspace:conversations", "conversations"],
      ["workspace:skills", "skills"],
      ["workspace:settings", "settings"],
      ["profile:daily", "profiles"],
      ["skill:review", "skills"],
      ["target:codex", "agents"]
    ]);

    for (const [id, iconName] of expected) {
      const item = items.find((candidate) => candidate.id === id);
      const { container } = render(<>{item?.icon}</>);
      expect(container.querySelector("[data-product-icon]")).toHaveAttribute(
        "data-product-icon",
        iconName
      );
      cleanup();
    }
  });
});
