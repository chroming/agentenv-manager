import { createContext, useContext, type ReactNode } from "react";

export type ControlDensity = "compact" | "default";

const ControlDensityContext = createContext<ControlDensity | undefined>(undefined);

export const ControlDensityProvider = ({
  children,
  density
}: {
  children: ReactNode;
  density: ControlDensity;
}) => (
  <ControlDensityContext.Provider value={density}>
    {children}
  </ControlDensityContext.Provider>
);

export const useControlDensity = () => useContext(ControlDensityContext);
