import type { AIRequestPhase, AIRequestProgress } from "../../shared/aiReliability";

export function createAIProgress(requestId: string, notify?: (event: AIRequestProgress) => void) {
  return (phase: AIRequestPhase) => {
    try { notify?.({ requestId, phase }); }
    catch { /* A closed observer must not discard an already billed result. */ }
  };
}
