import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const registryPath = join(root, "docs", "feature-evidence.json");
const visualContractPath = join(root, "tests", "visual", "critical-captures.json");
const visualBaselineRoot = join(root, "tests", "visual", "golden");
const targetRoot = join(root, "src", "main", "targets");
const requiredStates = [
  "idle",
  "working",
  "success",
  "error",
  "cancelled",
  "noOp",
  "stale",
  "partial",
  "persisted",
  "rollback"
];
const requiredEvidence = ["domain", "renderer", "desktop", "persistence", "visual"];
const supportValues = new Set(["supported", "partial", "unsupported", "not-applicable"]);

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
};

const failures = [];
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const visualContract = JSON.parse(await readFile(visualContractPath, "utf8"));
const criticalCaptures = new Set(visualContract.captures.map(({ file }) => file));
const targetIds = new Set();
for (const path of (await walk(targetRoot)).filter((entry) => entry.endsWith(".ts"))) {
  const content = await readFile(path, "utf8");
  for (const match of content.matchAll(/descriptor:\s*\{[\s\S]{0,400}?id:\s*"([^"]+)"/g)) {
    targetIds.add(match[1]);
  }
}

if (registry.formatVersion !== 1 || !Array.isArray(registry.features)) {
  throw new Error("Feature evidence registry must use formatVersion 1 and a features array.");
}
if (targetIds.size === 0) {
  throw new Error("Feature evidence audit could not discover registered Target IDs.");
}

const seenIds = new Set();
for (const feature of registry.features) {
  const label = feature?.id ?? "<missing-id>";
  if (typeof feature?.id !== "string" || feature.id.length === 0 || seenIds.has(feature.id)) {
    failures.push(`${label}: feature id is missing or duplicated`);
  }
  seenIds.add(feature?.id);

  const contractPath = feature?.contract?.path;
  const anchor = feature?.contract?.anchor;
  if (typeof contractPath !== "string" || typeof anchor !== "string") {
    failures.push(`${label}: contract path and anchor are required`);
  } else {
    try {
      const contract = await readFile(join(root, contractPath), "utf8");
      if (!contract.includes(anchor)) failures.push(`${label}: contract anchor was not found`);
    } catch {
      failures.push(`${label}: contract file does not exist: ${contractPath}`);
    }
  }

  const support = feature?.support ?? {};
  const supportIds = new Set(Object.keys(support));
  for (const targetId of targetIds) {
    if (!supportIds.has(targetId)) failures.push(`${label}: missing support status for ${targetId}`);
  }
  for (const targetId of supportIds) {
    if (!targetIds.has(targetId)) failures.push(`${label}: unknown Target in support matrix: ${targetId}`);
    if (!supportValues.has(support[targetId])) {
      failures.push(`${label}: invalid support status for ${targetId}: ${support[targetId]}`);
    }
  }

  for (const state of requiredStates) {
    if (typeof feature?.states?.[state] !== "string" || feature.states[state].trim().length === 0) {
      failures.push(`${label}: missing ${state} state semantics`);
    }
  }

  for (const category of requiredEvidence) {
    const entries = feature?.evidence?.[category];
    if (!Array.isArray(entries) || entries.length === 0) {
      failures.push(`${label}: ${category} evidence is required`);
      continue;
    }
    for (const entry of entries) {
      if (category === "visual") {
        if (!criticalCaptures.has(entry)) {
          failures.push(`${label}: visual evidence is not critical: ${entry}`);
          continue;
        }
        try {
          await access(join(visualBaselineRoot, entry));
        } catch {
          failures.push(`${label}: visual baseline does not exist: ${entry}`);
        }
      } else {
        try {
          await access(join(root, entry));
        } catch {
          failures.push(`${label}: evidence file does not exist: ${entry}`);
        }
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Feature evidence audit passed for ${registry.features.length} capabilities and ${targetIds.size} Targets.\n`
  );
}
