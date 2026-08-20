import { RefreshCw, ScanLine } from "lucide-react";
import type {
  ConversationSummary,
  ProfileSummary,
  SkillLibraryEntry,
  TargetInfo
} from "../shared/types";
import { targetIconFor, type AppWorkspace } from "./components/ProfileSidebar";
import type { QuickOpenItem } from "./components/QuickOpen";
import type { TranslationValues } from "./i18n";
import { ProductIcon } from "./productIcons";

interface QuickOpenItemOptions {
  profiles: ProfileSummary[];
  skills: SkillLibraryEntry[];
  targets: TargetInfo[];
  t(message: string, values?: TranslationValues): string;
  onOpenWorkspace(workspace: AppWorkspace): void;
  onOpenProfile(id: string): void;
  onOpenSkill(skill: SkillLibraryEntry): void;
  onOpenTarget(id: string): void;
  onOpenLocalSkills(): void | Promise<void>;
  onRefreshSkills(): void | Promise<void>;
  onRefreshTargets(): void | Promise<void>;
}

interface ConversationQuickOpenItemOptions {
  conversations: ConversationSummary[];
  query: string;
  targets: TargetInfo[];
  t(message: string, values?: TranslationValues): string;
  formatDate(value: string | number | Date): string;
  onOpenConversation(summary: ConversationSummary, query: string): void;
}

const compactText = (value?: string) =>
  value?.replace(/\s+/g, " ").trim();

const leafPathName = (value?: string) =>
  value?.split(/[\\/]/).filter(Boolean).at(-1);

export const buildQuickOpenItems = ({
  profiles,
  skills,
  targets,
  t,
  onOpenWorkspace,
  onOpenProfile,
  onOpenSkill,
  onOpenTarget,
  onOpenLocalSkills,
  onRefreshSkills,
  onRefreshTargets
}: QuickOpenItemOptions): QuickOpenItem[] => [
  {
    id: "workspace:targets",
    group: t("Pages"),
    label: t("Agents"),
    description: t("Local agent tools"),
    icon: <ProductIcon name="agents" />,
    onSelect: () => onOpenWorkspace("targets")
  },
  {
    id: "workspace:profiles",
    group: t("Pages"),
    label: t("Profiles"),
    description: t("Compose reusable Agent setups"),
    icon: <ProductIcon name="profiles" />,
    onSelect: () => onOpenWorkspace("profiles")
  },
  {
    id: "workspace:projects",
    group: t("Pages"),
    label: t("Workspaces"),
    description: t("Recurring project folders"),
    icon: <ProductIcon name="projects" />,
    onSelect: () => onOpenWorkspace("projects")
  },
  {
    id: "workspace:conversations",
    group: t("Pages"),
    label: t("Conversations"),
    description: t("Continue across Agents"),
    icon: <ProductIcon name="conversations" />,
    onSelect: () => onOpenWorkspace("conversations")
  },
  {
    id: "workspace:skills",
    group: t("Pages"),
    label: t("Skills"),
    description: t("Skill library"),
    icon: <ProductIcon name="skills" />,
    onSelect: () => onOpenWorkspace("library")
  },
  {
    id: "workspace:instructions",
    group: t("Pages"),
    label: t("Instructions"),
    description: t("Reusable instruction blocks"),
    icon: <ProductIcon name="instructions" />,
    onSelect: () => onOpenWorkspace("instructions")
  },
  {
    id: "workspace:settings",
    group: t("Pages"),
    label: t("Settings"),
    description: t("Storage and safety"),
    icon: <ProductIcon name="settings" />,
    onSelect: () => onOpenWorkspace("settings")
  },
  ...profiles.map((profile) => ({
    id: `profile:${profile.id}`,
    group: t("Profiles"),
    label: profile.name,
    description: profile.description || t("Profile"),
    keywords: [profile.id],
    icon: <ProductIcon name="profiles" />,
    onSelect: () => onOpenProfile(profile.id)
  })),
  ...skills.map((skill) => ({
    id: `skill:${skill.id}`,
    group: t("Skills"),
    label: skill.name,
    description: skill.description || skill.id,
    keywords: [skill.id, skill.source ?? "", ...(skill.tags ?? [])],
    icon: <ProductIcon name="skills" />,
    onSelect: () => onOpenSkill(skill)
  })),
  ...targets.map((target) => ({
    id: `target:${target.id}`,
    group: t("Agents"),
    label: target.name,
    description: target.health.summary,
    keywords: [target.id],
    icon: <ProductIcon name="agents" />,
    onSelect: () => onOpenTarget(target.id)
  })),
  {
    id: "action:local-skills",
    group: t("Actions"),
    label: t("Local Skills"),
    icon: <ScanLine size={16} strokeWidth={2.2} />,
    onSelect: onOpenLocalSkills
  },
  {
    id: "action:refresh-skills",
    group: t("Actions"),
    label: t("Refresh skills"),
    icon: <RefreshCw size={16} strokeWidth={2.2} />,
    onSelect: onRefreshSkills
  },
  ...(targets.length > 0 ? [{
    id: "action:refresh-targets",
    group: t("Actions"),
    label: t("Refresh Agents"),
    icon: <RefreshCw size={16} strokeWidth={2.2} />,
    onSelect: onRefreshTargets
  }] : [])
];

export const buildConversationQuickOpenItems = ({
  conversations,
  query,
  targets,
  t,
  formatDate,
  onOpenConversation
}: ConversationQuickOpenItemOptions): QuickOpenItem[] =>
  conversations.map((conversation) => {
    const target = targets.find((candidate) => candidate.id === conversation.agentId);
    const icon = target ? targetIconFor(target) : undefined;
    const context = [
      conversation.agentName,
      leafPathName(conversation.workspacePath),
      formatDate(conversation.updatedAt)
    ].filter(Boolean).join(" · ");
    const excerpt = compactText(conversation.matchSnippet || conversation.snippet);
    const normalizedTitle = compactText(conversation.title)?.toLocaleLowerCase();
    const description = excerpt && excerpt.toLocaleLowerCase() !== normalizedTitle
      ? `${context} — ${excerpt}`
      : context;
    return {
      id: `conversation:${conversation.id}`,
      group: t("Conversations"),
      label: conversation.title,
      description,
      keywords: [
        conversation.agentName,
        conversation.workspacePath ?? "",
        conversation.sourceId
      ],
      icon: icon?.assetUrl ? (
        <img
          className={`quick-open-agent-logo quick-open-agent-logo--${icon.flavor}`}
          src={icon.assetUrl}
          alt=""
        />
      ) : (
        <ProductIcon name="conversations" />
      ),
      onSelect: () => onOpenConversation(conversation, query)
    };
  });
