import { describe, expect, it } from "vitest";
import {
  highlightCode,
  languageForPath
} from "../../src/renderer/syntaxHighlighter";

describe("syntaxHighlighter", () => {
  it.each([
    ["SKILL.md", "markdown"],
    ["references/guide.mdx", "mdx"],
    ["config/settings.jsonc", "jsonc"],
    ["config/settings.json5", "json5"],
    ["config/settings.yaml", "yaml"],
    ["config/tool.toml", "toml"],
    ["scripts/check.py", "python"],
    ["scripts/install.zsh", "bash"],
    ["src/index.ts", "typescript"],
    ["src/view.tsx", "tsx"],
    ["src/view.jsx", "jsx"],
    ["assets/theme.scss", "scss"],
    ["assets/icon.svg", "xml"],
    ["Dockerfile", "dockerfile"],
    [".env.local", "dotenv"],
    ["config/app.ini", "ini"],
    ["queries/schema.sql", "sql"],
    ["Makefile", "make"],
    ["changes.patch", "diff"],
    ["notes.unknown", "text"]
  ])("recognizes %s as %s", (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });

  it("loads common Skill source grammars on demand", async () => {
    const lines = await highlightCode("const ready: boolean = true;\n", "scripts/check.ts");
    expect(lines.flat().some((token) => token.color)).toBe(true);
  });
});
