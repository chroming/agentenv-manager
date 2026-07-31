import {
  BookOpenText,
  FolderKanban,
  MessageSquareText,
  Monitor,
  RefreshCw,
  Settings2
} from "lucide-react";
import type {
  ConversationSummary,
  ProfileSummary,
  SkillLibraryEntry,
  TargetInfo
} from "../shared/types";
import { targetIconFor, type AppWorkspace } from "./components/ProfileSidebar";
import type { QuickOpenItem } from "./components/QuickOpen";
import type { TranslationValues } from "./i18n";

interface QuickOpenItemOptions {
  profiles: ProfileSummary[];
  skills: SkillLibraryEntry[];
  targets: TargetInfo[];
  t(message: string, values?: TranslationValues): string;
  onOpenWorkspace(workspace: AppWorkspace): void;
  onOpenProfile(id: string): void;
  onOpenSkill(skill: SkillLibraryEntry): void;
  onOpenTarget(id: string): void;
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
  onRefreshSkills,
  onRefreshTargets
}: QuickOpenItemOptions): QuickOpenItem[] => [
  {
    id: "workspace:targets",
    group: t("Pages"),
    label: t("Agents"),
    description: t("Local agent tools"),
    icon: <Monitor size={16} strokeWidth={2.2} />,
    onSelect: () => onOpenWorkspace("targets")
  },
  {
    id: "workspace:profiles",
    group: t("Pages"),
    label: t("Profiles"),
    description: t("Compose environments"),
    icon: <FolderKanban size={16} strokeWidth={2.2} />,
    onSelect: () => onOpenWorkspace("profiles")
  },
  {
    id: "workspace:conversations",
    group: t("Pages"),
    label: t("Conversations"),
    description: t("Continue across Agents"),
    icon: <MessageSquareText size={16} strokeWidth={2.2} />,
    onSelect: () => onOpenWorkspace("conversations")
  },
  {
    id: "workspace:skills",
    group: t("Pages"),
    label: t("Skills"),
    description: t("Skill library"),
    icon: <BookOpenText size={16} strokeWidth={2.2} />,
    onSelect: () => onOpenWorkspace("library")
  },
  {
    id: "workspace:settings",
    group: t("Pages"),
    label: t("Settings"),
    description: t("Storage and safety"),
    icon: <Settings2 size={16} strokeWidth={2.2} />,
    onSelect: () => onOpenWorkspace("settings")
  },
  ...profiles.map((profile) => ({
    id: `profile:${profile.id}`,
    group: t("Profiles"),
    label: profile.name,
    description: profile.description || t("Profile"),
    keywords: [profile.id],
    icon: <FolderKanban size={16} strokeWidth={2.2} />,
    onSelect: () => onOpenProfile(profile.id)
  })),
  ...skills.map((skill) => ({
    id: `skill:${skill.id}`,
    group: t("Skills"),
    label: skill.name,
    description: skill.description || skill.id,
    keywords: [skill.id, skill.source ?? ""],
    icon: <BookOpenText size={16} strokeWidth={2.2} />,
    onSelect: () => onOpenSkill(skill)
  })),
  ...targets.map((target) => ({
    id: `target:${target.id}`,
    group: t("Agents"),
    label: target.name,
    description: target.health.summary,
    keywords: [target.id],
    icon: <Monitor size={16} strokeWidth={2.2} />,
    onSelect: () => onOpenTarget(target.id)
  })),
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
        <MessageSquareText size={16} strokeWidth={2.2} />
      ),
      onSelect: () => onOpenConversation(conversation, query)
    };
  });
