import { z } from "zod";
import { SafeIdSchema } from "./schemas";

const uniqueIds = (ids: string[]) => [...new Set(ids)];

export const UiStateSchema = z.object({
  version: z.literal(1),
  selectedProfileId: SafeIdSchema.optional(),
  selectedWorkspaceId: SafeIdSchema.optional(),
  profileOrder: z.array(SafeIdSchema).default([]),
  agentOrder: z.array(SafeIdSchema).default([]),
  workspaceOrder: z.array(SafeIdSchema).default([]),
  workspaceAgentSelections: z.record(SafeIdSchema, SafeIdSchema).default({})
}).strict();

export const UiStateUpdateSchema = UiStateSchema.omit({ version: true }).partial().strict();

export type UiState = z.infer<typeof UiStateSchema>;
export type UiStateUpdate = z.infer<typeof UiStateUpdateSchema>;

export const defaultUiState = (): UiState => ({
  version: 1,
  profileOrder: [],
  agentOrder: [],
  workspaceOrder: [],
  workspaceAgentSelections: {}
});

export const normalizeUiState = (state: UiState): UiState => ({
  ...state,
  profileOrder: uniqueIds(state.profileOrder),
  agentOrder: uniqueIds(state.agentOrder),
  workspaceOrder: uniqueIds(state.workspaceOrder)
});

export const orderByPreference = <T>(
  items: readonly T[],
  preference: readonly string[],
  idFor: (item: T) => string
): T[] => {
  const rank = new Map(preference.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(idFor(item)) }))
    .sort((left, right) => {
      if (left.rank !== undefined && right.rank !== undefined) return left.rank - right.rank;
      if (left.rank !== undefined) return -1;
      if (right.rank !== undefined) return 1;
      return left.index - right.index;
    })
    .map(({ item }) => item);
};

export const completeOrder = (
  preference: readonly string[],
  availableIds: readonly string[]
): string[] => {
  const available = new Set(availableIds);
  return uniqueIds([
    ...preference.filter((id) => available.has(id)),
    ...availableIds
  ]);
};

export const reorderPreferenceByDrop = (
  ids: readonly string[],
  draggedId: string,
  targetId: string
): string[] => {
  if (draggedId === targetId) return [...ids];
  const draggedIndex = ids.indexOf(draggedId);
  const targetIndex = ids.indexOf(targetId);
  if (draggedIndex < 0 || targetIndex < 0) return [...ids];
  const next = ids.filter((id) => id !== draggedId);
  const nextTargetIndex = next.indexOf(targetId);
  next.splice(nextTargetIndex + (targetIndex > draggedIndex ? 1 : 0), 0, draggedId);
  return next;
};

export const reorderPreferenceByOffset = (
  ids: readonly string[],
  id: string,
  offset: -1 | 1
): string[] => {
  const index = ids.indexOf(id);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
};
