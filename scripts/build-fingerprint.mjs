import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const BUILD_INPUTS = [
  "src",
  "electron.vite.config.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.node.json"
];

export const BUILD_STAMP_RELATIVE_PATH = join("out", ".agentenv-build.json");

const portablePath = (path) => path.split(sep).join("/");

const collectFiles = async (projectRoot, entries, excluded = new Set()) => {
  const files = [];

  const visit = async (absolutePath) => {
    const projectPath = portablePath(relative(projectRoot, absolutePath));
    if (excluded.has(projectPath)) {
      return;
    }
    const metadata = await lstat(absolutePath);
    if (metadata.isDirectory()) {
      const children = await readdir(absolutePath);
      for (const child of children.sort()) {
        await visit(join(absolutePath, child));
      }
      return;
    }
    files.push({
      path: projectPath,
      content: await readFile(absolutePath)
    });
  };

  for (const entry of entries) {
    await visit(resolve(projectRoot, entry));
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
};

const fingerprintFiles = (files) => {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(String(file.content.byteLength));
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return {
    sha256: hash.digest("hex"),
    files: files.length
  };
};

export const computeBuildSourceFingerprint = async (projectRoot) =>
  fingerprintFiles(await collectFiles(resolve(projectRoot), BUILD_INPUTS));

export const computeBuildArtifactFingerprint = async (projectRoot) =>
  fingerprintFiles(
    await collectFiles(resolve(projectRoot), ["out"], new Set([
      portablePath(BUILD_STAMP_RELATIVE_PATH)
    ]))
  );

const validateStamp = (value) => {
  if (
    !value ||
    typeof value !== "object" ||
    value.formatVersion !== 1 ||
    typeof value.generatedAt !== "string" ||
    typeof value.source?.sha256 !== "string" ||
    typeof value.source?.files !== "number" ||
    typeof value.artifact?.sha256 !== "string" ||
    typeof value.artifact?.files !== "number"
  ) {
    throw new Error("Electron build identity is missing or invalid. Run npm run build.");
  }
  return value;
};

export const readBuildFingerprint = async (projectRoot) => {
  try {
    return validateStamp(
      JSON.parse(
        await readFile(
          join(resolve(projectRoot), BUILD_STAMP_RELATIVE_PATH),
          "utf8"
        )
      )
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Electron build identity is invalid. Run npm run build.");
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("Electron build identity is missing. Run npm run build.");
    }
    throw error;
  }
};

export const writeBuildFingerprint = async (projectRoot) => {
  const root = resolve(projectRoot);
  const stampPath = join(root, BUILD_STAMP_RELATIVE_PATH);
  const stamp = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    source: await computeBuildSourceFingerprint(root),
    artifact: await computeBuildArtifactFingerprint(root)
  };
  const temporaryPath = `${stampPath}.tmp-${process.pid}`;
  await mkdir(dirname(stampPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
  await rename(temporaryPath, stampPath);
  return stamp;
};

export const assertCurrentBuild = async (projectRoot) => {
  const root = resolve(projectRoot);
  const recorded = await readBuildFingerprint(root);
  const source = await computeBuildSourceFingerprint(root);
  if (
    recorded.source.sha256 !== source.sha256 ||
    recorded.source.files !== source.files
  ) {
    throw new Error(
      "Electron build is stale: build inputs changed after out/ was generated. Run npm run build before Electron E2E or capture."
    );
  }
  const artifact = await computeBuildArtifactFingerprint(root);
  if (
    recorded.artifact.sha256 !== artifact.sha256 ||
    recorded.artifact.files !== artifact.files
  ) {
    throw new Error(
      "Electron build identity does not match out/. Run npm run build before Electron E2E or capture."
    );
  }
  return recorded;
};
