import type { ReactNode } from "react";
import { ResourcePanelToolbar } from "./ui";

export const AIReviewHeading = ({ title, actions }: { title: ReactNode; actions?: ReactNode }) =>
  <ResourcePanelToolbar variant="flush">
    <span className="resource-heading skill-summary-heading">{title}</span>
    {actions}
  </ResourcePanelToolbar>;
