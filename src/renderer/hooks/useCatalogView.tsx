import { createContext, useContext, useState, type ReactNode } from "react";
import type { UiState, UiStateUpdate } from "../../shared/uiState";
import type { CatalogView, CatalogViews } from "../../shared/catalogViews";

const CatalogContext = createContext<{
  views: CatalogViews;
  onUpdate(update: UiStateUpdate): void;
} | undefined>(undefined);

export const CatalogPreferencesProvider = ({ uiState, onUpdateUiState, children }: {
  uiState: UiState;
  onUpdateUiState(update: UiStateUpdate): void;
  children: ReactNode;
}) => <CatalogContext.Provider value={{ views: uiState.catalogViews ?? {}, onUpdate: onUpdateUiState }}>
  {children}
</CatalogContext.Provider>;

export const useCatalogView = <K extends keyof CatalogViews>(key: K, defaults: Required<CatalogView<K>>) => {
  const context = useContext(CatalogContext);
  const [local, setLocal] = useState<CatalogView<K>>({});
  const view = { ...defaults, ...(context ? context.views[key] : local) } as Required<CatalogView<K>>;
  const update = (patch: CatalogView<K>) => {
    if (context) context.onUpdate({ catalogViews: { [key]: patch } });
    else setLocal((current) => ({ ...current, ...patch }));
  };
  return [view, update, Boolean(context)] as const;
};
