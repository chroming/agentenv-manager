import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { IconButton } from "./ui";

export const DataRootPath = () => {
  const { t } = useI18n();
  const [dataRoot, setDataRoot] = useState("~/.config/agentenv-manager");
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void window.agentEnv.readDataRoot()
      .then((path) => {
        if (active) setDataRoot(path);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    };
  }, []);
  return (
    <div className="settings-data-location">
      <code className="settings-data-path" data-ui-overflow-detail="true" title={dataRoot}>
        {dataRoot}
      </code>
      <IconButton
        size="compact"
        variant="ghost"
        label={t(copied ? "Copied" : "Copy data folder path")}
        onClick={() => {
          void window.agentEnv.copyText(dataRoot).then(() => {
            setCopied(true);
            if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
            resetTimerRef.current = window.setTimeout(() => setCopied(false), 2_000);
          });
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </IconButton>
    </div>
  );
};
