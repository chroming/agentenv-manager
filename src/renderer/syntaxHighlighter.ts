import type { HighlighterCore } from "shiki/core";
import type { ThemedToken } from "shiki";

export interface SyntaxToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

export type SyntaxLine = SyntaxToken[];
type SupportedLanguage =
  | "jsonc"
  | "toml"
  | "markdown"
  | "yaml"
  | "text";

const fallbackLine = (line: string): SyntaxLine => [{ content: line }];

const fallbackLines = (code: string): SyntaxLine[] => code.split("\n").map(fallbackLine);

let highlighterPromise: Promise<HighlighterCore> | undefined;

const getHighlighter = () => {
  highlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/themes/github-light.mjs"),
    import("shiki/langs/jsonc.mjs"),
    import("shiki/langs/toml.mjs"),
    import("shiki/langs/md.mjs"),
    import("shiki/langs/yaml.mjs")
  ]).then(
    ([
      core,
      engine,
      githubLight,
      jsonc,
      toml,
      markdown,
      yaml
    ]) =>
      core.createHighlighterCore({
        themes: [githubLight.default],
        langs: [
          jsonc.default,
          toml.default,
          markdown.default,
          yaml.default
        ],
        engine: engine.createJavaScriptRegexEngine()
      })
  );

  return highlighterPromise;
};

export const languageForPath = (path: string): SupportedLanguage => {
  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith(".json") || lowerPath.endsWith(".jsonc")) {
    return "jsonc";
  }
  if (lowerPath.endsWith(".toml")) {
    return "toml";
  }
  if (lowerPath.endsWith(".md") || lowerPath.endsWith("agents.md")) {
    return "markdown";
  }
  if (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml")) {
    return "yaml";
  }

  return "text";
};

export const highlightCode = async (
  code: string,
  path: string
): Promise<SyntaxLine[]> => {
  if (code.length === 0) {
    return [[]];
  }
  const language = languageForPath(path);
  if (language === "text") {
    return fallbackLines(code);
  }

  try {
    const highlighter = await getHighlighter();
    const result = highlighter.codeToTokens(code, {
      lang: language,
      theme: "github-light"
    });

    return result.tokens.map((line: ThemedToken[]) =>
      line.map((token) => ({
        content: token.content,
        color: token.color,
        fontStyle: token.fontStyle
      }))
    );
  } catch {
    return fallbackLines(code);
  }
};

export const highlightCodeFallback = (code: string): SyntaxLine[] => fallbackLines(code);
