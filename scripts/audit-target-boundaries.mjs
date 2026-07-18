import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const sourceRoot = join(root, "src");
const targetRoot = join(sourceRoot, "main", "targets");

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
};

const targetFiles = (await walk(targetRoot)).filter((path) => path.endsWith("Target.ts"));
const targetIds = new Set();
for (const path of targetFiles) {
  const content = await readFile(path, "utf8");
  for (const match of content.matchAll(/descriptor:\s*\{[\s\S]{0,400}?id:\s*"([^"]+)"/g)) {
    targetIds.add(match[1]);
  }
}

if (targetIds.size === 0) {
  throw new Error("Target boundary audit could not discover any registered descriptor IDs.");
}

const allowedFiles = new Set([
  "src/main/paths.ts",
  "src/shared/schemas.ts",
  "src/shared/types.ts",
  "src/renderer/components/ProfileSidebar.tsx",
  "src/renderer/styles.css"
]);
const sourceFiles = (await walk(sourceRoot)).filter((path) =>
  [".ts", ".tsx", ".css"].includes(extname(path))
);
const failures = [];

for (const path of sourceFiles) {
  const projectPath = relative(root, path);
  if (path.startsWith(`${targetRoot}/`) || allowedFiles.has(projectPath)) continue;
  const content = await readFile(path, "utf8");
  const lines = content.split("\n");
  for (const targetId of targetIds) {
    const quoted = new RegExp(`["']${targetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
    lines.forEach((line, index) => {
      if (quoted.test(line)) {
        failures.push(`${projectPath}:${index + 1} contains Target ID ${targetId}`);
      }
    });
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Target boundary audit passed for ${[...targetIds].join(", ")}.\n`);
}
