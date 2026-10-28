import { useEffect, useState, type RefObject } from "react";
import type { AIRequestProgress } from "../../shared/aiReliability";
import { useI18n } from "../i18n";

const labels = { preparing: "Preparing analysis", waiting: "Waiting for AI service", receiving: "Receiving AI response", parsing: "Checking AI response", saving: "Saving result" } as const;
export function useAIRequestProgress(requestId: RefObject<string>) {
  const [progress, setProgress] = useState<AIRequestProgress>();
  const { t } = useI18n();
  useEffect(() => window.agentEnv?.onAIRequestProgress?.((value) => {
    if (value.requestId === requestId.current) setProgress(value);
  }), [requestId]);
  return progress && progress.requestId === requestId.current ? t(labels[progress.phase]) : undefined;
}
