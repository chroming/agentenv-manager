import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export interface AIReviewFinding {
  title?: string;
  detail: string;
  suggestion?: string;
  risk: boolean;
  note?: ReactNode;
}

export const splitAIReviewFindings = <T extends { risk: boolean }>(items: T[]) => {
  let ordinary = 0;
  const visible: T[] = [];
  const remaining: T[] = [];
  for (const item of items) {
    if (item.risk || ordinary++ < 3) visible.push(item);
    else remaining.push(item);
  }
  return { visible, remaining };
};

export const AIReviewFindings = ({ items }: { items: AIReviewFinding[] }) => (
  <ul className="ai-review-findings">
    {items.map((item, index) => <li key={index} className={item.risk ? "ai-review-finding is-risk" : "ai-review-finding"}>
      <span className="ai-review-finding__marker" aria-hidden="true">{item.risk ? <TriangleAlert size={14} /> : "•"}</span>
      <div className="ai-review-finding__copy">
        {item.title && item.title !== item.detail ? <h4>{item.title}</h4> : null}
        <p>{item.detail}</p>
        {item.suggestion && item.suggestion !== item.detail ? <p className="muted">{item.suggestion}</p> : null}
        {item.note}
      </div>
    </li>)}
  </ul>
);
