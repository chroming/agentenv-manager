interface McpEditorProps {
  label: string;
  value: string;
  onChange(value: string): void;
}

export const McpEditor = ({ label, value, onChange }: McpEditorProps) => (
  <label className="field-block">
    <span>{label}</span>
    <textarea
      aria-label={label}
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  </label>
);
