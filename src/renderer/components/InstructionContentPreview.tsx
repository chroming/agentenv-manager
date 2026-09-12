import { useState } from "react";
import { useI18n } from "../i18n";
import { ReadOnlyMarkdown } from "./ReadOnlyMarkdown";
import { SyntaxCodePreview } from "./SyntaxCodePreview";
import { Notice, ResourcePanelToolbar, SegmentedControl } from "./ui";

export const InstructionContentPreview = ({ content, path }: { content: string; path: string }) => {
  const { t } = useI18n();
  const [view, setView] = useState<"preview" | "source">("preview");
  const [error, setError] = useState("");
  const markdown = /\.md(?:own)?$/i.test(path);
  return (
    <div className="instruction-content-preview">
      {markdown ? (
        <ResourcePanelToolbar variant="embedded" className="instruction-content-preview__toolbar">
          <SegmentedControl<"preview" | "source">
            label={t("Preview")}
            value={view}
            options={[{ value: "preview", label: t("Preview") }, { value: "source", label: t("Source code") }]}
            onChange={setView}
          />
        </ResourcePanelToolbar>
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
