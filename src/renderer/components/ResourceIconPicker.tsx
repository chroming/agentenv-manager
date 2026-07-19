import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Code2,
  Database,
  FlaskConical,
  Folder,
  GitBranch,
  PenLine,
  Rocket,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  type LucideIcon
} from "lucide-react";
import type { ResourceIconKey } from "../../shared/types";
import { useI18n } from "../i18n";

const iconOptions: Array<{ key: ResourceIconKey; label: string; icon: LucideIcon }> = [
  { key: "github", label: "Repository", icon: GitBranch },
  { key: "folder", label: "Folder", icon: Folder },
  { key: "code", label: "Code", icon: Code2 },
  { key: "rocket", label: "Rocket", icon: Rocket },
  { key: "shield", label: "Shield", icon: ShieldCheck },
  { key: "flask", label: "Experiment", icon: FlaskConical },
  { key: "pen", label: "Writing", icon: PenLine },
  { key: "terminal", label: "Terminal", icon: TerminalSquare },
  { key: "database", label: "Database", icon: Database },
  { key: "sparkles", label: "Sparkles", icon: Sparkles }
];

const iconByKey = new Map(iconOptions.map((option) => [option.key, option.icon]));

export const ResourceIcon = ({
  iconKey,
  size = 18
}: {
  iconKey: ResourceIconKey;
  size?: number;
}) => {
  const Icon = iconByKey.get(iconKey) ?? Folder;
  return <Icon size={size} strokeWidth={2.15} aria-hidden="true" />;
};

export const ResourceIconPicker = ({
  iconKey,
  label,
  onChange,
  triggerLabel,
  className = ""
}: {
  iconKey: ResourceIconKey;
  label: string;
  onChange: (iconKey: ResourceIconKey) => void;
  triggerLabel?: string;
  className?: string;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(`[data-icon-key="${iconKey}"]`)
        ?.focus();
    });
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [iconKey, open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 214;
      const menuHeight = 104;
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12)),
        top:
          rect.bottom + menuHeight + 8 <= window.innerHeight
            ? rect.bottom + 6
            : Math.max(12, rect.top - menuHeight - 6)
      });
    }
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        className={`resource-icon-trigger ${className}`.trim()}
        data-icon={iconKey}
        type="button"
        aria-label={triggerLabel ?? t("Change icon for {{name}}", { name: label })}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t("Change icon for {{name}}", { name: label })}
        onClick={toggle}
      >
        <ResourceIcon iconKey={iconKey} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="resource-icon-menu"
              role="menu"
              aria-label={t("Icons for {{name}}", { name: label })}
              style={position}
            >
              {iconOptions.map((option) => (
                <button
                  className="resource-icon-option"
                  data-icon={option.key}
                  data-icon-key={option.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.key === iconKey}
                  aria-label={t(option.label)}
                  title={t(option.label)}
                  key={option.key}
                  onClick={() => {
                    onChange(option.key);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <ResourceIcon iconKey={option.key} size={17} />
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
};
