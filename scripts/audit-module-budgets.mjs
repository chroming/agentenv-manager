import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const budgets = {
  "src/renderer/App.tsx": 5200,
  "src/renderer/components/SkillLibraryPanel.tsx": 4380,
  "src/main/skillLibraryStore.ts": 3251,
  "src/main/activationService.ts": 2453,
  "src/renderer/hooks/useProfileDraftController.ts": 390,
  "src/renderer/hooks/useProfileActivationController.ts": 250,
  "src/renderer/hooks/useProfileActionGuard.ts": 125,
  "src/renderer/hooks/useWorkspaceNavigation.ts": 75,
  "src/renderer/ui/pages/profiles.css": 1770,
  "src/renderer/ui/pages/profile-skills.css": 350,
  "src/renderer/ui/pages/skills.css": 1820,
  "src/renderer/ui/pages/skills-dialogs.css": 510,
  "src/renderer/ui/pages/skills-merge.css": 260,
  "src/renderer/ui/pages/settings.css": 970,
  "src/renderer/ui/pages/settings-sync.css": 280,
  "src/renderer/ui/pages/targets.css": 600,
  "src/renderer/ui/pages/library-import.css": 795,
  "src/renderer/ui/pages/skill-sources.css": 650,
  "src/renderer/ui/pages/apply-preview.css": 660
};

const failures = [];
for (const [file, maximumLines] of Object.entries(budgets)) {
  const content = await readFile(resolve(file), "utf8");
  const lines = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  if (lines > maximumLines) {
    failures.push(`${file}: ${lines} lines exceeds the ${maximumLines}-line budget`);
  }
}

if (failures.length > 0) {
  throw new Error(
    `Large modules must be split before they grow further:\n${failures.join("\n")}`
  );
}

console.log("Module growth budgets passed.");
