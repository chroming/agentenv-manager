// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileTypeIcon,
  fileIconKindForPath,
  folderIconKindForPath
} from "../../src/renderer/components/FileTypeIcon";

afterEach(cleanup);

describe("FileTypeIcon", () => {
  it("maps common Skill files to recognizable icon families", () => {
    expect(fileIconKindForPath("SKILL.md")).toBe("markdown");
    expect(fileIconKindForPath("scripts/review.py")).toBe("python");
    expect(fileIconKindForPath("src/panel.tsx")).toBe("react-typescript");
    expect(fileIconKindForPath("config/settings.yaml")).toBe("yaml");
    expect(fileIconKindForPath("Dockerfile")).toBe("docker");
    expect(fileIconKindForPath(".env.example")).toBe("dotenv");
    expect(fileIconKindForPath("package-lock.json")).toBe("node");
    expect(fileIconKindForPath("assets/preview.png")).toBe("image");
    expect(fileIconKindForPath("notes.unknown")).toBe("file");
  });

  it("distinguishes common Skill directory roles", () => {
    expect(folderIconKindForPath("references")).toBe("docs");
    expect(folderIconKindForPath("src")).toBe("source");
    expect(folderIconKindForPath("assets")).toBe("images");
    expect(folderIconKindForPath("scripts")).toBe("script");
    expect(folderIconKindForPath("tests")).toBe("test");
    expect(folderIconKindForPath(".github")).toBe("github");
    expect(folderIconKindForPath("misc")).toBe("folder");
  });

  it("uses the opened folder variant without adding accessible noise", () => {
    const { container, rerender } = render(
      <FileTypeIcon kind="directory" path="references" />
    );
    const closed = container.querySelector("img");
    expect(closed).toHaveAttribute("data-file-icon", "docs");
    expect(closed).toHaveAttribute("aria-hidden", "true");
    const closedSource = closed?.getAttribute("src");

    rerender(<FileTypeIcon expanded kind="directory" path="references" />);
    expect(container.querySelector("img")?.getAttribute("src")).not.toBe(closedSource);
  });
});
