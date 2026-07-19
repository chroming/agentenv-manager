export const preloadScriptName = "index.js";
export const windowBackgroundColor = "#f6f8fc";

export const windowChromeOptionsFor = (platform: NodeJS.Platform) =>
  platform === "darwin"
    ? ({ titleBarStyle: "hiddenInset" } as const)
    : ({} as const);
