import {
  BookOpen,
  FileText,
  Layers3,
  MessagesSquare,
  Monitor,
  Plug,
  Settings,
  type LucideIcon
} from "lucide-react";
import type { ResourceIconKey } from "../shared/types";

export type ProductIconName =
  | "agents"
  | "profiles"
  | "conversations"
  | "skills"
  | "instructions"
  | "mcps"
  | "settings";

export const productIconComponents: Record<ProductIconName, LucideIcon> = {
  agents: Monitor,
  profiles: Layers3,
  conversations: MessagesSquare,
  skills: BookOpen,
  instructions: FileText,
  mcps: Plug,
  settings: Settings
};

export const defaultProfileIconKey: ResourceIconKey = "layers";

export const ProductIcon = ({
  name,
  size = 16,
  strokeWidth = 2.2
}: {
  name: ProductIconName;
  size?: number;
  strokeWidth?: number;
}) => {
  const Icon = productIconComponents[name];
  return (
    <Icon
      data-product-icon={name}
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
    />
  );
};
