import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  highlightCodeFallback,
  highlightCodeLanguage,
  type SyntaxLine,
  type SyntaxToken
} from "../syntaxHighlighter";

const tokenStyle = (token: SyntaxToken): CSSProperties => ({
  color: token.color,
  fontStyle: token.fontStyle === 1 || token.fontStyle === 3 ? "italic" : undefined,
  fontWeight: token.fontStyle === 2 || token.fontStyle === 3 ? 700 : undefined,
  textDecoration: token.fontStyle === 4 ? "underline" : undefined
});

const HighlightedCode = ({
  code,
  language,
  className
}: {
  code: string;
  language: string;
  className?: string;
}) => {
  const fallback = useMemo(() => highlightCodeFallback(code), [code]);
  const [lines, setLines] = useState<SyntaxLine[]>(fallback);

  useEffect(() => {
    let active = true;
    setLines(fallback);
    void highlightCodeLanguage(code, language).then((next) => {
      if (active) setLines(next);
    });
    return () => {
      active = false;
    };
  }, [code, fallback, language]);

  return (
    <code className={className}>
      {lines.map((line, lineIndex) => (
        <span className="conversation-markdown__code-line" key={lineIndex}>
          {line.map((token, tokenIndex) => (
            <span key={tokenIndex} style={tokenStyle(token)}>
              {token.content}
            </span>
          ))}
          {lineIndex < lines.length - 1 ? "\n" : null}
        </span>
      ))}
    </code>
  );
};

const ExternalMarkdownLink = ({
  href,
  children,
  onOpenExternal
}: {
  href?: string;
  children?: ReactNode;
  onOpenExternal(href: string): void;
}) => {
  if (!href || !/^https?:\/\//i.test(href)) {
    return <span className="conversation-markdown__link-label">{children}</span>;
  }
  return (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault();
        onOpenExternal(href);
      }}
    >
      {children}
    </a>
  );
};

export const ConversationMarkdown = ({
  text,
  onOpenExternal
}: {
  text: string;
  onOpenExternal(href: string): void;
}) => (
  <div className="conversation-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <ExternalMarkdownLink href={href} onOpenExternal={onOpenExternal}>
            {children}
          </ExternalMarkdownLink>
        ),
        code: ({ className, children }) => {
          const match = /(?:^|\s)language-([\w+-]+)/.exec(className ?? "");
          const code = String(children).replace(/\n$/, "");
          return match ? (
            <HighlightedCode
              className={className}
              code={code}
              language={match[1]}
            />
          ) : <code className={className}>{children}</code>;
        },
        img: ({ alt, src }) => (
          <span
            className="conversation-markdown__image-reference"
            title={src}
          >
            {alt || src || "Image"}
          </span>
        )
      }}
    >
      {text}
    </ReactMarkdown>
  </div>
);
