import type { HTMLAttributes } from "react";

export type AlignedResourceListActionTrack = "compact" | "standard";

interface AlignedResourceListProps extends HTMLAttributes<HTMLDivElement> {
  actionTrack?: AlignedResourceListActionTrack;
}

export const AlignedResourceList = ({
  actionTrack = "standard",
  className = "",
  ...props
}: AlignedResourceListProps) => (
  <div
    {...props}
    className={`ui-resource-children ui-aligned-resource-list ui-aligned-resource-list--${actionTrack}-actions ${className}`.trim()}
  />
);
