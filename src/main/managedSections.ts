export type ManagedSectionName = "mcp" | "skills";

const beginMarker = (name: ManagedSectionName) =>
  `# BEGIN AgentEnv Manager: ${name}`;

const endMarker = (name: ManagedSectionName) =>
  `# END AgentEnv Manager: ${name}`;

const findSection = (content: string, name: ManagedSectionName) => {
  const begin = beginMarker(name);
  const end = endMarker(name);
  const start = content.indexOf(begin);
  const finish = content.indexOf(end);

  if (start === -1 && finish === -1) {
    return null;
  }

  if (start === -1 || finish === -1 || finish < start) {
    throw new Error(`Malformed AgentEnv managed section: ${name}`);
  }

  return {
    begin,
    end,
    start,
    endOffset: finish + end.length
  };
};

export const replaceManagedSection = (
  content: string,
  name: ManagedSectionName,
  replacement: string
): string => {
  const normalizedReplacement = replacement.trimEnd();
  const block = `${beginMarker(name)}\n${normalizedReplacement}\n${endMarker(name)}`;
  const section = findSection(content, name);

  if (!section) {
    const separator = content.trim().length === 0 ? "" : "\n\n";
    return `${content.trimEnd()}${separator}${block}\n`;
  }

  const before = content.slice(0, section.start).trimEnd();
  const after = content.slice(section.endOffset);
  return `${before}\n\n${block}${after}`;
};

export const stripManagedSection = (
  content: string,
  name: ManagedSectionName
): string => {
  const section = findSection(content, name);

  if (!section) {
    return content;
  }

  return `${content.slice(0, section.start).trimEnd()}${content.slice(section.endOffset)}`;
};
