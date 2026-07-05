export const parseExternalUrl = (value: unknown): string => {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("External URL is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("External URL must use http or https");
  }
  return url.toString();
};
