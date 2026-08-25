import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  BookOpen,
  Bot,
  Boxes,
  Braces,
  Bug,
  ChartNoAxesCombined,
  Cloud,
  Code2,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  Folder,
  GitBranch,
  Globe2,
  KeyRound,
  Layers3,
  Lightbulb,
  LockKeyhole,
  MessageSquare,
  Package,
  Palette,
  PenLine,
  PlugZap,
  Rocket,
  SearchCheck,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TestTube2,
  WandSparkles,
  Workflow,
  Wrench,
  type LucideIcon
} from "lucide-react";
import type { ResourceIconKey } from "../../shared/types";
import { useI18n } from "../i18n";
import {
  agentIconUrlFor,
  supportedAgentIconOptions
} from "./ProfileSidebar";
import { focusInitialActionMenuItem, handleActionMenuKeyDown } from "./ui";

interface IconOption {
  key: ResourceIconKey;
  label: string;
  icon: LucideIcon;
}

const iconGroups: Array<{ label: string; options: IconOption[] }> = [
  {
    label: "Agents",
    options: supportedAgentIconOptions.map(({ key, label }) => ({
      key,
      label,
      icon: Bot
    }))
  },
  {
    label: "Development",
    options: [
      { key: "code", label: "Code", icon: Code2 },
      { key: "terminal", label: "Terminal", icon: TerminalSquare },
      { key: "braces", label: "Syntax", icon: Braces },
      { key: "bug", label: "Debugging", icon: Bug },
      { key: "test", label: "Testing", icon: TestTube2 },
      { key: "search", label: "Code review", icon: SearchCheck },
      { key: "database", label: "Database", icon: Database },
      { key: "server", label: "Server", icon: Server },
      { key: "cloud", label: "Cloud", icon: Cloud },
      { key: "cpu", label: "Compute", icon: Cpu },
      { key: "package", label: "Package", icon: Package },
      { key: "github", label: "Repository", icon: GitBranch }
    ]
  },
  {
    label: "Workflow",
    options: [
      { key: "workflow", label: "Automation", icon: Workflow },
      { key: "rocket", label: "Rocket", icon: Rocket },
      { key: "plug", label: "Integration", icon: PlugZap },
      { key: "settings", label: "Configuration", icon: Settings2 },
      { key: "wrench", label: "Tools", icon: Wrench },
      { key: "layers", label: "Layers", icon: Layers3 },
      { key: "boxes", label: "Components", icon: Boxes },
      { key: "chart", label: "Analytics", icon: ChartNoAxesCombined }
    ]
  },
  {
    label: "Content",
    options: [
      { key: "file", label: "Document", icon: FileText },
      { key: "book", label: "Documentation", icon: BookOpen },
      { key: "pen", label: "Writing", icon: PenLine },
      { key: "palette", label: "Design", icon: Palette },
      { key: "message", label: "Communication", icon: MessageSquare },
      { key: "globe", label: "Web", icon: Globe2 }
    ]
  },
  {
    label: "General",
    options: [
      { key: "folder", label: "Folder", icon: Folder },
      { key: "bot", label: "Assistant", icon: Bot },
      { key: "shield", label: "Shield", icon: ShieldCheck },
      { key: "lock", label: "Security", icon: LockKeyhole },
      { key: "key", label: "Credentials", icon: KeyRound },
      { key: "flask", label: "Experiment", icon: FlaskConical },
      { key: "lightbulb", label: "Idea", icon: Lightbulb },
      { key: "wand", label: "Magic", icon: WandSparkles },
      { key: "sparkles", label: "Sparkles", icon: Sparkles }
    ]
  }
];

const iconOptions = iconGroups.flatMap((group) => group.options);
const iconByKey = new Map(iconOptions.map((option) => [option.key, option.icon]));
const iconMenuWidth = 224;
const iconMenuHeight = 425;

export const faviconUrlFor = (sourceUrl?: string) => {
  const value = sourceUrl?.trim();
  if (!value) return undefined;
  try {
    const host = value.match(/^[^@\s]+@([^:\s]+):/)?.[1] ?? new URL(value).hostname;
    return host ? `https://${host.toLowerCase()}/favicon.ico` : undefined;
  } catch {
    return undefined;
  }
};

