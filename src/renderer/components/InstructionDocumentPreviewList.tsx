import { AlertTriangle, Expand, FileText, LoaderCircle } from "lucide-react";
import { useI18n } from "../i18n";
import { SyntaxCodePreview } from "./SyntaxCodePreview";
import { IconButton } from "./ui";

export interface InstructionDocumentPreview {
  id: string;
  name: string;
  path?: string;
  content?: string;
  metadata?: string;
  editable?: boolean;
  loading?: boolean;
  error?: string;
}

interface InstructionDocumentPreviewListProps {
  documents: InstructionDocumentPreview[];
  emptyLabel?: string;
  onOpen?(document: InstructionDocumentPreview): void;
}

export const InstructionDocumentPreviewList = ({
  documents,
  emptyLabel,
  onOpen
}: InstructionDocumentPreviewListProps) => {
  const { t } = useI18n();

  if (documents.length === 0) {
    return (
      <div className="instruction-documents__empty" role="status">
        {emptyLabel ?? t("No instruction files")}
      </div>
    );
  }

  return (
    <div className="instruction-documents">
      {documents.map((document) => (
        <article className="instruction-document" key={document.id}>
          <header className="instruction-document__header">
            <span className="instruction-document__icon" aria-hidden="true">
              <FileText size={15} strokeWidth={2} />
            </span>
            <div className="instruction-document__identity">
              <strong>{document.name}</strong>
              {document.path || document.metadata ? (
                <span
                  className="instruction-document__metadata selectable"
                  title={[document.path, document.metadata].filter(Boolean).join(" · ")}
                >
                  {[document.path, document.metadata].filter(Boolean).join(" · ")}
                </span>
              ) : null}
            </div>
            {onOpen ? (
              <IconButton
                className="instruction-document__open"
                label={t("Open {{name}}", { name: document.name })}
                size="compact"
                variant="ghost"
                onClick={() => onOpen(document)}
              >
                <Expand size={14} strokeWidth={2.1} />
              </IconButton>
            ) : null}
          </header>
          <div className="instruction-document__preview" aria-label={t("Preview of {{name}}", {
            name: document.name
          })}>
            {document.loading ? (
              <div className="instruction-document__state" role="status">
                <LoaderCircle className="is-spinning" size={15} />
                <span>{t("Loading preview")}</span>
              </div>
            ) : document.error ? (
              <div className="instruction-document__state is-error" role="alert">
                <AlertTriangle size={15} />
                <span>{document.error}</span>
              </div>
            ) : document.content ? (
              <SyntaxCodePreview code={document.content} path={document.name} />
            ) : (
              <div className="instruction-document__state">{t("Empty file")}</div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
};
