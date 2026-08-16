import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(join(root, path), "utf8");
const failures = [];
const requireText = (content, expected, owner) => {
  if (!content.includes(expected)) failures.push(`${owner} is missing ${expected}`);
};
const requirePattern = (content, expected, owner) => {
  if (!expected.test(content)) failures.push(`${owner} does not satisfy ${expected}`);
};

const [
  profileEditor,
  workspace,
  projectStyles,
  primitiveStyles,
  profileE2e,
  projectE2e,
  controlGroup,
  conversationWorkspace,
  targetWorkspace,
  targetStyles,
  visualContractText
] = await Promise.all([
  read("src/renderer/components/SkillsEditor.tsx"),
  read("src/renderer/components/ProjectsWorkspace.tsx"),
  read("src/renderer/ui/pages/projects.css"),
  read("src/renderer/ui/primitives.css"),
  read("tests/e2e/electronUiProfileSwitching.e2e.test.ts"),
  read("tests/e2e/projects.e2e.test.ts"),
  read("src/renderer/components/ui/ControlGroup.tsx"),
  read("src/renderer/components/ConversationWorkspace.tsx"),
  read("src/renderer/components/TargetWorkspace.tsx"),
  read("src/renderer/ui/pages/targets.css"),
  read("tests/visual/critical-captures.json")
]);

requireText(profileEditor, "<AlignedResourceList", "Profile Skills");
requireText(workspace, "<AlignedResourceList", "Workspace resources");
requireText(workspace, 'actionTrack="compact"', "Workspace resources");
requireText(primitiveStyles, ".ui-aligned-resource-list--compact-actions", "UI primitives");
requireText(profileE2e, "readAlignedResourceRows", "Profile geometry evidence");
requireText(profileE2e, 'toContain("Apply pending")', "Profile multi-state evidence");
requireText(profileE2e, 'toContain("Ready")', "Profile multi-state evidence");
requireText(profileE2e, 'getByRole("switch").count()', "Profile managed-action evidence");
requireText(projectE2e, "readAlignedResourceRows", "Workspace geometry evidence");
requireText(controlGroup, "data-control-density", "Control group density contract");
requirePattern(
  conversationWorkspace,
  /label=\{t\("Copy conversation"\)\}[\s\S]{0,160}variant="ghost"/,
  "Conversation utility action hierarchy"
);
requireText(targetWorkspace, 'className="target-loading-state"', "Agent initial loading state");
requirePattern(
  targetStyles,
  /\.target-loading-state\s*\{[^}]*width:\s*100%[^}]*\}/,
  "Agent loading geometry"
);

if (profileEditor.includes("ui-resource-children--aligned") ||
    workspace.includes("ui-resource-children--aligned")) {
  failures.push("A page still owns the deprecated aligned resource list class");
}
if (projectStyles.includes("--resource-row-actions-")) {
  failures.push("Workspace page CSS still owns shared action-track geometry");
}

const visualContract = JSON.parse(visualContractText);
const strictRegions = new Map([
  ["profile-skills-region-920.png", 0.003],
  ["workspaces-resources-region-920.png", 0.003],
  ["conversations-list-region-920.png", 0.003]
]);
for (const [file, maximum] of strictRegions) {
  const capture = visualContract.captures.find((entry) => entry.file === file);
  if (!capture) {
    failures.push(`Visual contract is missing strict region ${file}`);
  } else if (typeof capture.maxChangedPixelRatio !== "number" ||
      capture.maxChangedPixelRatio > maximum) {
    failures.push(`${file} must use a changed-pixel threshold at or below ${maximum}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`UI contract audit failed:\n- ${failures.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("UI contract audit passed.\n");
}
