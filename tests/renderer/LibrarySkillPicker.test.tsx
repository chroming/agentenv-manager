// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibrarySkillPicker } from "../../src/renderer/components/LibrarySkillPicker";
import type { SkillLibraryEntry } from "../../src/shared/types";

afterEach(cleanup);

const skills: SkillLibraryEntry[] = [
  {
    id: "react-review",
    name: "React Review",
    description: "Review React interfaces",
    path: "/tmp/react-review",
    sourceType: "local",
    updatePolicy: "untracked",
    contentHash: "react-hash",
    updatedAt: "2026-08-20T00:00:00.000Z",
    tags: ["Frontend", "Code Review"]
  },
  {
    id: "release-notes",
    name: "Release Notes",
    description: "Write release notes",
    path: "/tmp/release-notes",
    sourceType: "local",
    updatePolicy: "untracked",
    contentHash: "release-hash",
    updatedAt: "2026-08-20T00:00:00.000Z",
    tags: ["Writing"]
  }
];

describe("LibrarySkillPicker", () => {
  it("searches tag text and filters by one exact tag", () => {
    render(
      <LibrarySkillPicker
        onChange={vi.fn()}
        selectedIds={[]}
        selectionMode="multiple"
        skills={skills}
      />
    );

    const search = screen.getByRole("searchbox", { name: "Search library skills" });
    fireEvent.change(search, { target: { value: "frontend" } });
    expect(screen.getByText("React Review")).toBeInTheDocument();
    expect(screen.queryByText("Release Notes")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Skill tag filter" }), {
      target: { value: "Writing" }
    });
    expect(screen.queryByText("React Review")).not.toBeInTheDocument();
    expect(screen.getByText("Release Notes")).toBeInTheDocument();
  });
});
