interface AgentsEditorProps {
  value: string;
  onChange(value: string): void;
}

export const AgentsEditor = ({ value, onChange }: AgentsEditorProps) => (
  <label className="field-block">
    <span>AGENTS.md</span>
    <textarea
      aria-label="AGENTS.md"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  </label>
);
