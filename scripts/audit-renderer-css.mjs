import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const files = ["src/renderer/styles.css", "src/renderer/product-shell.css"];

const selectorCounts = (content) => {
  const counts = new Map();
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
    for (const rawSelector of match[1].split(",")) {
      const selector = rawSelector.replace(/\s+/g, " ").trim();
      if (!selector || selector.startsWith("@") || selector.includes(";")) {
        continue;
      }
      counts.set(selector, (counts.get(selector) ?? 0) + 1);
    }
  }
  return counts;
};

const reports = [];
for (const file of files) {
  const content = await readFile(resolve(projectRoot, file), "utf8");
  const selectors = selectorCounts(content);
  reports.push({
    file,
    lines: content.split("\n").length,
    selectorBlocks: [...selectors.values()].reduce((total, count) => total + count, 0),
    repeatedSelectors: [...selectors.values()].filter((count) => count > 1).length,
    mediaQueries: (content.match(/@media\b/g) ?? []).length,
    containerQueries: (content.match(/@container\b/g) ?? []).length,
    importantDeclarations: (content.match(/!important\b/g) ?? []).length,
    rawNumericLayers: [...content.matchAll(/z-index:\s*([0-9]+)/g)].map((match) => Number(match[1])),
    selectors
  });
}

const [first, second] = reports;
const sharedSelectors = [...first.selectors.keys()]
  .filter((selector) => second.selectors.has(selector))
  .sort(
    (left, right) =>
      (first.selectors.get(right) ?? 0) + (second.selectors.get(right) ?? 0) -
      ((first.selectors.get(left) ?? 0) + (second.selectors.get(left) ?? 0))
  );

const result = {
  files: reports.map(({ selectors: _selectors, ...report }) => report),
  totals: {
    lines: reports.reduce((total, report) => total + report.lines, 0),
    crossFileSelectors: sharedSelectors.length,
    mediaQueries: reports.reduce((total, report) => total + report.mediaQueries, 0),
    containerQueries: reports.reduce((total, report) => total + report.containerQueries, 0),
    importantDeclarations: reports.reduce(
      (total, report) => total + report.importantDeclarations,
      0
    ),
    rawNumericLayers: reports.flatMap((report) => report.rawNumericLayers)
  },
  topCrossFileSelectors: sharedSelectors.slice(0, 25).map((selector) => ({
    selector,
    [first.file]: first.selectors.get(selector),
    [second.file]: second.selectors.get(selector)
  }))
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
