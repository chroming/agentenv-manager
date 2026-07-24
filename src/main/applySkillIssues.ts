import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { normalizeSkillKey } from "../shared/skillIdentity";
import { profileManagesResource } from "../shared/profileResources";
import type {
  ApplyIssue,
  ManagedResourceKind,
  ProfileDetail,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillRuntimeIssue,
  TargetPaths,
  TargetState
} from "../shared/types";
import { createApplyIssue, dedupeApplyIssues } from "./applyIssues";
import type { AgentTargetAdapter } from "./targets/types";

export const desiredSkillTargets = (profile: ProfileDetail) =>
  new Set(
    profile.resources.skills
      .filter((skillRef) => skillRef.enabled)
      .map((skillRef) => skillRef.targetName)
  );

export const desiredRuntimeSkills = (
  profile: ProfileDetail,
  skillLibrary: SkillLibraryEntry[]
) =>
  profile.resources.skills
    .filter((reference) => reference.enabled)
    .map((reference) => ({
      runtimeName:
        skillLibrary.find((skill) => skill.id === reference.libraryId)?.name ||
        reference.targetName,
      deploymentName: reference.targetName,
      source: `Library / ${reference.libraryId}`
    }));

interface NativeSkillState {
  disabledRuntimeNames: string[];
  issues: SkillRuntimeIssue[];
}

export const fingerprintRuntimeSkillPreconditions = (
  nativeState: NativeSkillState,
  profile: ProfileDetail,
  skillLibrary: SkillLibraryEntry[]
) => {
  const desiredNames = new Set(
    desiredRuntimeSkills(profile, skillLibrary).map((item) =>
      normalizeSkillKey(item.runtimeName)
    )
  );
  const comparable = {
    disabledDesiredRuntimeNames: nativeState.disabledRuntimeNames
      .filter((name) => desiredNames.has(normalizeSkillKey(name)))
      .map(normalizeSkillKey)
      .sort(),
    errors: nativeState.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => ({
        code: issue.code,
        message: issue.message
      }))
      .sort((left, right) =>
        `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`)
      )
  };
  return createHash("sha256").update(JSON.stringify(comparable)).digest("hex");
};

export const validateRuntimeSkills = async (
  adapter: AgentTargetAdapter,
  targetPaths: TargetPaths,
  profile: ProfileDetail,
  skillLibrary: SkillLibraryEntry[],
  inventory: SkillInventoryEntry[],
  nativeState?: NativeSkillState
) => {
  const currentNativeState =
    nativeState ?? await adapter.skills.readNativeState(targetPaths);
  const desired = desiredRuntimeSkills(profile, skillLibrary);
  const byRuntimeName = new Map<string, typeof desired>();
  for (const item of desired) {
    const key = normalizeSkillKey(item.runtimeName);
    byRuntimeName.set(key, [...(byRuntimeName.get(key) ?? []), item]);
  }

  const issues = [...byRuntimeName.entries()].flatMap(([runtimeName, items]) =>
    items.length > 1
      ? [
          createApplyIssue({
            code: "duplicate-runtime-skill",
            resourceKind: "skill",
            resourceId: runtimeName,
            message: `Profile declares runtime Skill name ${runtimeName} more than once`,
            detail: items.map((item) => item.source).join(", ")
          })
        ]
      : []
  );
  issues.push(
    ...currentNativeState.issues
      .filter((issue) => issue.severity !== "error")
      .map((issue) =>
        createApplyIssue({
          code: "runtime-observation",
          resourceKind: "skill",
          message: issue.message
        })
      ),
    ...currentNativeState.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) =>
        createApplyIssue({
          code: "runtime-state-unavailable",
          resourceKind: "skill",
          message: issue.message
        })
      )
  );

  const desiredNames = new Set(byRuntimeName.keys());
  for (const runtimeName of currentNativeState.disabledRuntimeNames) {
    if (desiredNames.has(normalizeSkillKey(runtimeName))) {
      issues.push(
        createApplyIssue({
          code: "native-disabled-skill",
          resourceKind: "skill",
          resourceId: runtimeName,
          message: `${adapter.descriptor.name} has Skill ${runtimeName} disabled in native settings; enable it there before applying this Profile`
        })
      );
    }
  }

  for (const [runtimeName, desiredItems] of byRuntimeName) {
    if (desiredItems.length !== 1) continue;
    const desiredItem = desiredItems[0];
    const conflictingPaths = [
      ...new Set(
        inventory
          .filter(
            (item) =>
              item.locationRole !== "discovery-only" &&
              item.runtimeAvailability !== "disabled" &&
              normalizeSkillKey(item.runtimeName ?? item.name) === runtimeName &&
              normalizeSkillKey(item.deploymentName ?? item.id) !==
                normalizeSkillKey(desiredItem.deploymentName) &&
              !(item.status === "managed" && item.managedByTarget === true)
          )
          .map((item) => item.path)
      )
    ].sort((left, right) => left.localeCompare(right));
    for (const path of conflictingPaths) {
      issues.push(
        createApplyIssue({
          code: "runtime-skill-conflict",
          resourceKind: "skill",
          resourceId: desiredItem.runtimeName,
          path,
          message: `Cannot install runtime Skill ${desiredItem.runtimeName} as ${desiredItem.deploymentName} because an existing Agent Skill declares the same runtime name`
        })
      );
    }
  }
  return dedupeApplyIssues(issues);
};

