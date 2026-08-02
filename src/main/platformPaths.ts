import { posix, win32 } from "node:path";

const pathApiFor = (platform: NodeJS.Platform) =>
  platform === "win32" ? win32 : posix;

export const canonicalPathKey = (
  value: string,
  platform: NodeJS.Platform = process.platform
) => {
  const normalized = pathApiFor(platform).resolve(value);
  return platform === "win32"
    ? normalized.normalize("NFC").toLocaleLowerCase("en-US")
    : normalized;
};

export const pathsEqual = (
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform
) => canonicalPathKey(left, platform) === canonicalPathKey(right, platform);

export const isPathInside = (
  root: string,
  candidate: string,
  options: {
    allowRoot?: boolean;
    platform?: NodeJS.Platform;
  } = {}
) => {
  const platform = options.platform ?? process.platform;
  const pathApi = pathApiFor(platform);
  const relativePath = pathApi.relative(
    pathApi.resolve(root),
    pathApi.resolve(candidate)
  );
  if (!relativePath) return options.allowRoot ?? false;
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relativePath)
  );
};

export const platformNullDevice = (
  platform: NodeJS.Platform = process.platform
) => platform === "win32" ? "NUL" : "/dev/null";
