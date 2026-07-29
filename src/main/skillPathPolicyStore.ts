import { createHash } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { normalizeSkillKey } from "../shared/skillIdentity";
import type {
  SharedSkillRetentionInput,
  SkillPathPolicy,
  SkillPathPolicyInput,
  SkillPathPolicyUpdate,
  SkillRuntimeSnapshot,
  TargetPaths
} from "../shared/types";
import { pathExists, writeAtomic } from "./fileUtils";
import type { AgentEnvPaths } from "./paths";

interface LegacySkillCleanupIgnoreRule {
  id: string;
  scope: "group" | "location";
  skillKey?: string;
  path?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillPathPolicyStore {
  read(): Promise<SkillPathPolicy[]>;
  migrateLegacy(
    snapshots: Array<{ target: TargetPaths; snapshot: SkillRuntimeSnapshot }>
  ): Promise<SkillPathPolicy[]>;
  find(
    policies: SkillPathPolicy[],
    input: SkillPathPolicyInput
  ): SkillPathPolicy | undefined;
  set(input: SkillPathPolicyUpdate): Promise<SkillPathPolicy[]>;
  setSharedRetention(input: SharedSkillRetentionInput): Promise<void>;
}

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const readJsonIfExists = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
};

const normalizePolicyInput = (
  input: SkillPathPolicyInput
): SkillPathPolicyInput => {
  const skillKey = normalizeSkillKey(input.skillKey);
  if (!skillKey) throw new Error("Skill key is required");
  if (!input.path.trim()) throw new Error("Skill path is required");
  return {
    path: resolve(input.path),
    skillKey,
    targetId: input.targetId?.trim() || undefined
  };
};

export const createSkillPathPolicyStore = (
  paths: AgentEnvPaths
): SkillPathPolicyStore => {
  const pathPoliciesPath = join(paths.appDataRoot, "skill-path-policies.json");
  const legacyIgnoreRulesPath = join(
    paths.appDataRoot,
    "skill-cleanup-ignore-rules.json"
  );

  const read = async (): Promise<SkillPathPolicy[]> =>
    ((await readJsonIfExists<SkillPathPolicy[]>(pathPoliciesPath)) ?? []).filter(
      (policy) =>
        policy &&
        typeof policy.id === "string" &&
        typeof policy.path === "string" &&
        typeof policy.skillKey === "string" &&
        (
          policy.mode === "keep-outside" ||
          policy.mode === "keep-shared" ||
          policy.mode === "use-library"
        )
    );

  const write = async (policies: SkillPathPolicy[]) => {
    await writeAtomic(pathPoliciesPath, `${JSON.stringify(policies, null, 2)}\n`);
  };

  const find = (
    policies: SkillPathPolicy[],
    input: SkillPathPolicyInput
  ) => {
    const normalized = normalizePolicyInput(input);
    return policies.find(
      (policy) =>
        resolve(policy.path) === normalized.path &&
        (!policy.targetId ||
          !normalized.targetId ||
          policy.targetId === normalized.targetId)
    );
  };

  const set = async ({
    items,
    mode
  }: SkillPathPolicyUpdate): Promise<SkillPathPolicy[]> => {
    const normalizedItems = items.map(normalizePolicyInput);
    if (normalizedItems.length === 0) return read();
    const now = new Date().toISOString();
    const policies = await read();
    const itemKeys = new Set(
      normalizedItems.map((item) => `${item.targetId ?? "*"}:${item.path}`)
    );
    const remaining = policies.filter(
      (policy) =>
        !itemKeys.has(`${policy.targetId ?? "*"}:${resolve(policy.path)}`)
    );
    if (mode) {
      for (const item of normalizedItems) {
        const existing = find(policies, item);
        remaining.push({
          id:
            existing?.id ??
            `skill-policy-${createHash("sha256")
              .update(`${item.targetId ?? "*"}:${item.path}`)
              .digest("hex")
              .slice(0, 16)}`,
          ...item,
          mode,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        });
      }
    }
    await write(remaining);
    return remaining;
  };

  const setSharedRetention = async ({
    skillKey,
    paths: retainedPaths,
    retained
  }: SharedSkillRetentionInput): Promise<void> => {
    const normalized = normalizeSkillKey(skillKey);
    await set({
      items: retainedPaths.map((path) => ({ path, skillKey: normalized })),
      mode: retained ? "keep-shared" : undefined
    });
  };

  const migrateLegacy = async (
    snapshots: Array<{ target: TargetPaths; snapshot: SkillRuntimeSnapshot }>
  ): Promise<SkillPathPolicy[]> => {
    const current = await read();
    if (
      (await pathExists(pathPoliciesPath)) ||
      !(await pathExists(legacyIgnoreRulesPath))
    ) {
      return current;
    }
    const legacyRules =
      (await readJsonIfExists<LegacySkillCleanupIgnoreRule[]>(
        legacyIgnoreRulesPath
      )) ?? [];
    const migrated = new Map<string, SkillPathPolicy>();
    const now = new Date().toISOString();
    for (const { target, snapshot } of snapshots) {
      for (const observation of snapshot.observations) {
        const skillKey = normalizeSkillKey(
          observation.runtimeName || observation.deploymentName
        );
        const matched = legacyRules.find((rule) =>
          rule.scope === "location"
            ? resolve(rule.path ?? "") === resolve(observation.path)
            : [skillKey, normalizeSkillKey(observation.deploymentName)].includes(
                normalizeSkillKey(rule.skillKey ?? "")
              )
        );
        if (!matched) continue;
        const path = resolve(observation.path);
        const mode =
          matched.reason === "keep-shared" ? "keep-shared" : "keep-outside";
        const targetId = observation.shared ? undefined : target.targetId;
        const key = `${targetId ?? "*"}:${skillKey}:${path}`;
        migrated.set(key, {
          id: `skill-policy-${createHash("sha256")
            .update(key)
            .digest("hex")
            .slice(0, 16)}`,
          path,
          skillKey,
          targetId,
          mode,
          createdAt: matched.createdAt || now,
          updatedAt: now
        });
      }
    }
    const policies = [...migrated.values()];
    await write(policies);
    await rename(
      legacyIgnoreRulesPath,
      `${legacyIgnoreRulesPath}.migrated-${now.replaceAll(":", "-")}`
    );
    return policies;
  };

  return { read, migrateLegacy, find, set, setSharedRetention };
};
