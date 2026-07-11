import type {
  LibraryResourceVersions,
  McpLibraryEntry,
  ProfileDetail,
  SkillLibraryEntry
} from "./types";

const sortedRecord = (value: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));

const mcpVersion = (server: McpLibraryEntry): string =>
  JSON.stringify({
    transport: server.transport,
    command: server.command ?? "",
    args: server.args ?? [],
    url: server.url ?? "",
    env: sortedRecord(server.env)
  });

export const collectLibraryResourceVersions = (
  profile: Pick<ProfileDetail, "assetPolicy">,
  skills: readonly SkillLibraryEntry[],
  mcpServers: readonly McpLibraryEntry[]
): LibraryResourceVersions => {
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const mcpById = new Map(mcpServers.map((server) => [server.id, server]));
  return {
    skills: Object.fromEntries(
      [...new Set(
        profile.assetPolicy.skillRefs
          .filter((reference) => reference.enabled !== false)
          .map((reference) => reference.libraryId)
      )]
        .sort()
        .map((id) => [id, skillById.get(id)?.contentHash ?? "missing"])
    ),
    mcp: Object.fromEntries(
      [...new Set(profile.assetPolicy.mcpRefs.map((reference) => reference.libraryId))]
        .sort()
        .map((id) => [id, mcpById.has(id) ? mcpVersion(mcpById.get(id)!) : "missing"])
    )
  };
};

export const libraryResourceVersionsEqual = (
  left: LibraryResourceVersions | undefined,
  right: LibraryResourceVersions | undefined
): boolean => Boolean(left && right && JSON.stringify(left) === JSON.stringify(right));
