import { useEffect, useState } from "react";
import type { SkillCollectionLinkGroup } from "../../shared/skillCleanup";

export const useSkillCollectionSelection = (
  groups: SkillCollectionLinkGroup[],
  requestedPath: string | undefined,
  acceptRequest: boolean,
  onRequestHandled: (() => void) | undefined
) => {
  const [selectedPath, setSelectedPath] = useState<string>();
  const selected = selectedPath
    ? groups.find((group) => group.path === selectedPath)
    : undefined;

  useEffect(() => {
    if (!requestedPath || !acceptRequest) return;
    const requested = groups.find((group) => group.path === requestedPath);
    if (!requested) return;
    setSelectedPath(requested.path);
    onRequestHandled?.();
  }, [acceptRequest, groups, onRequestHandled, requestedPath]);

  return [selectedPath, setSelectedPath, selected] as const;
};
