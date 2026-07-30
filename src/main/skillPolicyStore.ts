import { createHash } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  SharedSkillRetentionInput,
  SkillCollectionMemberDecision,
  SkillCollectionMemberDecisionUpdate,
  SkillRuntimeSnapshot,
  TargetPaths,
  UnmanagedSkillLocation,
  UnmanagedSkillLocationInput,
  UnmanagedSkillLocationUpdate
} from "../shared/types";
import { pathExists, writeAtomic } from "./fileUtils";
import type { AgentEnvPaths } from "./paths";

interface LegacySkillPathPolicy {
  id: string;
  path: string;
  skillKey: string;
  targetId?: string;
  mode: "keep-outside" | "keep-shared" | "use-library";
  createdAt: string;
  updatedAt: string;
}

interface LegacySkillCleanupIgnoreRule {
  id: string;
  scope: "group" | "location";
  skillKey?: string;
  path?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillPolicyStore {
  migrateLegacy(
    snapshots: Array<{ target: TargetPaths; snapshot: SkillRuntimeSnapshot }>
  ): Promise<void>;
  readUnmanagedLocations(): Promise<UnmanagedSkillLocation[]>;
  findUnmanagedLocation(
    policies: readonly UnmanagedSkillLocation[],
    input: UnmanagedSkillLocationInput
  ): UnmanagedSkillLocation | undefined;
  setUnmanagedLocations(
    input: UnmanagedSkillLocationUpdate
  ): Promise<UnmanagedSkillLocation[]>;
  readCollectionDecisions(): Promise<SkillCollectionMemberDecision[]>;
  findCollectionDecision(
    decisions: readonly SkillCollectionMemberDecision[],
    path: string
  ): SkillCollectionMemberDecision | undefined;
  setCollectionDecision(
    input: SkillCollectionMemberDecisionUpdate
  ): Promise<SkillCollectionMemberDecision[]>;
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

const normalizedLocationInput = (
  input: UnmanagedSkillLocationInput
): Required<Pick<UnmanagedSkillLocationInput, "path" | "coverage">> & {
  targetId?: string;
} => {
  if (!input.path.trim()) throw new Error("Skill path is required");
  return {
    path: resolve(input.path),
    targetId: input.targetId?.trim() || undefined,
    coverage: input.coverage ?? "exact"
  };
};

const locationKey = (
  input: Pick<UnmanagedSkillLocationInput, "path" | "targetId" | "coverage">
) =>
  `${input.targetId ?? "*"}:${input.coverage ?? "exact"}:${resolve(input.path)}`;

const locationId = (
  input: Pick<UnmanagedSkillLocationInput, "path" | "targetId" | "coverage">
) =>
  `unmanaged-location-${createHash("sha256")
    .update(locationKey(input))
    .digest("hex")
    .slice(0, 16)}`;

const decisionId = (path: string) =>
  `collection-decision-${createHash("sha256")
    .update(resolve(path))
    .digest("hex")
    .slice(0, 16)}`;

const validLocation = (value: unknown): value is UnmanagedSkillLocation => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<UnmanagedSkillLocation>;
  return (
    typeof item.id === "string" &&
    typeof item.path === "string" &&
    (item.targetId === undefined || typeof item.targetId === "string") &&
    (item.coverage === "exact" || item.coverage === "collection") &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
};

const validDecision = (
  value: unknown
): value is SkillCollectionMemberDecision => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SkillCollectionMemberDecision>;
  return (
    typeof item.id === "string" &&
    typeof item.path === "string" &&
    item.decision === "use-library" &&
    (item.sourceContentHash === undefined ||
      typeof item.sourceContentHash === "string") &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
};

export const createSkillPolicyStore = (
  paths: AgentEnvPaths
): SkillPolicyStore => {
  const legacyPoliciesPath = join(
    paths.appDataRoot,
    "skill-path-policies.json"
  );
  const legacyIgnoreRulesPath = join(
    paths.appDataRoot,
    "skill-cleanup-ignore-rules.json"
  );

  const readUnmanagedLocations = async () =>
    (
      (await readJsonIfExists<unknown[]>(
        paths.unmanagedSkillLocationsPath
      )) ?? []
    )
      .filter(validLocation)
      .map((item) => ({ ...item, path: resolve(item.path) }));

  const readCollectionDecisions = async () =>
    (
      (await readJsonIfExists<unknown[]>(
        paths.skillCollectionDecisionsPath
      )) ?? []
    )
      .filter(validDecision)
      .map((item) => ({ ...item, path: resolve(item.path) }));

  const writeUnmanagedLocations = async (
    policies: UnmanagedSkillLocation[]
  ) => {
    const content = `${JSON.stringify(policies, null, 2)}\n`;
    const current = await readJsonIfExists<unknown[]>(
      paths.unmanagedSkillLocationsPath
    );
    if (current && `${JSON.stringify(current, null, 2)}\n` === content) return;
    await writeAtomic(paths.unmanagedSkillLocationsPath, content);
  };

  const writeCollectionDecisions = async (
    decisions: SkillCollectionMemberDecision[]
  ) => {
    const content = `${JSON.stringify(decisions, null, 2)}\n`;
    const current = await readJsonIfExists<unknown[]>(
      paths.skillCollectionDecisionsPath
    );
    if (current && `${JSON.stringify(current, null, 2)}\n` === content) return;
    await writeAtomic(paths.skillCollectionDecisionsPath, content);
  };

  const findUnmanagedLocation = (
    policies: readonly UnmanagedSkillLocation[],
    input: UnmanagedSkillLocationInput
  ) => {
    const normalized = normalizedLocationInput(input);
    const key = locationKey(normalized);
    return policies.find((policy) => locationKey(policy) === key);
  };

  const findCollectionDecision = (
    decisions: readonly SkillCollectionMemberDecision[],
    path: string
  ) => {
    const normalized = resolve(path);
    return decisions.find((decision) => resolve(decision.path) === normalized);
  };

  const migrateLegacy = async (
    snapshots: Array<{ target: TargetPaths; snapshot: SkillRuntimeSnapshot }>
  ) => {
    const hasLocations = await pathExists(paths.unmanagedSkillLocationsPath);
    const hasDecisions = await pathExists(paths.skillCollectionDecisionsPath);
    const legacyPolicies =
      (await readJsonIfExists<LegacySkillPathPolicy[]>(
        legacyPoliciesPath
      )) ?? [];
    const legacyRules =
      (await readJsonIfExists<LegacySkillCleanupIgnoreRule[]>(
        legacyIgnoreRulesPath
      )) ?? [];
    if (
      hasLocations &&
      hasDecisions &&
      legacyPolicies.length === 0 &&
      legacyRules.length === 0
    ) {
      return;
    }

    const now = new Date().toISOString();
    const locations = new Map(
      (await readUnmanagedLocations()).map((item) => [
        locationKey(item),
        item
      ])
    );
    const decisions = new Map(
      (await readCollectionDecisions()).map((item) => [
        resolve(item.path),
        item
      ])
    );
    const migratedLegacyRuleIds = new Set<string>();

    for (const policy of legacyPolicies) {
      if (policy.mode === "use-library") {
        const path = resolve(policy.path);
        decisions.set(path, {
          id: decisionId(path),
          path,
          decision: "use-library",
          createdAt: policy.createdAt || now,
          updatedAt: policy.updatedAt || now
        });
        continue;
      }
      const location = normalizedLocationInput({
        path: policy.path,
        targetId:
          policy.mode === "keep-shared" ? undefined : policy.targetId,
        coverage:
          policy.mode === "keep-shared" && policy.skillKey === "_collection"
            ? "collection"
            : "exact"
      });
      locations.set(locationKey(location), {
        id: locationId(location),
        ...location,
        createdAt: policy.createdAt || now,
        updatedAt: policy.updatedAt || now
      });
    }

    for (const { target, snapshot } of snapshots) {
      for (const observation of snapshot.observations) {
        const matched = legacyRules.find((rule) =>
          rule.scope === "location"
            ? resolve(rule.path ?? "") === resolve(observation.path)
            : [observation.runtimeName, observation.deploymentName]
                .map((value) => value.trim().toLowerCase())
                .includes((rule.skillKey ?? "").trim().toLowerCase())
        );
        if (!matched) continue;
        migratedLegacyRuleIds.add(matched.id);
        const location = normalizedLocationInput({
          path: observation.path,
          targetId: observation.shared ? undefined : target.targetId,
          coverage: "exact"
        });
        locations.set(locationKey(location), {
          id: locationId(location),
          ...location,
          createdAt: matched.createdAt || now,
          updatedAt: matched.updatedAt || now
        });
      }
    }

    await writeUnmanagedLocations(
      [...locations.values()].sort((left, right) =>
        locationKey(left).localeCompare(locationKey(right))
      )
    );
    await writeCollectionDecisions(
      [...decisions.values()].sort((left, right) =>
        left.path.localeCompare(right.path)
      )
    );

    const persistedLocations = await readUnmanagedLocations();
    const persistedDecisions = await readCollectionDecisions();
    if (
      [...locations.values()].some(
        (location) => !findUnmanagedLocation(persistedLocations, location)
      ) ||
      [...decisions.values()].some(
        (decision) => !findCollectionDecision(persistedDecisions, decision.path)
      )
    ) {
      throw new Error("Skill management boundary migration did not persist");
    }

    if (await pathExists(legacyPoliciesPath)) {
      await rename(
        legacyPoliciesPath,
        `${legacyPoliciesPath}.migrated-${now.replaceAll(":", "-")}`
      );
    }
    if (
      (await pathExists(legacyIgnoreRulesPath)) &&
      legacyRules.every((rule) => migratedLegacyRuleIds.has(rule.id))
    ) {
      await rename(
        legacyIgnoreRulesPath,
        `${legacyIgnoreRulesPath}.migrated-${now.replaceAll(":", "-")}`
      );
    }
  };

  const setUnmanagedLocations = async ({
    items,
    unmanaged
  }: UnmanagedSkillLocationUpdate) => {
    const normalizedItems = items.map(normalizedLocationInput);
    if (normalizedItems.length === 0) return readUnmanagedLocations();
    const current = await readUnmanagedLocations();
    const keys = new Set(normalizedItems.map(locationKey));
    const remaining = current.filter(
      (policy) => !keys.has(locationKey(policy))
    );
    if (unmanaged) {
      const now = new Date().toISOString();
      for (const item of normalizedItems) {
        const existing = findUnmanagedLocation(current, item);
        remaining.push(
          existing ?? {
            id: locationId(item),
            ...item,
            createdAt: now,
            updatedAt: now
          }
        );
      }
    }
    const next = remaining.sort((left, right) =>
      locationKey(left).localeCompare(locationKey(right))
    );
    await writeUnmanagedLocations(next);
    return next;
  };

  const setCollectionDecision = async ({
    path: inputPath,
    useLibrary,
    sourceContentHash
  }: SkillCollectionMemberDecisionUpdate) => {
    const path = resolve(inputPath);
    const current = await readCollectionDecisions();
    const remaining = current.filter(
      (decision) => resolve(decision.path) !== path
    );
    if (useLibrary) {
      const now = new Date().toISOString();
      const existing = findCollectionDecision(current, path);
      remaining.push(
        existing && existing.sourceContentHash === sourceContentHash
          ? existing
          : {
              id: existing?.id ?? decisionId(path),
              path,
              decision: "use-library",
              sourceContentHash,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now
            }
      );
    }
    const next = remaining.sort((left, right) =>
      left.path.localeCompare(right.path)
    );
    await writeCollectionDecisions(next);
    return next;
  };

  const setSharedRetention = async ({
    paths: retainedPaths,
    retained
  }: SharedSkillRetentionInput) => {
    await setUnmanagedLocations({
      items: retainedPaths.map((path) => ({
        path,
        coverage: "exact"
      })),
      unmanaged: retained
    });
  };

  return {
    migrateLegacy,
    readUnmanagedLocations,
    findUnmanagedLocation,
    setUnmanagedLocations,
    readCollectionDecisions,
    findCollectionDecision,
    setCollectionDecision,
    setSharedRetention
  };
};
