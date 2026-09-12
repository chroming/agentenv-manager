import type { ReactNode } from "react";

/** Selectable, wrapping metadata for on-demand object details. */
export const DetailList = ({ items }: {
  items: Array<{ label: string; value: ReactNode }>;
}) => (
  <dl className="ui-detail-list">
    {items.map(({ label, value }) => (
      <div key={label}>
        <dt>{label}</dt>
        <dd className="selectable">{value}</dd>
      </div>
    ))}
  </dl>
);
