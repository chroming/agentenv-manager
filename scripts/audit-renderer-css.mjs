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

const rendererIndex = await readFile(resolve(rendererRoot, "ui/index.css"), "utf8");
const baseStyles = await readFile(resolve(rendererRoot, "ui/base.css"), "utf8");
const baseButtonBlock = baseStyles.match(/(?:^|\n)button\s*\{([\s\S]*?)\}/)?.[1] ?? "";
const baseStrongBlock = baseStyles.match(/(?:^|\n)strong,\s*\nb\s*\{([\s\S]*?)\}/)?.[1] ?? "";
const primitiveRootSelectors = new Set([
  ".ui-action-menu",
  ".ui-badge",
  ".ui-button",
  ".ui-dialog-footer",
  ".ui-dialog-header",
  ".ui-icon-button",
  ".ui-page-header",
  ".ui-resource-row",
  ".ui-composite-field",
  ".ui-surface-frame",
  ".ui-switch"
]);
const runtimeCustomProperties = new Set([
  "--hover-detail-arrow-left",
  "--hover-detail-origin-x"
]);
const animationOwnerFiles = new Set([
  "src/renderer/ui/accessibility.css",
  "src/renderer/ui/primitives.css"
]);
const highFrequencySpatialSelectors = [
  ".workspace-button",
  ".profile-row",
  ".library-table-row",
  ".resource-row",
  ".resource-picker-option"
];

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
const declaredCustomProperties = new Set();
const usedCustomProperties = new Map();
for (const file of files) {
  const content = await readFile(resolve(projectRoot, file), "utf8");
  for (const match of content.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) {
    declaredCustomProperties.add(match[1]);
  }
  for (const match of content.matchAll(/var\((--[a-zA-Z0-9_-]+)/g)) {
    const locations = usedCustomProperties.get(match[1]) ?? new Set();
    locations.add(file);
    usedCustomProperties.set(match[1], locations);
  }
  const selectors = selectorCounts(content);
  const hardcodedRadii = [...content.matchAll(/border-radius:\s*([^;]+);/g)]
    .map((match) => match[1].trim())
    .filter((value) => /\d+(?:px|rem|em|%)/.test(value) && value !== "50%");
  const highFrequencySpatialMotion = [
    ...content.matchAll(/([^{}]+)\{([^{}]*\btransform\s*:\s*([^;]+);[^{}]*)\}/g)
  ]
    .map((match) => ({
      selector: match[1].replace(/\s+/g, " ").trim(),
      value: match[3].trim()
    }))
    .filter(({ selector }) =>
      highFrequencySpatialSelectors.some((candidate) => selector.includes(candidate))
    );
  reports.push({
    file,
    lines: content.split("\n").length,
    selectorBlocks: [...selectors.values()].reduce((total, count) => total + count, 0),
    repeatedSelectors: [...selectors.values()].filter((count) => count > 1).length,
    mediaQueries: (content.match(/@media\b/g) ?? []).length,
    containerQueries: (content.match(/@container\b/g) ?? []).length,
    importantDeclarations: (content.match(/!important\b/g) ?? []).length,
    rawNumericLayers: [...content.matchAll(/z-index:\s*([0-9]+)/g)].map((match) => Number(match[1])),
    hardcodedRadii,
    semiboldDeclarations: (content.match(/font-weight:\s*var\(--font-weight-semibold\)/g) ?? []).length,
    heavyNumericFontWeights: [...content.matchAll(/font-weight:\s*([0-9]+)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => value > 650),
    animationDeclarations: (content.match(/\banimation\s*:/g) ?? []).length,
    keyframes: [...content.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)]
      .map((match) => match[1]),
    highFrequencySpatialMotion,
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

const pagePrimitiveRedefinitions = reports.flatMap((report) => {
  if (!report.file.startsWith("src/renderer/ui/pages/")) return [];
  return [...report.selectors.keys()]
    .filter((selector) => primitiveRootSelectors.has(selector))
    .map((selector) => ({ file: report.file, selector }));
});
const undefinedCustomProperties = [...usedCustomProperties.entries()]
  .filter(
    ([property]) =>
      !declaredCustomProperties.has(property) &&
      !runtimeCustomProperties.has(property)
  )
  .map(([property, locations]) => ({
    property,
    files: [...locations].sort()
  }))
  .sort((left, right) => left.property.localeCompare(right.property));
const animationOwnerViolations = reports
  .filter(
    ({ file, animationDeclarations, keyframes }) =>
      !animationOwnerFiles.has(file) &&
      (animationDeclarations > 0 || keyframes.length > 0)
  )
  .map(({ file, animationDeclarations, keyframes }) => ({
    file,
    animationDeclarations,
    keyframes
  }));
const highFrequencySpatialMotion = reports.flatMap(({ file, highFrequencySpatialMotion }) =>
  highFrequencySpatialMotion.map((motion) => ({ file, ...motion }))
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
    rawNumericLayers: reports.flatMap((report) => report.rawNumericLayers),
    hardcodedRadii: reports.flatMap((report) =>
      report.hardcodedRadii.map((value) => ({ file: report.file, value }))
    ),
    semiboldDeclarations: reports.reduce(
      (total, report) => total + report.semiboldDeclarations,
      0
    ),
    heavyNumericFontWeights: reports.flatMap((report) =>
      report.heavyNumericFontWeights.map((value) => ({ file: report.file, value }))
    )
  },
  architecture: {
    animationOwnerViolations,
    highFrequencySpatialMotion,
    pagePrimitiveRedefinitions,
    undefinedCustomProperties,
    usesLateSystemLayer: /(?:\bsystem\b|system\.css)/.test(rendererIndex)
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
    files.includes("src/renderer/ui/system.css")
      ? "src/renderer/ui/system.css must not return; rules belong to primitives, shell, pages, or overlays"
      : undefined,
    result.architecture.usesLateSystemLayer
      ? "ui/index.css must not restore a late system override layer"
      : undefined,
    result.architecture.pagePrimitiveRedefinitions.length > 0
      ? `Page styles must not redefine primitive roots: ${result.architecture.pagePrimitiveRedefinitions
          .map(({ file, selector }) => `${file} (${selector})`)
          .join(", ")}`
      : undefined,
    result.architecture.animationOwnerViolations.length > 0
      ? `Animation declarations belong to shared primitives or accessibility: ${result.architecture.animationOwnerViolations
          .map(({ file }) => file)
          .join(", ")}`
      : undefined,
    result.architecture.highFrequencySpatialMotion.length > 0
      ? `High-frequency rows and navigation must not move: ${result.architecture.highFrequencySpatialMotion
          .map(({ file, selector, value }) => `${file} (${selector}: ${value})`)
          .join("; ")}`
      : undefined,
    result.architecture.undefinedCustomProperties.length > 0
      ? `CSS custom properties must be declared in the renderer token system: ${result.architecture.undefinedCustomProperties
          .map(({ property, files }) => `${property} (${files.join(", ")})`)
          .join("; ")}`
      : undefined,
    result.totals.crossFileSelectors > 141
      ? "Cross-file selector duplication grew beyond the ownership migration baseline"
      : undefined,
    (legacyStyles?.lines ?? Number.POSITIVE_INFINITY) > 5776
      ? "src/renderer/styles.css grew beyond its frozen migration baseline"
      : undefined,
    result.totals.containerQueries < 2
      ? "Skills and Profiles container-query contracts are missing"
      : undefined,
    result.totals.rawNumericLayers.length > 0
      ? "Use named z-index tokens instead of numeric layers"
      : undefined,
    result.totals.hardcodedRadii.length > 0
      ? `Use radius tokens instead of numeric radii: ${result.totals.hardcodedRadii
          .map(({ file, value }) => `${file} (${value})`)
          .join(", ")}`
      : undefined,
    result.totals.heavyNumericFontWeights.length > 0
      ? `Interface font weights above 650 are not allowed: ${result.totals.heavyNumericFontWeights
          .map(({ file, value }) => `${file} (${value})`)
          .join(", ")}`
      : undefined,
    result.totals.semiboldDeclarations > 8
      ? "Semibold emphasis exceeds the product-wide typography budget"
      : undefined,
    !/font-weight:\s*inherit/.test(baseStrongBlock)
      ? "Strong elements must inherit by default; components own visual emphasis"
      : undefined,
    importantOutsideAccessibility.length > 0
      ? `!important is only allowed in accessibility.css: ${importantOutsideAccessibility
          .map(({ file }) => file)
          .join(", ")}`
      : undefined,
    result.totals.importantDeclarations !== 4
      ? "The reduced-motion contract must remain the only four !important declarations"
      : undefined,
    /overflow(?:-x|-y)?:\s*(?:hidden|clip)/.test(baseButtonBlock)
      ? "Base buttons must expose sizing defects instead of clipping visible command text"
      : undefined
  ].filter(Boolean);

  if (failures.length > 0) {
    process.stderr.write(`\nCSS architecture check failed:\n- ${failures.join("\n- ")}\n`);
    process.exitCode = 1;
  }
}
