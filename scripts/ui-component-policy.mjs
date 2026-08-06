import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const RAW_INTERACTIVE_PATTERN = /<(button|select|input|textarea|dialog)\b/g;

export const countRawInteractiveElements = (source) =>
  [...source.matchAll(RAW_INTERACTIVE_PATTERN)].length;

const listTsxFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  }));
  return files.flat();
};

export const collectRendererRawInteractiveUsage = async (projectRoot) => {
  const rendererRoot = resolve(projectRoot, "src/renderer");
  const files = await listTsxFiles(rendererRoot);
  const usage = new Map();
  for (const file of files) {
    const projectPath = relative(projectRoot, file).split("\\").join("/");
    if (projectPath.includes("/components/ui/")) continue;
    const count = countRawInteractiveElements(await readFile(file, "utf8"));
    if (count > 0) usage.set(projectPath, count);
  }
  return usage;
};

export const compareRawInteractiveBaseline = (usage, baseline) => {
  const failures = [];
  for (const [file, count] of usage) {
    const allowed = baseline[file];
    if (allowed === undefined) {
      failures.push(`${file} uses ${count} raw interactive element${count === 1 ? "" : "s"}; new feature files must use shared UI components`);
    } else if (count > allowed) {
      failures.push(`${file} uses ${count} raw interactive elements; baseline is ${allowed}`);
    }
  }
  return failures.sort();
};
