import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDiagnosticIssue, parseDiagnosticErrorMessage } from "../../diagnostics";
import { useI18n } from "../../i18n";
import { IconButton } from "./IconButton";

export const DiagnosticCopyButton = ({ message }: { message: string }) => {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const reference = parseDiagnosticErrorMessage(message).reference;
  useEffect(() => { setState("idle"); }, [message]);
  if (!reference) return null;
  const copy = async () => {
    setState("copying");
    try {
      const issue = await window.agentEnv.readDiagnosticIssue(reference).catch(() => undefined);
      await window.agentEnv.copyText(issue ? formatDiagnosticIssue(issue) : message);
      setState("copied");
    } catch { setState("failed"); }
  };
  return <IconButton
    appearance="inline"
    label={t(state === "copied" ? "Copied" : state === "failed" ? "Copy failed. Try again." : "Copy details")}
    busy={state === "copying"}
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); void copy(); }}
  >{state === "copied" ? <Check size={14} /> : <Copy size={14} />}</IconButton>;
};

export const DiagnosticMessage = ({ message }: { message: string }) => (
  <span className="ui-diagnostic-message">
    <span>{message}</span>
    <DiagnosticCopyButton message={message} />
  </span>
);
