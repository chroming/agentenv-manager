import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type {
  AgentEnvSettings,
  TargetDescriptor,
  TargetInfo
} from "../../shared/types";
import { isTargetInstalled } from "../../shared/targetHealth";

const dismissedAgentSuggestionsSessionKey = "agentenv:dismissed-agent-suggestions";
export const currentAgentDiscoveryVersion = 1;

const readDismissedAgentSuggestions = () => {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(
      dismissedAgentSuggestionsSessionKey
    ) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
};

interface AgentDiscoveryOptions {
  appModalOpen: boolean;
  isLoading: boolean;
  settings: AgentEnvSettings;
  supportedTargets: TargetDescriptor[];
  updateSettings(input: Partial<AgentEnvSettings>): Promise<AgentEnvSettings | undefined>;
}

interface AgentDiscoveryController {
  agentProbeComplete: boolean;
  detectedDisabledAgents: TargetInfo[];
  dialogPhase: "choose" | "setup";
  dialogOpen: boolean;
  discoveredTargets: TargetInfo[];
  enabledAgentIds: string[];
  allowSuggestionPreferences: boolean;
  visibleAgentSuggestions: TargetInfo[];
  chooseTargetConfigRoot(targetId: string): Promise<void>;
  dismissAgentSuggestions(): void;
  enableSuggestedAgents(agentIds: string[]): Promise<void>;
  openAgentChooser(): void;
  probeSupportedAgents(forceRefresh?: boolean): Promise<void>;
  restoreAllAgentSuggestions(): Promise<void>;
  resetTargetConfigRoot(targetId: string): Promise<void>;
  setTargetCommandOverride(targetId: string, command?: string): Promise<void>;
  setAgentEnabled(targetId: string, enabled: boolean): Promise<void>;
  setDiscoveredTargets: Dispatch<SetStateAction<TargetInfo[]>>;
  suppressAgentSuggestion(targetId: string): Promise<void>;
}

