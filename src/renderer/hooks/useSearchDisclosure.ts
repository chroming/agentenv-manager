import { useEffect, useState } from "react";

// Search expansion is transient: clearing the query restores the user's layout.
export function useSearchDisclosure(query: string) {
  const key = query.trim().toLocaleLowerCase();
  const [overrides, setOverrides] = useState<{ key: string; collapsed: string[] }>({ key: "", collapsed: [] });
  useEffect(() => { setOverrides({ key, collapsed: [] }); }, [key]);
  const collapsed = overrides.key === key ? overrides.collapsed : [];
  return {
    expanded: (id: string, normal: boolean) => key ? !collapsed.includes(id) : normal,
    toggle: (id: string, normalToggle: () => void) => {
      if (!key) { normalToggle(); return; }
      setOverrides({ key, collapsed: collapsed.includes(id) ? collapsed.filter((value) => value !== id) : [...collapsed, id] });
    }
  };
}
