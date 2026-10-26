import type { SkillUpdateSkippedCopy } from "../../shared/types";
import { useI18n } from "../i18n";
import { Notice, PathListPreview } from "./ui";

export const SkillUpdateCopyNotice = ({ copies }: { copies?: SkillUpdateSkippedCopy[] }) => {
  const { t } = useI18n();
  if (!copies?.length) return null;
  return <section aria-label={t("Agent copies kept")}>
    <Notice tone="warning" role="status" title={t("Library updated; Agent copies kept")}>
      {t("These copies differ from the saved deployment or could not be verified. They were not changed. Review them before replacing them.")}
    </Notice>
    <PathListPreview paths={copies.map((copy) => copy.path)} />
  </section>;
};
