import { useCallback, useState } from "react";
import type {
  CreateSkillGroupInput,
  SkillGroup,
  UpdateSkillGroupInput
} from "../../shared/types";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const sortGroups = (groups: SkillGroup[]) => [...groups]
  .sort((left, right) => left.name.localeCompare(right.name));

export const useSkillGroups = (onError: (message: string) => void) => {
  const [groups, setGroups] = useState<SkillGroup[]>([]);

  const load = useCallback(async (shouldApply: () => boolean = () => true) => {
    const loaded = await window.agentEnv.listSkillGroups();
    if (shouldApply()) setGroups(sortGroups(loaded));
    return loaded;
  }, []);

  const create = useCallback(async (input: CreateSkillGroupInput) => {
    try {
      const group = await window.agentEnv.createSkillGroup(input);
      setGroups((current) => sortGroups([...current, group]));
      return true;
    } catch (error) {
      onError(errorMessage(error));
      return false;
    }
  }, [onError]);

  const update = useCallback(async (input: UpdateSkillGroupInput) => {
    try {
      const group = await window.agentEnv.updateSkillGroup(input);
      setGroups((current) => sortGroups(
        current.map((candidate) => candidate.id === group.id ? group : candidate)
      ));
      return true;
    } catch (error) {
      onError(errorMessage(error));
      return false;
    }
  }, [onError]);

  const remove = useCallback(async (id: string) => {
    try {
      await window.agentEnv.removeSkillGroup(id);
      setGroups((current) => current.filter((group) => group.id !== id));
      return true;
    } catch (error) {
      onError(errorMessage(error));
      return false;
    }
  }, [onError]);

  return { groups, load, create, update, remove };
};
