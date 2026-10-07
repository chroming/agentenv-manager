// Keep code, path, and diff typography owned by the shared font token.
export const collectHardcodedMonoFonts = (content) => {
  const source = content.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  return [...source.matchAll(/(?:^|[;{}])\s*(font-family|font)\s*:\s*([^;{}]+)(?=[;}])/g)]
    .flatMap((match) => {
      if (!/\b(?:ui-monospace|monospace|SFMono-Regular|Menlo|Monaco|Consolas|Liberation Mono)\b/i.test(match[2])) return [];
      const offset = match.index + match[0].indexOf(match[1]);
      return [{ line: source.slice(0, offset).split("\n").length,
        property: match[1], value: match[2].replace(/\s+/g, " ").trim() }];
    });
};
