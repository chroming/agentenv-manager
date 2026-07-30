import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rendererRoot = join(process.cwd(), "src", "renderer");

const rendererTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return rendererTypeScriptFiles(path);
    return entry.isFile() && path.endsWith(".tsx") ? [path] : [];
  });

describe("modal dismissal contract", () => {
  it("requires every modal backdrop to declare its dismissal policy", () => {
    const missingPolicies: string[] = [];

    for (const path of rendererTypeScriptFiles(rendererRoot)) {
      const source = readFileSync(path, "utf8");
      let searchFrom = 0;
      while (true) {
        const classIndex = source.indexOf("preview-modal-backdrop", searchFrom);
        if (classIndex === -1) break;
        const tagStart = source.lastIndexOf("<div", classIndex);
        const tagEnd = source.indexOf(">", classIndex);
        const openingTag = source.slice(tagStart, tagEnd + 1);
        if (tagStart === -1 || tagEnd === -1 || !openingTag.includes("data-dismiss-policy")) {
          const line = source.slice(0, classIndex).split("\n").length;
          missingPolicies.push(`${path.slice(process.cwd().length + 1)}:${line}`);
        }
        searchFrom = classIndex + "preview-modal-backdrop".length;
      }
    }

    expect(missingPolicies).toEqual([]);
  });
});
