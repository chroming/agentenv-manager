const windowsReservedBasenames = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "clock$",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)
]);

export const isPortableFileName = (value: string) => {
  if (
    !value ||
    value === "." ||
    value === ".." ||
    value.endsWith(".") ||
    value.endsWith(" ") ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(value)
  ) return false;
  const basename = (
    value.startsWith(".") ? value : value.split(".", 1)[0]
  )?.toLocaleLowerCase("en-US");
  return Boolean(basename && !windowsReservedBasenames.has(basename));
};

export const portableIdentityKey = (value: string) =>
  value.normalize("NFC").toLocaleLowerCase("en-US");
