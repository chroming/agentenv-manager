export type DesktopContextMenuItem =
  | {
      id: string;
      label: string;
      enabled?: boolean;
    }
  | {
      type: "separator";
    };

const menuItemIdPattern = /^[a-z0-9][a-z0-9:_-]{0,63}$/i;

export const parseDesktopContextMenuItems = (
  value: unknown
): DesktopContextMenuItem[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error("Invalid desktop context menu");
  }

  const seenIds = new Set<string>();
  let actionCount = 0;
  const items = value.map((entry): DesktopContextMenuItem => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid desktop context menu item");
    }
    const item = entry as Record<string, unknown>;
    if (item.type === "separator") {
      return { type: "separator" };
    }
    if (
      typeof item.id !== "string" ||
      !menuItemIdPattern.test(item.id) ||
      seenIds.has(item.id) ||
      typeof item.label !== "string"
    ) {
      throw new Error("Invalid desktop context menu action");
    }
    const label = item.label.trim();
    if (!label || label.length > 120) {
      throw new Error("Invalid desktop context menu label");
    }
    seenIds.add(item.id);
    actionCount += 1;
    return {
      id: item.id,
      label,
      enabled: item.enabled !== false
    };
  });

  if (actionCount === 0) {
    throw new Error("Desktop context menu requires an action");
  }
  return items;
};
