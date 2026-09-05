import { lstat, readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { hashFileContent } from "../filesystemIntegrity";
import { shellQuote } from "../remoteDevices/systemSshTransport";

export class RemoteProjectPreconditionError extends Error {}

export const remotePathGuard = (path: string): string[] => {
  if (!posix.isAbsolute(path) || posix.normalize(path) === "/" || /[\r\n\0]/.test(path)) {
    throw new Error("Remote resource must have a non-root absolute path");
  }
  const lines: string[] = [];
  let current = "/";
  for (const segment of posix.normalize(path).split("/").filter(Boolean)) {
    current = posix.join(current, segment);
    lines.push(`if [ -L ${shellQuote(current)} ]; then echo 'Remote resource path contains a symbolic link' >&2; exit 45; fi`);
  }
  return lines;
};

export const remoteHashFunction = [
  'aem_hash() {',
  '  { printf ".\\000file\\000"; cat -- "$1"; printf "\\000"; } | if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi',
  '}'
].join("\n");

export const remoteFileGuard = (path: string, hash: string): string[] => [
  ...remotePathGuard(path),
  ...(hash === "absent"
    ? [`[ ! -e ${shellQuote(path)} ] || { echo 'Remote resource changed after review' >&2; exit 46; }`]
    : [
      `[ -f ${shellQuote(path)} ] && [ "$(aem_hash ${shellQuote(path)} | cut -d ' ' -f 1)" = ${shellQuote(hash)} ] || { echo 'Remote resource changed after review' >&2; exit 46; }`
    ])
];

// Verify both contents and directory membership, including files removed by replacement.
export const remoteTreeGuard = async (localRoot: string, remoteRoot: string): Promise<string[]> => {
  const lines = remotePathGuard(remoteRoot);
  const visit = async (local: string, remote: string) => {
    const info = await lstat(local);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      throw new Error("Remote Skill snapshot contains an unsafe filesystem entry");
    }
    if (info.isFile()) {
      lines.push(...remoteFileGuard(remote, hashFileContent(await readFile(local))));
      return;
    }
    const names = await readdir(local);
    if (names.some((name) => /[\r\n\0]/.test(name))) throw new Error("Unsupported remote Skill filename");
    lines.push(
      `[ -d ${shellQuote(remote)} ] && [ ! -L ${shellQuote(remote)} ] || exit 46`,
      `[ "$(find ${shellQuote(remote)} -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = '${names.length}' ] || { echo 'Remote Skill changed after review' >&2; exit 46; }`
    );
    for (const name of names) await visit(join(local, name), posix.join(remote, name));
  };
  await visit(localRoot, remoteRoot);
  return lines;
};
