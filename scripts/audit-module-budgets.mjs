import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const budgets = {
  "src/renderer/App.tsx": 5560,
  "src/main/skillLibraryStore.ts": 3246,
  "src/main/activationService.ts": 2453,
  "src/renderer/ui/pages/profiles.css": 1943,
  "src/renderer/ui/pages/skills.css": 1906
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
