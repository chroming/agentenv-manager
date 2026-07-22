import { useMemo, useReducer } from "react";
import type { GitHubSkillCandidate } from "../../shared/types";

export interface RepositoryImportDraftState {
  knownSources: string[];
  readySources: string[];
  deselectedSources: string[];
  candidateIds: Record<string, string>;
}

type RepositoryImportDraftAction =
  | { type: "reconcile"; candidates: GitHubSkillCandidate[] }
  | { type: "select-all"; selected: boolean }
  | { type: "select-source"; sourceUrl: string; selected: boolean }
  | { type: "set-id"; sourceUrl: string; id: string }
  | { type: "reset" };

export const emptyRepositoryImportDraft = (): RepositoryImportDraftState => ({
  knownSources: [],
  readySources: [],
  deselectedSources: [],
  candidateIds: {}
});

export const repositoryImportDraftReducer = (
  state: RepositoryImportDraftState,
  action: RepositoryImportDraftAction
): RepositoryImportDraftState => {
  if (action.type === "reset") {
    return emptyRepositoryImportDraft();
  }

  if (action.type === "reconcile") {
    const previousSources = new Set(state.knownSources);
    const nextSources = action.candidates.map((candidate) => candidate.sourceUrl);
    const nextSourceSet = new Set(nextSources);
    return {
      knownSources: nextSources,
      readySources: action.candidates
        .filter((candidate) => candidate.status === "ready")
        .map((candidate) => candidate.sourceUrl),
      deselectedSources: state.deselectedSources.filter((sourceUrl) => nextSourceSet.has(sourceUrl)),
      candidateIds: Object.fromEntries(
        action.candidates.map((candidate) => [
          candidate.sourceUrl,
          previousSources.has(candidate.sourceUrl)
            ? state.candidateIds[candidate.sourceUrl] ?? candidate.id
            : candidate.id
        ])
      )
    };
  }

  if (action.type === "select-all") {
    const readySources = new Set(state.readySources);
    return {
      ...state,
      deselectedSources: action.selected
        ? state.deselectedSources.filter((sourceUrl) => !readySources.has(sourceUrl))
        : [...new Set([...state.deselectedSources, ...state.readySources])]
    };
  }

  if (action.type === "select-source") {
    return {
      ...state,
      deselectedSources: action.selected
        ? state.deselectedSources.filter((sourceUrl) => sourceUrl !== action.sourceUrl)
        : [...new Set([...state.deselectedSources, action.sourceUrl])]
    };
  }

  return {
    ...state,
    candidateIds: {
      ...state.candidateIds,
      [action.sourceUrl]: action.id
    }
  };
};

export const useRepositoryImportDraft = () => {
  const [state, dispatch] = useReducer(
    repositoryImportDraftReducer,
    undefined,
    emptyRepositoryImportDraft
  );
  const selectedSources = useMemo(() => {
    const deselectedSources = new Set(state.deselectedSources);
    return state.readySources.filter((sourceUrl) => !deselectedSources.has(sourceUrl));
  }, [state.deselectedSources, state.readySources]);

  return {
    selectedSources,
    candidateIds: state.candidateIds,
    reconcileCandidates: (candidates: GitHubSkillCandidate[]) =>
      dispatch({ type: "reconcile", candidates }),
    selectAll: (selected: boolean) => dispatch({ type: "select-all", selected }),
    selectSource: (sourceUrl: string, selected: boolean) =>
      dispatch({ type: "select-source", sourceUrl, selected }),
    setCandidateId: (sourceUrl: string, id: string) =>
      dispatch({ type: "set-id", sourceUrl, id }),
    reset: () => dispatch({ type: "reset" })
  };
};
