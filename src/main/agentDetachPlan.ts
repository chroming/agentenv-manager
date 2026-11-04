import { cp, lstat, readFile, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ManagedResourceSnapshot } from "../shared/types";
import { isMissingFileError, replacePathAtomically } from "./fileUtils";
import { hashPathEntry } from "./filesystemIntegrity";
import { markerPathForFile } from "./ownershipMarkers";
import { hashSkillContent } from "./skillContentHash";
import { copySkillEntries } from "./skillDeployment";

export interface AgentDetachPlan {
  links: Array<{ path: string; source: string; kind: ManagedResourceSnapshot["kind"]; hash: string }>;
  markers: Array<{ path: string; hash: string }>;
}

export const planAgentDetach = async (resources: ManagedResourceSnapshot[], targetId: string): Promise<AgentDetachPlan> => {
  const plan: AgentDetachPlan = { links: [], markers: [] };
  for (const resource of resources) {
    const info = await lstat(resource.path).catch((error) => { if (isMissingFileError(error)) return undefined; throw error; });
    if (info?.isSymbolicLink()) plan.links.push({ path: resource.path, source: await realpath(resource.path), kind: resource.kind, hash: (await hashPathEntry(resource.path))! });
    const candidates = [markerPathForFile(resource.path), ...(info?.isDirectory() ? [join(resource.path, ".agentenv-owner.json")] : [])];
    for (const path of candidates) {
      const marker = await lstat(path).catch((error) => { if (isMissingFileError(error)) return undefined; throw error; });
      if (!marker?.isFile() || marker.isSymbolicLink() || marker.size > 16 * 1024) continue;
      let value: Record<string, unknown> | null;
      try { value = JSON.parse(await readFile(path, "utf8")); } catch { continue; }
      if (!value || value.targetId !== targetId || value.owner !== "agentenv-manager" && !(value.owner === undefined && ["skill", "agent"].includes(String(value.kind)))) continue;
      plan.markers.push({ path, hash: (await hashPathEntry(path))! });
    }
  }
  return plan;
};

export const applyAgentDetachPlan = async (plan: AgentDetachPlan, claim: {
  (...paths: string[]): Promise<void>;
  recordMutation(...paths: string[]): Promise<void>;
}) => {
  for (const link of plan.links) {
    await claim(link.path);
    const source = await realpath(link.path), info = await stat(source);
    if (source !== link.source) throw new Error(`Agent link changed after preview: ${link.path}`);
    const contentHash = () => info.isDirectory() ? hashSkillContent(source) : hashPathEntry(source);
    const before = await contentHash();
    await replacePathAtomically(link.path, async (staging) => {
      if (link.kind === "skill" && info.isDirectory()) await copySkillEntries(source, staging);
      else await cp(source, staging, { recursive: info.isDirectory(), dereference: true });
      const copied = info.isDirectory() ? await hashSkillContent(staging) : await hashPathEntry(staging);
      if (await contentHash() !== before || copied !== before) throw new Error(`Agent resource changed while making its independent copy: ${link.path}`);
    }, { expectedTargetHash: link.hash });
    await claim.recordMutation(link.path);
  }
  for (const marker of plan.markers) {
    await claim(marker.path);
    if (await hashPathEntry(marker.path) !== marker.hash) throw new Error(`Agent ownership marker changed: ${marker.path}`);
    await rm(marker.path);
    await claim.recordMutation(marker.path);
  }
};
