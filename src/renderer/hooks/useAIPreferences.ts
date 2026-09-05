import { useEffect, useState } from "react";
import { type AIFeature, type AIPreferences } from "../../shared/aiAssistance";

export const useAIPreferences = () => {
  const [preferences, setPreferences] = useState<AIPreferences>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = window.agentEnv?.onAIPreferencesChanged?.((value) => { changed = true; if (active) setPreferences(value); });
    void window.agentEnv?.readAIPreferences?.().then((value) => { if (active && !changed) setPreferences(value); })
      .catch(() => { if (active) setError("AI settings could not be read. No AI request was sent."); });
    return () => { active = false; unsubscribe?.(); };
  }, []);
  return { preferences, setPreferences, error, enabled: (feature: AIFeature) => Boolean(preferences?.enabled && preferences.features[feature]) };
};
