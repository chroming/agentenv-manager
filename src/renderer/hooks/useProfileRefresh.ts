import { useRef, useState } from "react";
import type { ProfileDetail, ProfileSummary } from "../../shared/types";

export const useProfileRefresh = (options: {
  disabled: boolean;
  selectedId?: string;
  beginFlow(): number;
  isFlowCurrent(id: number): boolean;
  refresh(): Promise<{ profileItems: ProfileSummary[]; enrich?(): void }>;
  read(id: string): Promise<ProfileDetail>;
  accept(profile: ProfileDetail): void;
  clear(): void;
  invalidate(): void;
  onError(message: string | undefined): void;
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef(false);
  const refresh = async () => {
    if (options.disabled || running.current) return;
    running.current = true;
    setRefreshing(true);
    options.onError(undefined);
    const flow = options.beginFlow();
    let enrich: (() => void) | undefined;
    try {
      const result = await options.refresh();
      const { profileItems } = result;
      enrich = result.enrich;
      if (!options.isFlowCurrent(flow)) return;
      const selected = profileItems.find((item) => item.id === options.selectedId)
        ?? profileItems.find((item) => !item.loadError);
      if (!selected) {
        options.clear();
        options.invalidate();
        return;
      }
      if (selected.loadError) throw new Error(selected.loadError);
      const profile = await options.read(selected.id);
      // Edits and selection changes invalidate the request; never replace a newer draft.
      if (!options.isFlowCurrent(flow)) return;
      options.accept(profile);
      options.invalidate();
    } catch (error) {
      if (options.isFlowCurrent(flow)) {
        options.onError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      running.current = false;
      setRefreshing(false);
      enrich?.();
    }
  };
  return { refreshing, refresh };
};
