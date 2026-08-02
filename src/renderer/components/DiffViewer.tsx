import { useEffect, useMemo, useState } from "react";
import {
  highlightCode,
  highlightCodeFallback,
  languageForPath,
  type SyntaxLine,
  type SyntaxToken
} from "../syntaxHighlighter";
import { useI18n } from "../i18n";

type DiffRowKind = "file" | "hunk" | "addition" | "deletion" | "context";

interface DiffRow {
  id: string;
  kind: DiffRowKind;
  marker: string;
  oldLine?: number;
  newLine?: number;
  content: string;
  tokens: SyntaxLine;
}

interface ParsedDiffLine {
  id: string;
  kind: DiffRowKind;
  marker: string;
  oldLine?: number;
  newLine?: number;
  content: string;
}

interface DiffViewerProps {
  path: string;
  diff: string;
}

const hunkPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const parseDiff = (diff: string): ParsedDiffLine[] => {
  const rows: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  const lines = diff.split("\n");

  lines.forEach((line, index) => {
    if (line.length === 0 && index === lines.length - 1) {
      return;
    }

    if (line.startsWith("---") || line.startsWith("+++")) {
      rows.push({
        id: `${index}:file`,
        kind: "file",
        marker: line.slice(0, 3),
        content: line.slice(4)
      });
      return;
    }

    if (line.startsWith("@@")) {
      const match = hunkPattern.exec(line);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      rows.push({
        id: `${index}:hunk`,
        kind: "hunk",
        marker: "@@",
        content: line
      });
      return;
    }

    if (line.startsWith("+")) {
      rows.push({
        id: `${index}:addition`,
        kind: "addition",
        marker: "+",
        newLine,
        content: line.slice(1)
      });
      newLine += 1;
      return;
    }

    if (line.startsWith("-")) {
      rows.push({
        id: `${index}:deletion`,
        kind: "deletion",
        marker: "-",
        oldLine,
        content: line.slice(1)
      });
      oldLine += 1;
      return;
    }

    rows.push({
      id: `${index}:context`,
      kind: "context",
      marker: " ",
      oldLine,
      newLine,
      content: line.startsWith(" ") ? line.slice(1) : line
    });
    oldLine += 1;
    newLine += 1;
  });

  return rows;
};

const createRows = (parsedRows: ParsedDiffLine[], tokenLines: SyntaxLine[]): DiffRow[] =>
  parsedRows.map((row, index) => ({
    ...row,
    tokens: row.kind === "file" || row.kind === "hunk"
      ? [{ content: row.content }]
      : tokenLines[index] ?? [{ content: row.content }]
  }));

const tokenStyle = (token: SyntaxToken) => ({
  color: token.color,
  fontStyle: token.fontStyle === 1 || token.fontStyle === 3 ? "italic" : undefined,
  fontWeight: token.fontStyle === 2 || token.fontStyle === 3 ? 700 : undefined,
  textDecoration: token.fontStyle === 4 ? "underline" : undefined
});

export const DiffViewer = ({ path, diff }: DiffViewerProps) => {
  const { t } = useI18n();
  const parsedRows = useMemo(() => parseDiff(diff), [diff]);
  const fallbackTokens = useMemo(
    () => highlightCodeFallback(parsedRows.map((row) => row.content).join("\n")),
    [parsedRows]
  );
  const [rows, setRows] = useState<DiffRow[]>(() => createRows(parsedRows, fallbackTokens));

  useEffect(() => {
    let isMounted = true;
    setRows(createRows(parsedRows, fallbackTokens));

    void highlightCode(parsedRows.map((row) => row.content).join("\n"), path).then((tokens) => {
      if (isMounted) {
        setRows(createRows(parsedRows, tokens));
      }
    });

    return () => {
      isMounted = false;
    };
  }, [fallbackTokens, parsedRows, path]);

  return (
    <div className="diff-viewer">
      <div className="diff-language">{languageForPath(path)}</div>
      <div className="diff-table-wrap">
        <table className="diff-table" aria-label={t("Formatted diff for {{path}}", { path })}>
          <tbody>
            {rows.map((row) => (
              <tr className={`diff-row diff-row--${row.kind}`} key={row.id}>
                <td className="diff-line-number">{row.oldLine ?? ""}</td>
                <td className="diff-line-number">{row.newLine ?? ""}</td>
                <td className="diff-marker">{row.marker}</td>
                <td className="diff-code">
                  <code>
                    {row.tokens.length > 0
                      ? row.tokens.map((token, index) => (
                          <span
                            className="syntax-token"
                            // Tokens are immutable slices returned for this render pass.
                            key={`${index}:${token.content}`}
                            style={tokenStyle(token)}
                          >
                            {token.content}
                          </span>
                        ))
                      : "\u00a0"}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
