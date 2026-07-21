import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  WorkspaceSyncChange,
  WorkspaceSyncConflictChoice,
  WorkspaceSyncReview
} from "../../shared/workspaceSync";
import { writeAtomic } from "../fileUtils";
import type { PortableWorkspaceManifest } from "./portableSchemas";
import { canonicalJson, hashJson, snapshotHashFor } from "./workspaceSnapshotHasher";

export interface WorkspaceSnapshotDescriptor {
  root: string;
  manifest: PortableWorkspaceManifest;
}

interface SectionRecord {
  key: string;
  resourceKind: WorkspaceSyncChange["resourceKind"];
  resourceId: string;
  section: string;
  hash?: string;
  path: string;
}

export interface WorkspaceSyncPlan {
  review: WorkspaceSyncReview;
  sections: Map<string, { base?: SectionRecord; local?: SectionRecord; remote?: SectionRecord }>;
}

const sectionsFor = (snapshot: WorkspaceSnapshotDescriptor | undefined): Map<string, SectionRecord> => {
  const result = new Map<string, SectionRecord>();
  if (!snapshot) return result;
  for (const [id, hashes] of Object.entries(snapshot.manifest.profileHashes)) {
    for (const section of ["manifest", "instructions", "resources"] as const) {
      const file = section === "manifest" ? "profile.json" : section === "instructions" ? "INSTRUCTIONS.md" : "resources.json";
      const key = `profile:${id}:${section}`;
      result.set(key, { key, resourceKind: "profile", resourceId: id, section, hash: hashes[section], path: join(snapshot.root, "workspace", "profiles", id, file) });
    }
  }
  for (const [id, hashes] of Object.entries(snapshot.manifest.skillHashes)) {
    for (const section of ["content", "metadata"] as const) {
      const key = `skill:${id}:${section}`;
      result.set(key, { key, resourceKind: "skill", resourceId: id, section, hash: hashes[section], path: join(snapshot.root, "workspace", "skills", id, section === "content" ? "content" : "metadata.json") });
    }
  }
  result.set("source:registry:sources", {
    key: "source:registry:sources",
    resourceKind: "source",
    resourceId: "registry",
    section: "sources",
    hash: snapshot.manifest.sourcesHash,
    path: join(snapshot.root, "workspace", "skill-sources.json")
  });
  return result;
};

const directionFor = (base: string | undefined, local: string | undefined, remote: string | undefined) => {
  if (local === remote) return undefined;
  if (local === base) return "remote" as const;
  if (remote === base) return "local" as const;
  if (base === undefined && local === undefined) return "remote" as const;
  if (base === undefined && remote === undefined) return "local" as const;
  return "conflict" as const;
};

const actionFor = (before: string | undefined, after: string | undefined): WorkspaceSyncChange["action"] =>
  before === undefined ? "add" : after === undefined ? "delete" : "update";

const titleFor = (record: SectionRecord) => {
  if (record.resourceKind === "source") return "Skill sources";
  return record.resourceId;
};

export const planWorkspaceSync = (input: {
  base?: WorkspaceSnapshotDescriptor;
  local: WorkspaceSnapshotDescriptor;
  remote?: WorkspaceSnapshotDescriptor;
  baseRevision?: string;
  remoteRevision?: string;
  liveSkillIds?: string[];
  liveAgentIds?: string[];
}): WorkspaceSyncPlan => {
  const base = sectionsFor(input.base);
  const local = sectionsFor(input.local);
  const remote = sectionsFor(input.remote);
  const keys = [...new Set([...base.keys(), ...local.keys(), ...remote.keys()])].sort();
  const sections = new Map<string, { base?: SectionRecord; local?: SectionRecord; remote?: SectionRecord }>();
  const changes: WorkspaceSyncChange[] = [];
  for (const key of keys) {
    const item = { base: base.get(key), local: local.get(key), remote: remote.get(key) };
    sections.set(key, item);
    const direction = directionFor(item.base?.hash, item.local?.hash, item.remote?.hash);
    if (!direction) continue;
    if (
      key === "source:registry:sources" &&
      !item.base &&
      !item.remote &&
      item.local?.hash === hashJson({ formatVersion: 1, sources: [] })
    ) continue;
    const record = item.local ?? item.remote ?? item.base!;
    changes.push({
      key,
      resourceKind: record.resourceKind,
      resourceId: record.resourceId,
      section: record.section,
      action: actionFor(item.base?.hash, direction === "remote" ? item.remote?.hash : item.local?.hash),
      direction,
      title: titleFor(record),
      detail: record.section
    });
  }
  const localChanges = changes.filter((change) => change.direction === "local" || change.direction === "conflict");
  const remoteChanges = changes.filter((change) => change.direction === "remote" || change.direction === "conflict");
  return {
    sections,
    review: {
      baseRevision: input.baseRevision,
      remoteRevision: input.remoteRevision,
      changes,
      liveSkillIds: [...new Set(input.liveSkillIds ?? [])].sort(),
      liveAgentIds: [...new Set(input.liveAgentIds ?? [])].sort(),
      canUpdate: remoteChanges.length > 0,
      canPublish: localChanges.length > 0
    }
  };
};

