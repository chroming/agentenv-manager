import type { AgentEnvSettings, AppLocale } from "../../shared/types";
import { useI18n } from "../i18n";
import { SettingsPreferenceRow } from "./SettingsPreferenceRow";
import { SelectControl, TabBar } from "./ui";
import { HistorySearchSettings } from "./HistorySearchSettings";

export type SettingsCategory = "general" | "agents" | "skills" | "conversations" | "ai" | "connections" | "data";

const categories = [
  ["general", "General"],
  ["agents", "Agents"],
  ["skills", "Skills"],
  ["conversations", "Conversations"],
  ["ai", "AI assistance"],
  ["connections", "Connections"],
  ["data", "Data"]
] as const;

export const SettingsCategoryTabs = ({
  active,
  onChange
}: {
  active: SettingsCategory;
  onChange(category: SettingsCategory): void;
}) => {
  const { t } = useI18n();
  return (
    <TabBar
      className="settings-categories"
      idPrefix="settings-tab"
      label={t("Settings")}
      options={categories.map(([value, label]) => ({ value, label: t(label) }))}
      panelId="settings-category-panel"
      value={active}
      onChange={onChange}
    />
  );
};

export const GeneralSettingsSection = ({
  locale,
  onLocaleChange
}: {
  locale: AppLocale;
  onLocaleChange(locale: AppLocale): void;
}) => {
  const { t } = useI18n();
  return (
    <section className="resource-section settings-section" aria-labelledby="appearance-heading">
      <div className="settings-section-title">
        <div className="resource-heading" id="appearance-heading">{t("General")}</div>
      </div>
      <div className="settings-preference-list">
        <SettingsPreferenceRow
          label={t("Language")}
          help={t("Uses your system language until you choose another language.")}
          control={<SelectControl
            controlWidth="standard"
            data-testid="locale-select"
            aria-label={t("Interface language")}
            value={locale}
            onChange={(event) => onLocaleChange(event.currentTarget.value as AppLocale)}
          >
            <option value="system">{t("System default")}</option>
            <option value="en">{t("English")}</option>
            <option value="zh_CN">{t("Simplified Chinese")}</option>
            <option value="zh_TW">{t("Traditional Chinese")}</option>
          </SelectControl>}
        />
      </div>
    </section>
  );
};

export const ConversationSettingsSection = ({
  conversationTerminal, onConversationTerminalChange
}: {
  conversationTerminal: AgentEnvSettings["conversationTerminal"];
  onConversationTerminalChange(terminal: AgentEnvSettings["conversationTerminal"]): void;
}) => {
  const { t } = useI18n();
  return (
    <section className="resource-section settings-section" aria-labelledby="conversations-settings-heading">
      <div className="settings-section-title">
        <div className="resource-heading" id="conversations-settings-heading">{t("Conversations")}</div>
      </div>
      <div className="settings-preference-list">
        <SettingsPreferenceRow label={t("Conversation sources")} control={<HistorySearchSettings entry="icon" />} />
        <SettingsPreferenceRow
          label={t("Conversation terminal")}
          help={t("Used when opening or continuing CLI conversations.")}
          control={<SelectControl
            controlWidth="standard"
            data-testid="conversation-terminal-select"
            aria-label={t("Conversation terminal")}
            value={conversationTerminal}
            onChange={(event) => onConversationTerminalChange(
              event.currentTarget.value as AgentEnvSettings["conversationTerminal"]
            )}
          >
            <option value="default">{t("Default terminal")}</option>
            {window.agentEnv.platform !== "win32" ? (
              <option value="ghostty">{t("Ghostty")}</option>
            ) : null}
          </SelectControl>}
        />
      </div>
    </section>
  );
};
