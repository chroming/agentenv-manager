import { useState } from "react";
import { Code } from "lucide-react";
import { useI18n } from "../i18n";
import { ReadOnlyMarkdown } from "./ReadOnlyMarkdown";
import { SyntaxCodePreview } from "./SyntaxCodePreview";
import { IconButton, Notice } from "./ui";

export const InstructionContentPreview = ({ content, path }: { content: string; path: string }) => {
  const { t } = useI18n();
  const [view, setView] = useState<"preview" | "source">("preview");
  const [error, setError] = useState("");
  const markdown = /\.md(?:own)?$/i.test(path);
  return (
    <div className="instruction-content-preview">
      {markdown ? (
        <div className="instruction-content-preview__toolbar">
          <IconButton label={t("Source code")} variant="ghost" size="compact"
            aria-pressed={view === "source"}
            onClick={() => setView(view === "source" ? "preview" : "source")}><Code size={14} /></IconButton>
        </div>
      ) : null}
      {error ? <Notice tone="danger" role="alert">{error}</Notice> : null}
      {markdown && view === "preview" ? (
        <ReadOnlyMarkdown text={content} wrapCode onOpenExternal={(href) => {
          setError("");
          void window.agentEnv.openExternalUrl(href).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          });
        }} />
      ) : <SyntaxCodePreview code={content} path={path} />}
    </div>
  );
};
