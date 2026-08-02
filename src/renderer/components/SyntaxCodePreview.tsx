import { useEffect, useMemo, useState } from "react";
import {
  highlightCode,
  highlightCodeFallback,
  type SyntaxToken
} from "../syntaxHighlighter";

interface SyntaxCodePreviewProps {
  className?: string;
  code: string;
  path: string;
}

const tokenStyle = (token: SyntaxToken) => ({
  color: token.color,
  fontStyle: token.fontStyle === 1 || token.fontStyle === 3 ? "italic" : undefined,
  fontWeight: token.fontStyle === 2 || token.fontStyle === 3 ? 700 : undefined,
  textDecoration: token.fontStyle === 4 ? "underline" : undefined
});

export const SyntaxCodePreview = ({ className, code, path }: SyntaxCodePreviewProps) => {
  const fallbackTokens = useMemo(() => highlightCodeFallback(code), [code]);
  const [tokens, setTokens] = useState(fallbackTokens);

  useEffect(() => {
    let active = true;
    setTokens(fallbackTokens);
    void highlightCode(code, path).then((nextTokens) => {
      if (active) setTokens(nextTokens);
    });
    return () => {
      active = false;
    };
  }, [code, fallbackTokens, path]);

  return (
    <pre className={`syntax-code-preview${className ? ` ${className}` : ""}`}>
      <code>
        {tokens.map((line, lineIndex) => (
          <span className="syntax-code-preview__line" key={`${lineIndex}:${line.length}`}>
            {line.length > 0
              ? line.map((token, tokenIndex) => (
                  <span
                    key={`${tokenIndex}:${token.content}`}
                    style={tokenStyle(token)}
                  >
                    {token.content}
                  </span>
                ))
              : "\u00a0"}
          </span>
        ))}
      </code>
    </pre>
  );
};
