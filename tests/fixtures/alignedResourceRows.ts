export type AlignedResourceFixtureAction = "icon" | "menu" | "none" | "switch" | "text";
export type AlignedResourceFixtureState =
  | "disabled"
  | "error"
  | "pending"
  | "ready"
  | "unavailable"
  | "update";

export interface AlignedResourceRowFixture {
  action: AlignedResourceFixtureAction;
  description: string;
  name: string;
  state: AlignedResourceFixtureState;
}

export const alignedResourceRowFixtures: AlignedResourceRowFixture[] = [
  { action: "switch", description: "GitHub · main", name: "reviewer", state: "ready" },
  { action: "menu", description: "本地固定副本", name: "质量检查", state: "update" },
  { action: "text", description: "目前由 Agent 控制", name: "workspace-tools", state: "unavailable" },
  { action: "icon", description: "需要重新应用", name: "release-check", state: "pending" },
  { action: "none", description: "來源無法讀取", name: "source-audit", state: "error" },
  { action: "switch", description: "Kept for later", name: "legacy-helper", state: "disabled" }
];