export const useAgentDiscovery = ({
  appModalOpen,
  isLoading,
  settings,
  supportedTargets,
  updateSettings
}: AgentDiscoveryOptions): AgentDiscoveryController => {
  const [discoveredTargets, setDiscoveredTargets] = useState<TargetInfo[]>([]);
  const [agentProbeComplete, setAgentProbeComplete] = useState(false);
  const [agentSuggestionMode, setAgentSuggestionMode] =
    useState<"automatic" | "manual" | "setup">();
  const [recentlyEnabledAgentIds, setRecentlyEnabledAgentIds] =
    useState<string[]>([]);
  const [sessionDismissedAgentIds, setSessionDismissedAgentIds] =
    useState<string[]>(readDismissedAgentSuggestions);

  const enabledAgentIds = settings.enabledTargetIds ?? [];
  const initialReviewPending =
    settings.agentDiscoveryVersion !== currentAgentDiscoveryVersion;
  const detectedDisabledAgents = useMemo(() => {
    const enabled = new Set(enabledAgentIds);
    return discoveredTargets.filter(
      (target) => isTargetInstalled(target.health) && !enabled.has(target.id)
    );
  }, [discoveredTargets, enabledAgentIds]);
  const automaticAgentSuggestions = useMemo(() => {
    const suppressed = new Set(settings.suppressedAgentSuggestionIds ?? []);
    const reviewed = new Set(settings.agentDiscoveryReviewedIds ?? []);
    const dismissed = new Set(sessionDismissedAgentIds);
    const hasInstalledAgent = discoveredTargets.some((target) =>
      isTargetInstalled(target.health)
    );
    if (initialReviewPending && hasInstalledAgent) {
      return discoveredTargets.filter(
        (target) => !suppressed.has(target.id) && !dismissed.has(target.id)
      );
    }
    return discoveredTargets.filter(
      (target) =>
        isTargetInstalled(target.health) &&
        !reviewed.has(target.id) &&
        !suppressed.has(target.id) &&
        !dismissed.has(target.id)
    );
  }, [
    discoveredTargets,
    initialReviewPending,
    sessionDismissedAgentIds,
    settings.agentDiscoveryReviewedIds,
    settings.suppressedAgentSuggestionIds
  ]);
  const visibleAgentSuggestions = agentSuggestionMode === "setup"
    ? discoveredTargets.filter((target) => recentlyEnabledAgentIds.includes(target.id))
    : agentSuggestionMode === "manual"
      ? detectedDisabledAgents
      : automaticAgentSuggestions;

  useEffect(() => {
    window.sessionStorage.setItem(
      dismissedAgentSuggestionsSessionKey,
      JSON.stringify(sessionDismissedAgentIds)
    );
  }, [sessionDismissedAgentIds]);

  useEffect(() => {
    if (
      !agentProbeComplete ||
      isLoading ||
      appModalOpen ||
      agentSuggestionMode ||
      automaticAgentSuggestions.length === 0
    ) return;
    setAgentSuggestionMode("automatic");
  }, [
    agentProbeComplete,
    agentSuggestionMode,
    appModalOpen,
    automaticAgentSuggestions,
    isLoading
  ]);

  useEffect(() => {
    if (agentSuggestionMode === "automatic" && visibleAgentSuggestions.length === 0) {
      setAgentSuggestionMode(undefined);
    }
  }, [agentSuggestionMode, visibleAgentSuggestions.length]);

  const probeSupportedAgents = async (forceRefresh = false) => {
    try {
      setDiscoveredTargets(await window.agentEnv.probeSupportedTargets(forceRefresh));
    } catch (unknownError) {
      console.warn(
        `[AgentEnv] Supported Agent detection is unavailable: ${
          unknownError instanceof Error ? unknownError.message : String(unknownError)
        }`
      );
    } finally {
      setAgentProbeComplete(true);
    }
  };

  const setAgentEnabled = async (targetId: string, enabled: boolean) => {
    const nextIds = enabled
      ? [...new Set([...enabledAgentIds, targetId])]
      : enabledAgentIds.filter((id) => id !== targetId);
    const suppressed = new Set(settings.suppressedAgentSuggestionIds ?? []);
    if (enabled) suppressed.delete(targetId);
    await updateSettings({
      enabledTargetIds: nextIds,
      agentDiscoveryReviewedIds: [
        ...new Set([...(settings.agentDiscoveryReviewedIds ?? []), targetId])
      ],
      suppressedAgentSuggestionIds: [...suppressed]
    });
  };

  const enableSuggestedAgents = async (agentIds: string[]) => {
    const suppressed = new Set(settings.suppressedAgentSuggestionIds ?? []);
    const visibleIds = visibleAgentSuggestions.map((target) => target.id);
    visibleIds.forEach((id) => suppressed.delete(id));
    const skippedIds = visibleAgentSuggestions
      .map((target) => target.id)
      .filter((id) => !agentIds.includes(id));
    const reviewedIds = visibleAgentSuggestions
      .filter((target) => isTargetInstalled(target.health))
      .map((target) => target.id);
    const visibleSet = new Set(visibleIds);
    const next = await updateSettings({
      enabledTargetIds: [
        ...new Set([
          ...enabledAgentIds.filter((id) => !visibleSet.has(id)),
          ...agentIds
        ])
      ],
      agentDiscoveryVersion: currentAgentDiscoveryVersion,
      agentDiscoveryReviewedIds: initialReviewPending
        ? reviewedIds
        : [...new Set([...(settings.agentDiscoveryReviewedIds ?? []), ...reviewedIds])],
      suppressedAgentSuggestionIds: [...suppressed]
    });
    if (!next) return;
    setSessionDismissedAgentIds((current) => [...new Set([...current, ...skippedIds])]);
    setRecentlyEnabledAgentIds(agentIds);
    setAgentSuggestionMode("setup");
  };

  const suppressAgentSuggestion = async (targetId: string) => {
    const next = await updateSettings({
      agentDiscoveryReviewedIds: [
        ...new Set([...(settings.agentDiscoveryReviewedIds ?? []), targetId])
      ],
      suppressedAgentSuggestionIds: [
        ...new Set([...(settings.suppressedAgentSuggestionIds ?? []), targetId])
      ]
    });
    if (!next) return;
    setSessionDismissedAgentIds((current) => [...new Set([...current, targetId])]);
  };

  const restoreAllAgentSuggestions = async () => {
    const suppressed = new Set(settings.suppressedAgentSuggestionIds ?? []);
    await updateSettings({
      agentDiscoveryReviewedIds: (settings.agentDiscoveryReviewedIds ?? [])
        .filter((id) => !suppressed.has(id)),
      suppressedAgentSuggestionIds: []
    });
  };

  const dismissAgentSuggestions = () => {
    if (agentSuggestionMode !== "setup") {
      setSessionDismissedAgentIds((current) => [
        ...new Set([...current, ...visibleAgentSuggestions.map((target) => target.id)])
      ]);
    }
    setRecentlyEnabledAgentIds([]);
    setAgentSuggestionMode(undefined);
  };

  const chooseTargetConfigRoot = async (targetId: string) => {
    const selected = await window.agentEnv.selectTargetConfigRoot(targetId);
    if (!selected) return;
    await updateSettings({
      targetConfigRoots: { ...(settings.targetConfigRoots ?? {}), [targetId]: selected }
    });
  };

  const resetTargetConfigRoot = async (targetId: string) => {
    const nextRoots = { ...(settings.targetConfigRoots ?? {}) };
    delete nextRoots[targetId];
    await updateSettings({ targetConfigRoots: nextRoots });
  };

  const setTargetCommandOverride = async (targetId: string, command?: string) => {
    const nextOverrides = { ...(settings.targetCommandOverrides ?? {}) };
    if (command?.trim()) nextOverrides[targetId] = command.trim();
    else delete nextOverrides[targetId];
    const next = await updateSettings({ targetCommandOverrides: nextOverrides });
    if (next) await probeSupportedAgents(true);
  };

  return {
    agentProbeComplete,
    allowSuggestionPreferences:
      agentSuggestionMode === "automatic" && !initialReviewPending,
    detectedDisabledAgents,
    dialogPhase: agentSuggestionMode === "setup" ? "setup" : "choose",
    dialogOpen: Boolean(agentSuggestionMode),
    discoveredTargets,
    enabledAgentIds,
    visibleAgentSuggestions,
    chooseTargetConfigRoot,
    dismissAgentSuggestions,
    enableSuggestedAgents,
    openAgentChooser: () => {
      setRecentlyEnabledAgentIds([]);
      setAgentSuggestionMode("manual");
    },
    probeSupportedAgents,
    restoreAllAgentSuggestions,
    resetTargetConfigRoot,
    setTargetCommandOverride,
    setAgentEnabled,
    setDiscoveredTargets,
    suppressAgentSuggestion
  };
};
