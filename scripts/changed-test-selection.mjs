const unique = (items) => [...new Set(items)].sort();

export const selectQuickVerification = (changedFiles) => {
  const files = unique(changedFiles.filter(Boolean));
  const rendererChanged = files.some((file) => file.startsWith("src/renderer/"));
  const styleChanged = files.some((file) => file.endsWith(".css"));
  const sharedBoundaryChanged = files.some((file) =>
    file.startsWith("src/shared/") ||
    file === "src/main/ipc.ts" ||
    file.startsWith("src/preload/")
  );
  const targetBoundaryChanged = files.some((file) =>
    file.startsWith("src/main/targets/") ||
    file.startsWith("src/shared/") ||
    file === "src/main/ipc.ts"
  );
  const translationsChanged = files.some((file) =>
    file === "src/renderer/i18n.tsx" || file.includes("/i18n/")
  );

  const extraTests = [];
  if (rendererChanged || sharedBoundaryChanged) {
    extraTests.push("tests/renderer/App.test.tsx");
  }
  if (sharedBoundaryChanged) {
    extraTests.push("tests/main/packagePackaging.test.ts");
  }

  const audits = ["audit:modules"];
  if (styleChanged) audits.push("audit:styles");
  if (targetBoundaryChanged) audits.push("audit:targets");
  if (translationsChanged || rendererChanged) audits.push("audit:translations");

  return {
    audits: unique(audits),
    extraTests: unique(extraTests),
    relatedFiles: files.filter((file) =>
      file.startsWith("src/") ||
      file.startsWith("tests/") ||
      file.startsWith("scripts/") ||
      file === "package.json"
    ),
    runElectron: false
  };
};
