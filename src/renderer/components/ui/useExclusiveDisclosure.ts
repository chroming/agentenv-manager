import { useCallback, useState } from "react";

export const useExclusiveDisclosure = <Id extends string>(initialId?: Id) => {
  const [expandedId, setExpandedId] = useState<Id | undefined>(initialId);
  const toggleExpandedId = useCallback((id: Id) => {
    setExpandedId((current) => current === id ? undefined : id);
  }, []);

  return {
    expandedId,
    setExpandedId,
    toggleExpandedId
  };
};
