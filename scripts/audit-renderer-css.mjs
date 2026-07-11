import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const rendererRoot = resolve(projectRoot, "src/renderer");
const shouldCheck = process.argv.includes("--check");

const listCssFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return listCssFiles(path);
      return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
    })
  );
  return nestedFiles.flat();
};

const files = (await listCssFiles(rendererRoot))
  .map((file) => relative(projectRoot, file))
  .sort();

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

const selectorFiles = new Map();
for (const report of reports) {
  for (const [selector, count] of report.selectors) {
    const locations = selectorFiles.get(selector) ?? [];
    locations.push({ file: report.file, count });
    selectorFiles.set(selector, locations);
  }
}
const sharedSelectors = [...selectorFiles.entries()]
  .filter(([, locations]) => locations.length > 1)
  .sort(
    ([, left], [, right]) =>
      right.reduce((total, location) => total + location.count, 0) -
      left.reduce((total, location) => total + location.count, 0)
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
  topCrossFileSelectors: sharedSelectors.slice(0, 25).map(([selector, locations]) => ({
    selector,
    ...Object.fromEntries(locations.map(({ file, count }) => [file, count]))
  }))
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (shouldCheck) {
  const legacyStyles = result.files.find(({ file }) => file === "src/renderer/styles.css");
  const importantOutsideAccessibility = result.files.filter(
    ({ file, importantDeclarations }) =>
      importantDeclarations > 0 && file !== "src/renderer/ui/accessibility.css"
  );
  const failures = [
    files.includes("src/renderer/product-shell.css")
      ? "src/renderer/product-shell.css must not return"
      : undefined,
    (legacyStyles?.lines ?? Number.POSITIVE_INFINITY) > 5795
      ? "src/renderer/styles.css grew beyond its frozen migration baseline"
      : undefined,
    result.totals.containerQueries < 2
      ? "Skills and Profiles container-query contracts are missing"
      : undefined,
    result.totals.rawNumericLayers.length > 0
      ? "Use named z-index tokens instead of numeric layers"
      : undefined,
    importantOutsideAccessibility.length > 0
      ? `!important is only allowed in accessibility.css: ${importantOutsideAccessibility
          .map(({ file }) => file)
          .join(", ")}`
      : undefined,
    result.totals.importantDeclarations !== 4
      ? "The reduced-motion contract must remain the only four !important declarations"
      : undefined
  ].filter(Boolean);

  if (failures.length > 0) {
    process.stderr.write(`\nCSS architecture check failed:\n- ${failures.join("\n- ")}\n`);
    process.exitCode = 1;
  }
}
