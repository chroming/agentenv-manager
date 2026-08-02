import { parseRepositoryLocation } from "../skillSources/repositoryLocation";

const SCP_LIKE = /^[A-Za-z0-9._-]+@(?:\[[^\]]+\]|[A-Za-z0-9.-]+):.+$/;
const URL_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export const toPortableOnlineLocator = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized || (!URL_LIKE.test(normalized) && !SCP_LIKE.test(normalized))) {
    return undefined;
  }
  const location = parseRepositoryLocation(normalized, { allowLocal: true });
  return location.kind === "file" ? undefined : normalized;
};

export const isPortableOnlineLocator = (value: string | undefined): boolean => {
  try {
    return Boolean(toPortableOnlineLocator(value));
  } catch {
    return false;
  }
};