const copySection = async (source: string | undefined, destination: string) => {
  await rm(destination, { recursive: true, force: true });
  if (!source) return;
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
};

export const materializeMergedWorkspace = async (input: {
  plan: WorkspaceSyncPlan;
  local: WorkspaceSnapshotDescriptor;
  remote: WorkspaceSnapshotDescriptor;
  destination: string;
  conflictChoices?: Record<string, WorkspaceSyncConflictChoice>;
}): Promise<WorkspaceSnapshotDescriptor> => {
  await rm(input.destination, { recursive: true, force: true });
  await cp(join(input.local.root, "workspace"), join(input.destination, "workspace"), { recursive: true });
  const selected = new Map<string, SectionRecord | undefined>();
  for (const [key, sections] of input.plan.sections) {
    const direction = directionFor(sections.base?.hash, sections.local?.hash, sections.remote?.hash);
    let record = sections.local;
    if (direction === "remote") record = sections.remote;
    if (direction === "conflict") {
      const choice = input.conflictChoices?.[key];
      if (!choice) throw new Error(`Workspace Sync conflict needs a choice: ${key}`);
      record = choice === "remote" ? sections.remote : sections.local;
    }
    selected.set(key, record);
    if (record === sections.local) continue;
    const localPath = sections.local?.path ?? (() => {
      const source = sections.remote ?? sections.base!;
      if (source.resourceKind === "profile") {
        const file = source.section === "manifest" ? "profile.json" : source.section === "instructions" ? "INSTRUCTIONS.md" : "resources.json";
        return join(input.local.root, "workspace", "profiles", source.resourceId, file);
      }
      if (source.resourceKind === "skill") {
        return join(input.local.root, "workspace", "skills", source.resourceId, source.section === "content" ? "content" : "metadata.json");
      }
      return join(input.local.root, "workspace", "skill-sources.json");
    })();
    const destination = localPath.replace(input.local.root, input.destination);
    await copySection(record?.path, destination);
  }

  const profileHashes: PortableWorkspaceManifest["profileHashes"] = {};
  const profileIds = new Set([...selected.keys()].filter((key) => key.startsWith("profile:")).map((key) => key.split(":")[1]!));
  for (const id of profileIds) {
    const manifest = selected.get(`profile:${id}:manifest`)?.hash;
    const instructions = selected.get(`profile:${id}:instructions`)?.hash;
    const resources = selected.get(`profile:${id}:resources`)?.hash;
    if (!manifest && !instructions && !resources) {
      await rm(join(input.destination, "workspace", "profiles", id), { recursive: true, force: true });
      continue;
    }
    if (!manifest || !instructions || !resources) throw new Error(`Merged Profile ${id} is incomplete`);
    profileHashes[id] = { manifest, instructions, resources, total: hashJson({ manifest, instructions, resources }) };
  }
  const skillHashes: PortableWorkspaceManifest["skillHashes"] = {};
  const skillIds = new Set([...selected.keys()].filter((key) => key.startsWith("skill:")).map((key) => key.split(":")[1]!));
  for (const id of skillIds) {
    const content = selected.get(`skill:${id}:content`)?.hash;
    const metadata = selected.get(`skill:${id}:metadata`)?.hash;
    if (!content && !metadata) {
      await rm(join(input.destination, "workspace", "skills", id), { recursive: true, force: true });
      continue;
    }
    if (!content || !metadata) throw new Error(`Merged Skill ${id} is incomplete`);
    skillHashes[id] = { content, metadata, total: hashJson({ content, metadata }) };
  }
  const sourcesHash = selected.get("source:registry:sources")?.hash;
  if (!sourcesHash) throw new Error("Merged Workspace is missing its Skill source registry");
  const unsigned = {
    formatVersion: 1 as const,
    workspaceId: input.local.manifest.workspaceId,
    profileHashes,
    skillHashes,
    sourcesHash
  };
  const manifest = { ...unsigned, snapshotHash: snapshotHashFor(unsigned) };
  await writeAtomic(join(input.destination, "agentenv-sync.json"), canonicalJson(manifest));
  return { root: input.destination, manifest };
};
