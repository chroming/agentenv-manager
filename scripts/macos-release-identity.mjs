export const extractDesignatedRequirement = (output, source) => {
  const requirement = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("designated =>"));
  if (!requirement) {
    throw new Error(`Could not read designated requirement from ${source}`);
  }
  return requirement;
};
