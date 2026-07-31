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
  | "json"
  | "json5"
  | "toml"
  | "markdown"
  | "mdx"
  | "yaml"
  | "javascript"
  | "typescript"
  | "tsx"
  | "jsx"
  | "python"
  | "bash"
  | "diff"
  | "css"
  | "scss"
  | "sass"
  | "less"
  | "html"
  | "xml"
  | "dockerfile"
  | "dotenv"
  | "ini"
  | "sql"
  | "make"
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
  const fileName = lowerPath.replaceAll("\\", "/").split("/").at(-1) ?? "";

  if (lowerPath.endsWith(".json") || lowerPath.endsWith(".jsonc")) {
    return "jsonc";
  }
  if (lowerPath.endsWith(".json5")) {
    return "json5";
  }
  if (lowerPath.endsWith(".toml")) {
    return "toml";
  }
  if (lowerPath.endsWith(".md") || lowerPath.endsWith("agents.md")) {
    return "markdown";
  }
  if (lowerPath.endsWith(".mdx")) {
    return "mdx";
  }
  if (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml")) {
    return "yaml";
  }
  if (lowerPath.endsWith(".tsx")) {
    return "tsx";
  }
  if (lowerPath.endsWith(".jsx")) {
    return "jsx";
  }
  if (
    lowerPath.endsWith(".ts")
    || lowerPath.endsWith(".mts")
    || lowerPath.endsWith(".cts")
  ) {
    return "typescript";
  }
  if (
    lowerPath.endsWith(".js")
    || lowerPath.endsWith(".mjs")
    || lowerPath.endsWith(".cjs")
  ) {
    return "javascript";
  }
  if (lowerPath.endsWith(".py") || lowerPath.endsWith(".pyi")) {
    return "python";
  }
  if (
    lowerPath.endsWith(".sh")
    || lowerPath.endsWith(".bash")
    || lowerPath.endsWith(".zsh")
    || lowerPath.endsWith(".fish")
  ) {
    return "bash";
  }
  if (lowerPath.endsWith(".css")) {
    return "css";
  }
  if (lowerPath.endsWith(".scss")) {
    return "scss";
  }
  if (lowerPath.endsWith(".sass")) {
    return "sass";
  }
  if (lowerPath.endsWith(".less")) {
    return "less";
  }
  if (lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")) {
    return "html";
  }
  if (
    lowerPath.endsWith(".xml")
    || lowerPath.endsWith(".plist")
    || lowerPath.endsWith(".svg")
  ) {
    return "xml";
  }
  if (/^(dockerfile|containerfile)(?:\.|$)/.test(fileName)) {
    return "dockerfile";
  }
  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return "dotenv";
  }
  if (
    lowerPath.endsWith(".ini")
    || lowerPath.endsWith(".cfg")
    || lowerPath.endsWith(".conf")
    || lowerPath.endsWith(".properties")
  ) {
    return "ini";
  }
  if (lowerPath.endsWith(".sql")) {
    return "sql";
  }
  if (fileName === "makefile" || fileName.endsWith(".mk")) {
    return "make";
  }
  if (lowerPath.endsWith(".diff") || lowerPath.endsWith(".patch")) {
    return "diff";
  }

  return "text";
};

type LanguageRegistration = Parameters<HighlighterCore["loadLanguage"]>[0];
const loadedLanguages = new Set<SupportedLanguage>([
  "jsonc",
  "toml",
  "markdown",
  "yaml"
]);
const loadingLanguages = new Map<SupportedLanguage, Promise<void>>();
const additionalLanguageLoaders: Partial<Record<
  SupportedLanguage,
  () => Promise<{ default: LanguageRegistration }>
>> = {
  json: () => import("shiki/langs/json.mjs"),
  json5: () => import("shiki/langs/json5.mjs"),
  mdx: () => import("shiki/langs/mdx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  sass: () => import("shiki/langs/sass.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  dotenv: () => import("shiki/langs/dotenv.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  make: () => import("shiki/langs/make.mjs")
};

const ensureLanguage = async (
  highlighter: HighlighterCore,
  language: SupportedLanguage
) => {
  if (language === "text" || loadedLanguages.has(language)) return;
  let loading = loadingLanguages.get(language);
  if (!loading) {
    const loader = additionalLanguageLoaders[language];
    if (!loader) return;
    loading = loader()
      .then((module) => highlighter.loadLanguage(module.default))
      .then(() => {
        loadedLanguages.add(language);
      })
      .finally(() => {
        loadingLanguages.delete(language);
      });
    loadingLanguages.set(language, loading);
  }
  await loading;
};

const languageAliases: Record<string, SupportedLanguage> = {
  bash: "bash",
  css: "css",
  diff: "diff",
  docker: "dockerfile",
  dockerfile: "dockerfile",
  dotenv: "dotenv",
  html: "html",
  ini: "ini",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  json5: "json5",
  jsonc: "jsonc",
  jsx: "jsx",
  markdown: "markdown",
  make: "make",
  makefile: "make",
  md: "markdown",
  mdx: "mdx",
  python: "python",
  py: "python",
  sass: "sass",
  scss: "scss",
  shell: "bash",
  sh: "bash",
  sql: "sql",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  less: "less"
};

export const languageForFence = (value: string): SupportedLanguage =>
  languageAliases[value.trim().toLowerCase()] ?? "text";

export const highlightCodeLanguage = async (
  code: string,
  languageName: string
): Promise<SyntaxLine[]> => {
  if (code.length === 0) return [[]];
  const language = languageForFence(languageName);
  if (language === "text") return fallbackLines(code);
  try {
    const highlighter = await getHighlighter();
    await ensureLanguage(highlighter, language);
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

  return highlightCodeLanguage(code, language);
};

export const highlightCodeFallback = (code: string): SyntaxLine[] => fallbackLines(code);