const desiredManagedPaths = (profile: ProfileDetail, targetPaths: TargetPaths) => {
  const desired = new Set<string>();
  if (profileManagesResource(profile.resources, targetPaths.targetId, "instructions")) {
    desired.add(targetPaths.instructionsPath);
  }
  if (
    targetPaths.skillsDir &&
    profileManagesResource(profile.resources, targetPaths.targetId, "skills")
  ) {
    for (const targetName of desiredSkillTargets(profile)) {
      desired.add(join(targetPaths.skillsDir, targetName));
    }
  }
  return desired;
};

export const findManagedDrift = async ({
  state,
  profile,
  targetPaths,
  hashPath,
  affectedPaths,
  automaticallyAdoptablePaths = new Set(),
  expectedManagedSkillHashes = new Map()
}: {
  state: TargetState;
  profile: ProfileDetail;
  targetPaths: TargetPaths;
  hashPath(path: string, kind?: ManagedResourceKind): Promise<string | undefined>;
  affectedPaths?: ReadonlySet<string>;
  automaticallyAdoptablePaths?: ReadonlySet<string>;
  expectedManagedSkillHashes?: ReadonlyMap<string, string>;
}) => {
  const issues: ApplyIssue[] = [];
  const paths = new Set<string>();
  const desired = desiredManagedPaths(profile, targetPaths);
  for (const resource of state.managedResources ?? []) {
    // Native configuration files have shared ownership. Adapters compare and
    // patch only their managed fields, while Preview freshness protects the
    // whole file between confirmation and Apply.
    if (resource.kind === "config") continue;
    if (affectedPaths && !affectedPaths.has(resource.path)) continue;

    const currentHash = await hashPath(resource.path, resource.kind);
    if (!currentHash) {
      if (desired.has(resource.path)) {
        issues.push(
          createApplyIssue({
            code: "managed-resource-missing",
            resourceKind: resource.kind === "instructions" ? "instructions" : "skill",
            resourceId: resource.id,
            path: resource.path,
            message: `Missing managed ${resource.kind} ${resource.id} will be restored`
          })
        );
      }
      continue;
    }

    if (currentHash === resource.contentHash) continue;
    if (
      resource.kind === "skill" &&
      expectedManagedSkillHashes.get(resolve(resource.path)) === currentHash
    ) {
      continue;
    }
    if (
      resource.kind === "skill" &&
      automaticallyAdoptablePaths.has(resolve(resource.path))
    ) {
      continue;
    }
    paths.add(resource.path);
    issues.push(
      createApplyIssue({
        code: "managed-resource-drift",
        resourceKind: resource.kind === "instructions" ? "instructions" : "skill",
        resourceId: resource.id,
        path: resource.path,
        message:
          resource.kind === "instructions"
            ? "AgentEnv-managed Instructions changed outside AgentEnv"
            : `AgentEnv-managed ${resource.kind} ${resource.id} changed outside AgentEnv`
      })
    );
  }
  return { issues: dedupeApplyIssues(issues), paths };
};

export const preservedUnmanagedSkillIssues = (
  profile: ProfileDetail,
  inventory: SkillInventoryEntry[]
) => {
  const desired = desiredSkillTargets(profile);
  return inventory
    .filter(
      (skill) =>
        skill.status === "kept-outside" &&
        !desired.has(skill.id)
    )
    .map((skill) =>
      createApplyIssue({
        code: "kept-outside-skill",
        resourceKind: "skill",
        resourceId: skill.runtimeName ?? skill.id,
        path: skill.path,
        message: `${skill.runtimeName ?? skill.id} stays outside AgentEnv on this Agent`
      })
    );
};
