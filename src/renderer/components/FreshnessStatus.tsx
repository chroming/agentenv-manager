import { CircleAlert, Clock3, LoaderCircle } from "lucide-react";
import type { FreshnessState } from "../freshness";
import { useI18n } from "../i18n";

type FreshnessVerb = "Refreshed" | "Scanned" | "Checked" | "Indexed";

export const FreshnessStatus = ({
  state,
  verb = "Refreshed"
}: {
  state: FreshnessState;
  verb?: FreshnessVerb;
}) => {
  const { formatDate, localeTag, t } = useI18n();
  if (state.status === "idle") return null;

  const lastSuccess = state.lastSuccessAt
    ? new Date(state.lastSuccessAt).toISOString()
    : undefined;
  const shortTime = lastSuccess
    ? new Intl.DateTimeFormat(localeTag, {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(lastSuccess))
    : undefined;
  const label = state.status === "refreshing"
    ? t("Refreshing…")
    : state.status === "error"
      ? t("Refresh failed")
      : state.status === "partial"
        ? t("Updated with issues")
        : t("{{verb}} {{date}}", {
            verb: t(verb),
            date: shortTime ?? ""
          });
  const title = [
    state.error,
    lastSuccess
      ? t("Last successful refresh: {{date}}", { date: formatDate(lastSuccess) })
      : undefined
  ].filter(Boolean).join("\n");

  return (
    <span
      className={`freshness-status freshness-status--${state.status}`}
      role={state.status === "refreshing" ? "status" : undefined}
      aria-live={state.status === "refreshing" ? "polite" : undefined}
      title={title || undefined}
    >
      {state.status === "refreshing" ? (
        <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
      ) : state.status === "error" || state.status === "partial" ? (
        <CircleAlert size={13} aria-hidden="true" />
      ) : (
        <Clock3 size={13} aria-hidden="true" />
      )}
      <span>{label}</span>
    </span>
  );
};
