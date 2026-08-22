import { useCallback, useState } from "react";

const firstId = <Id extends string>(ids: Iterable<Id>) => ids[Symbol.iterator]().next().value;

export const useExclusiveDisclosure = <Id extends string>(initialIds: Iterable<Id> = []) => {
  const [expandedId, setExpandedId] = useState<Id | undefined>(() => firstId(initialIds));

  const isExpanded = useCallback((id: Id) => expandedId === id, [expandedId]);
  const toggleExpandedId = useCallback((id: Id) => {
    setExpandedId((current) => current === id ? undefined : id);
  }, []);
  const expandId = useCallback((id: Id) => setExpandedId(id), []);
  const replaceExpandedIds = useCallback((ids: Iterable<Id>) => {
    setExpandedId(firstId(ids));
  }, []);
  const clearExpandedIds = useCallback(() => setExpandedId(undefined), []);

  return {
    clearExpandedIds,
    expandId,
    isExpanded,
    replaceExpandedIds,
    toggleExpandedId
  };
};
