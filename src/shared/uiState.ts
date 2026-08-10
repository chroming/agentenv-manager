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
