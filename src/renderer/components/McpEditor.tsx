interface McpEditorProps {
  value: string;
  onChange(value: string): void;
}

export const McpEditor = ({ value, onChange }: McpEditorProps) => (
  <label className="field-block">
    <span>MCP Servers</span>
    <textarea
      aria-label="MCP Servers"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  </label>
);