export const ResourceIcon = ({
  iconKey,
  size = 18
}: {
  iconKey: ResourceIconKey;
  size?: number;
}) => {
  const agentIconUrl = agentIconUrlFor(iconKey);
  if (agentIconUrl) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className="resource-agent-icon"
        height={size}
        src={agentIconUrl}
        width={size}
      />
    );
  }
  const Icon = iconByKey.get(iconKey) ?? Folder;
  return <Icon size={size} strokeWidth={2.1} aria-hidden="true" />;
};

export const ResourceIconArtwork = ({
  iconKey,
  sourceUrl,
  fallbackIconKey = "folder",
  size = 18
}: {
  iconKey?: ResourceIconKey;
  sourceUrl?: string;
  fallbackIconKey?: ResourceIconKey;
  size?: number;
}) => {
  const faviconUrl = iconKey ? undefined : faviconUrlFor(sourceUrl);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => setFaviconFailed(false), [faviconUrl]);

  if (faviconUrl && !faviconFailed) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className="resource-favicon"
        height={size}
        src={faviconUrl}
        width={size}
        onError={() => setFaviconFailed(true)}
      />
    );
  }
  return <ResourceIcon iconKey={iconKey ?? fallbackIconKey} size={size} />;
};

export const ResourceIconPicker = ({
  iconKey,
  label,
  onChange,
  sourceUrl,
  fallbackIconKey = "folder",
  showAgentIcons = false,
  triggerLabel,
  className = ""
}: {
  iconKey?: ResourceIconKey;
  label: string;
  onChange: (iconKey: ResourceIconKey | undefined) => void;
  sourceUrl?: string;
  fallbackIconKey?: ResourceIconKey;
  showAgentIcons?: boolean;
  triggerLabel?: string;
  className?: string;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [insideModal, setInsideModal] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const faviconUrl = faviconUrlFor(sourceUrl);
  const selectedKey = !iconKey && faviconUrl ? "source" : iconKey ?? fallbackIconKey;

  useEffect(() => {
    if (!open) return undefined;
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
        event.stopImmediatePropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", closeOnEscape, true);
    window.setTimeout(() => focusInitialActionMenuItem(
      menuRef.current,
      `[data-icon-key="${selectedKey}"]`
    ));
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open, selectedKey]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setInsideModal(Boolean(triggerRef.current?.closest(".ui-modal-backdrop")));
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - iconMenuWidth - 12)),
        top:
          rect.bottom + iconMenuHeight + 8 <= window.innerHeight
            ? rect.bottom + 6
            : Math.max(12, rect.top - iconMenuHeight - 6)
      });
    }
    setOpen(true);
  };

  const choose = (nextIconKey?: ResourceIconKey) => {
    onChange(nextIconKey);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        className={`resource-icon-trigger ${className}`.trim()}
        data-icon={selectedKey}
        type="button"
        aria-label={triggerLabel ?? t("Change icon for {{name}}", { name: label })}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t("Change icon for {{name}}", { name: label })}
        onClick={toggle}
      >
        <ResourceIconArtwork
          fallbackIconKey={fallbackIconKey}
          iconKey={iconKey}
          sourceUrl={sourceUrl}
        />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={`resource-icon-menu${insideModal ? " resource-icon-menu--modal" : ""}`}
              role="menu"
              aria-label={t("Icons for {{name}}", { name: label })}
              style={position}
              onKeyDown={handleActionMenuKeyDown}
            >
              {faviconUrl ? (
                <div className="resource-icon-group resource-icon-group--source">
                  <span>{t("Source")}</span>
                  <button
                    className="resource-icon-option resource-icon-option--source"
                    data-icon="source"
                    data-icon-key="source"
                    type="button"
                    role="menuitemradio"
                    aria-checked={!iconKey}
                    aria-label={t("Use source icon")}
                    title={t("Use source icon")}
                    onClick={() => choose(undefined)}
                  >
                    <ResourceIconArtwork sourceUrl={sourceUrl} fallbackIconKey={fallbackIconKey} size={17} />
                    <strong>{t("Use source icon")}</strong>
                  </button>
                </div>
              ) : null}
              {iconGroups
                .filter((group) => showAgentIcons || group.label !== "Agents")
                .map((group) => (
                  <div className="resource-icon-group" key={group.label}>
                    <span>{t(group.label)}</span>
                    <div className="resource-icon-grid">
                      {group.options.map((option) => (
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
                          onClick={() => choose(option.key)}
                        >
                          <ResourceIcon iconKey={option.key} size={17} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
};
