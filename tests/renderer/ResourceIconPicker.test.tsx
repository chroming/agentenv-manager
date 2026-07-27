// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  faviconUrlFor,
  ResourceIconArtwork,
  ResourceIconPicker
} from "../../src/renderer/components/ResourceIconPicker";

afterEach(() => cleanup());

describe("ResourceIconPicker", () => {
  it("derives direct source favicons for web and SSH repository locators", () => {
    expect(faviconUrlFor("https://github.com/acme/skills/tree/main/review"))
      .toBe("https://github.com/favicon.ico");
    expect(faviconUrlFor("git@gitlab.example.com:team/skills.git"))
      .toBe("https://gitlab.example.com/favicon.ico");
    expect(faviconUrlFor("/tmp/local-skill")).toBeUndefined();
  });

  it("falls back to the supplied built-in icon when a favicon cannot load", () => {
    const { container } = render(
      <ResourceIconArtwork sourceUrl="https://example.com/team/skill" fallbackIconKey="github" />
    );
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "https://example.com/favicon.ico");
    fireEvent.error(image!);
    expect(container.querySelector("svg")).toHaveClass("lucide-git-branch");
  });

  it("offers a broad built-in set and can restore automatic source artwork", () => {
    const onChange = vi.fn();
    render(
      <ResourceIconPicker
        iconKey="shield"
        label="Reviewer"
        sourceUrl="https://github.com/acme/reviewer"
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Change icon for Reviewer" }));
    const menu = screen.getByRole("menu", { name: "Icons for Reviewer" });
    expect(within(menu).getAllByRole("menuitemradio").length).toBeGreaterThan(30);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Use source icon" }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("offers every supported Agent artwork only when requested by a Profile", () => {
    render(
      <ResourceIconPicker
        iconKey="opencode"
        label="Daily Coding"
        onChange={() => undefined}
        showAgentIcons
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Change icon for Daily Coding" }));
    const menu = screen.getByRole("menu", { name: "Icons for Daily Coding" });
    for (const name of ["OpenCode", "Codex CLI", "Claude Code", "Antigravity CLI", "Trae CLI"]) {
      expect(within(menu).getByRole("menuitemradio", { name })).toBeInTheDocument();
    }
  });
});
