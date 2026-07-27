import type { AgentEnvSettings, AppLocale } from "../../shared/types";
import { useI18n } from "../i18n";

export type SettingsCategory = "general" | "agents" | "skills" | "connections" | "data";

const categories = [
  ["general", "General"],
  ["agents", "Agents"],
  ["skills", "Skills"],
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
    <div
      className="settings-categories"
      role="tablist"
      aria-label={t("Settings")}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (currentIndex < 0) return;
        event.preventDefault();
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[nextIndex]?.click();
        tabs[nextIndex]?.focus();
      }}
    >
      {categories.map(([category, label]) => (
        <button
          className={active === category ? "is-active" : ""}
          id={`settings-tab-${category}`}
          key={category}
          role="tab"
          type="button"
          aria-controls="settings-category-panel"
          aria-selected={active === category}
          tabIndex={active === category ? 0 : -1}
          onClick={() => onChange(category)}
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
};

export const GeneralSettingsSection = ({
  locale,
  onLocaleChange,
  conversationTerminal,
  onConversationTerminalChange
}: {
  locale: AppLocale;
  onLocaleChange(locale: AppLocale): void;
  conversationTerminal: AgentEnvSettings["conversationTerminal"];
  onConversationTerminalChange(
    terminal: AgentEnvSettings["conversationTerminal"]
  ): void;
}) => {
  const { t } = useI18n();
  return (
    <section className="resource-section settings-section" aria-labelledby="appearance-heading">
      <div className="settings-section-title">
        <div className="resource-heading" id="appearance-heading">{t("General")}</div>
      </div>
      <div className="settings-preference-list">
        <label className="settings-preference-row">
          <span className="settings-preference-copy">
            <strong>{t("Language")}</strong>
            <small>{t("Uses your system language until you choose another language.")}</small>
          </span>
          <select
            data-testid="locale-select"
            aria-label={t("Interface language")}
            value={locale}
            onChange={(event) => onLocaleChange(event.currentTarget.value as AppLocale)}
          >
            <option value="system">{t("System default")}</option>
            <option value="en">{t("English")}</option>
            <option value="zh_CN">{t("Simplified Chinese")}</option>
            <option value="zh_TW">{t("Traditional Chinese")}</option>
          </select>
        </label>
        <label className="settings-preference-row">
          <span className="settings-preference-copy">
            <strong>{t("Conversation terminal")}</strong>
            <small>{t("Used when opening or continuing CLI conversations.")}</small>
          </span>
          <select
            data-testid="conversation-terminal-select"
            aria-label={t("Conversation terminal")}
            value={conversationTerminal}
            onChange={(event) => onConversationTerminalChange(
              event.currentTarget.value as AgentEnvSettings["conversationTerminal"]
            )}
          >
            <option value="default">{t("Default terminal")}</option>
            <option value="ghostty">{t("Ghostty")}</option>
          </select>
        </label>
      </div>
    </section>
  );
};
