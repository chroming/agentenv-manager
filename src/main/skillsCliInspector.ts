import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillExternalOwnership, SkillUpstream } from "../shared/types";

interface SkillsCliLockEntry {
  source?: unknown;
  sourceType?: unknown;
  sourceUrl?: unknown;
  ref?: unknown;
  skillPath?: unknown;
  skillFolderHash?: unknown;
}

interface SkillsCliLockFile {
  version?: unknown;
  skills?: unknown;
}

export interface SkillsCliInspection {
  evidenceBySkillKey: Map<string, SkillExternalOwnership>;
  diagnostics: string[];
}

const SUPPORTED_LOCK_VERSION = 3;

const normalizeSkillKey = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

const stringValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const upstreamKind = (sourceType: string | undefined): SkillUpstream["kind"] | undefined => {
  if (
    sourceType === "github" ||
    sourceType === "gitlab" ||
    sourceType === "git" ||
    sourceType === "local"
  ) {
    return sourceType;
  }
  return sourceType === "well-known" ? "well-known" : undefined;
};

const upstreamFor = (entry: SkillsCliLockEntry): SkillUpstream | undefined => {
  const kind = upstreamKind(stringValue(entry.sourceType));
  const rawLocator = stringValue(entry.sourceUrl) ?? stringValue(entry.source);
  if (!kind || !rawLocator) {
    return undefined;
  }
  const locator =
    kind === "github" && /^[^/\s]+\/[^/\s]+$/.test(rawLocator)
      ? `https://github.com/${rawLocator}`
      : rawLocator;
  const skillPath = stringValue(entry.skillPath);
  return {
    kind,
    locator,
    ref: stringValue(entry.ref),
    subpath: skillPath?.replace(/(?:^|\/)SKILL\.md$/i, "").replace(/\/$/, ""),
    revision: stringValue(entry.skillFolderHash)
  };
};

export const defaultSkillsCliLockPaths = (
  homeDir: string,
  xdgStateHome = process.env.XDG_STATE_HOME?.trim()
) => [
  ...(xdgStateHome ? [join(xdgStateHome, "skills", ".skill-lock.json")] : []),
  join(homeDir, ".agents", ".skill-lock.json")
];

export const inspectSkillsCliLocks = async (
  homeDir: string,
  lockPaths = defaultSkillsCliLockPaths(homeDir)
): Promise<SkillsCliInspection> => {
  const evidenceBySkillKey = new Map<string, SkillExternalOwnership>();
  const diagnostics: string[] = [];

  for (const lockPath of [...new Set(lockPaths)]) {
    let parsed: SkillsCliLockFile;
    try {
      parsed = JSON.parse(await readFile(lockPath, "utf8")) as SkillsCliLockFile;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      diagnostics.push(`Could not read Skills CLI lock ${lockPath}`);
      continue;
    }

    if (
      parsed.version !== SUPPORTED_LOCK_VERSION ||
      !parsed.skills ||
      typeof parsed.skills !== "object"
    ) {
      diagnostics.push(`Unsupported Skills CLI lock version at ${lockPath}`);
      continue;
    }

    for (const [skillName, rawEntry] of Object.entries(parsed.skills)) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
        continue;
      }
      const skillKey = normalizeSkillKey(skillName);
      if (!skillKey || evidenceBySkillKey.has(skillKey)) {
        continue;
      }
      evidenceBySkillKey.set(skillKey, {
        manager: "skills-cli",
        lockPath,
        lockVersion: SUPPORTED_LOCK_VERSION,
        canonicalPath: join(homeDir, ".agents", "skills", skillKey),
        confidence: "inferred",
        state: "healthy",
        upstream: upstreamFor(rawEntry as SkillsCliLockEntry)
      });
    }
  }

  return { evidenceBySkillKey, diagnostics };
};
