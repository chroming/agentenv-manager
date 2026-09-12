import type { ReactNode } from "react";

/** Selectable, wrapping metadata for on-demand object details. */
export const DetailList = ({ items }: {
  items: Array<{ label: string; value: ReactNode; action?: ReactNode }>;
}) => (
  <dl className="ui-detail-list">
    {items.map(({ label, value, action }) => (
      <div key={label}>
        <dt>{label}</dt>
        <dd className={`selectable${action ? " ui-detail-list__action-value" : ""}`}>
          {action ? <><span>{value}</span>{action}</> : value}
        </dd>
      </div>
    ))}
  </dl>
);
