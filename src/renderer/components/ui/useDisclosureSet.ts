import { useCallback, useState } from "react";

export const useDisclosureSet = <Id extends string>(initialIds: Iterable<Id> = []) => {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<Id>>(
    () => new Set(initialIds)
  );

  const isExpanded = useCallback((id: Id) => expandedIds.has(id), [expandedIds]);
  const toggleExpandedId = useCallback((id: Id) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const expandId = useCallback((id: Id) => {
    setExpandedIds((current) => current.has(id) ? current : new Set(current).add(id));
  }, []);
  const replaceExpandedIds = useCallback((ids: Iterable<Id>) => {
    setExpandedIds(new Set(ids));
  }, []);
  const clearExpandedIds = useCallback(() => setExpandedIds(new Set()), []);

  return {
    clearExpandedIds,
    expandId,
    isExpanded,
    replaceExpandedIds,
    toggleExpandedId
  };
};
