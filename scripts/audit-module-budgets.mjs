import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const budgets = {
  "src/renderer/App.tsx": 5550,
  "src/renderer/components/SkillLibraryPanel.tsx": 4380,
  "src/main/skillLibraryStore.ts": 3246,
  "src/main/activationService.ts": 2453,
  "src/renderer/ui/pages/profiles.css": 1785,
  "src/renderer/ui/pages/skills.css": 1855,
  "src/renderer/ui/pages/settings.css": 1220,
  "src/renderer/ui/pages/targets.css": 1005,
  "src/renderer/ui/pages/library-import.css": 795,
  "src/renderer/ui/pages/skill-sources.css": 715,
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
