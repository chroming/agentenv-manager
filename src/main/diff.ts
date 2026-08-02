import { createPatch } from "diff";

export const createUnifiedDiff = (
  filePath: string,
  before: string,
  after: string
): string =>
  createPatch(filePath, before, after, "before", "after", {
    context: 3
  });
