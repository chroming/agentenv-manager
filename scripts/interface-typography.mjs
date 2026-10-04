export const readInterfaceTypography = (page) => page.evaluate(() => {
  const tokens = getComputedStyle(document.documentElement);
  const bodySize = tokens.getPropertyValue("--font-size-body").trim();
  const metadataSize = tokens.getPropertyValue("--font-size-metadata").trim();
  const regular = tokens.getPropertyValue("--font-weight-regular").trim();
  const medium = tokens.getPropertyValue("--font-weight-medium").trim();
  const describe = (element) => {
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(), className: element.className,
      text: element.textContent?.trim().slice(0, 100),
      size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight
    };
  };
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" &&
      !element.closest("[aria-hidden='true'], .ui-visually-hidden");
  };
  // Document content has its own reading hierarchy; it is not interface prose.
  const readingSurface = ".document-markdown, .syntax-code-preview, .conversation-message-content";
  const paragraphs = [...document.querySelectorAll("p")]
    .filter((element) => visible(element) && !element.closest(readingSurface)).map(describe);
  const headings = [...document.querySelectorAll(".ui-section-label")].filter(visible).map(describe);
  const counts = [...document.querySelectorAll(".ui-section-label__count")].filter(visible).map(describe);
  const paths = [...document.querySelectorAll(".ui-path-list-preview")].filter(visible).map(describe);
  const body = describe(document.body);
  return {
    body, paragraphs, headings, counts, paths,
    violations: [
      ...(body.size !== bodySize || body.weight !== regular ? ["Body does not use the shared regular/body scale"] : []),
      ...paragraphs.filter((item) => Number.parseFloat(item.size) > Number.parseFloat(bodySize))
        .map((item) => `Interface prose uses ${item.size}: ${item.className || item.text}`),
      ...paragraphs.filter((item) => Number.parseInt(item.weight, 10) > Number.parseInt(medium, 10))
        .map((item) => `Interface prose uses heading weight ${item.weight}: ${item.className || item.text}`),
      ...headings.filter((item) => item.size !== bodySize || item.weight !== medium)
        .map((item) => `Section label uses ${item.size}/${item.weight}: ${item.text}`),
      ...counts.filter((item) => item.size !== metadataSize || item.weight !== regular)
        .map((item) => `Section count uses ${item.size}/${item.weight}: ${item.text}`),
      ...paths.filter((item) => item.size !== metadataSize || item.weight !== regular ||
        item.lineHeight !== `${Number.parseFloat(metadataSize) * Number.parseFloat(tokens.getPropertyValue("--line-height-code"))}px`)
        .map((item) => `Path preview does not use the shared metadata/code scale: ${item.text}`)
    ]
  };
});
