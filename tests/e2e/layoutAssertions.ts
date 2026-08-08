import type { Locator, Page } from "playwright-core";
import { expect } from "vitest";

type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

export interface TextLayoutDefect {
  className: string;
  horizontalOverflow: number;
  selector: string;
  text: string;
  verticalOverflow: number;
}

export interface ResourceDisclosureHeaderGeometry {
  actionsTop: number | null;
  descriptionTop: number | null;
  descriptionVisible: boolean;
  expanded: boolean;
  height: number;
  id: string;
  titleTop: number;
  width: number;
  x: number;
}

export const readResourceDisclosureHeaders = async (
  scope: Locator
): Promise<ResourceDisclosureHeaderGeometry[]> => scope.locator(
  ".ui-resource-disclosure"
).evaluateAll((sections) => sections.map((section) => {
  const header = section.querySelector<HTMLElement>(".ui-resource-disclosure__header")!;
  const title = section.querySelector<HTMLElement>(".ui-resource-disclosure__title")!;
  const description = section.querySelector<HTMLElement>(
    ".ui-resource-disclosure__description"
  );
  const actions = section.querySelector<HTMLElement>(".ui-resource-disclosure__actions");
  const headerBox = header.getBoundingClientRect();
  const titleBox = title.getBoundingClientRect();
  const descriptionBox = description?.getBoundingClientRect();
  const descriptionStyle = description ? getComputedStyle(description) : undefined;
  const actionsBox = actions?.getBoundingClientRect();
  return {
    actionsTop: actionsBox ? Math.round(actionsBox.top - headerBox.top) : null,
    descriptionTop: descriptionBox
      ? Math.round(descriptionBox.top - headerBox.top)
      : null,
    descriptionVisible: Boolean(
      description &&
      descriptionBox &&
      descriptionBox.width > 0 &&
      descriptionBox.height > 0 &&
      descriptionStyle?.display !== "none" &&
      descriptionStyle?.visibility !== "hidden"
    ),
    expanded: section.classList.contains("is-expanded"),
    height: Math.round(headerBox.height),
    id: section.getAttribute("data-resource-disclosure-id") ?? "",
    titleTop: Math.round(titleBox.top - headerBox.top),
    width: Math.round(headerBox.width),
    x: Math.round(headerBox.x)
  };
}));

export const expectStableResourceDisclosureHeaders = (
  before: ResourceDisclosureHeaderGeometry[],
  after: ResourceDisclosureHeaderGeometry[],
  expandedIds: string[]
) => {
  expect(after).toHaveLength(before.length);
  for (const initial of before) {
    const current = after.find(({ id }) => id === initial.id);
    expect(current, `Missing resource header ${initial.id}`).toBeDefined();
    expect(current).toMatchObject({
      height: 54,
      id: initial.id,
      width: initial.width,
      x: initial.x
    });
    expect(current?.titleTop).toBe(initial.titleTop);
    expect(current?.descriptionTop).toBe(initial.descriptionTop);
    expect(current?.descriptionVisible).toBe(true);
    expect(current?.actionsTop).toBe(initial.actionsTop);
  }
  expect(after.filter(({ expanded }) => expanded).map(({ id }) => id).sort())
    .toEqual([...expandedIds].sort());
};

const readBox = async (locator: Locator): Promise<Box> => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

export const expectInViewport = async (page: Page, locator: Locator) => {
  const [box, viewport] = await Promise.all([readBox(locator), page.viewportSize()]);
  expect(viewport).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport!.height);
};

export const expectContainedBy = async (child: Locator, parent: Locator) => {
  const [childBox, parentBox] = await Promise.all([readBox(child), readBox(parent)]);
  expect(childBox.x).toBeGreaterThanOrEqual(parentBox.x);
  expect(childBox.y).toBeGreaterThanOrEqual(parentBox.y);
  expect(childBox.x + childBox.width).toBeLessThanOrEqual(parentBox.x + parentBox.width);
  expect(childBox.y + childBox.height).toBeLessThanOrEqual(parentBox.y + parentBox.height);
};

export const expectNoHorizontalOverflow = async (
  page: Page,
  selectors: string[] = []
) => {
  const overflows = await page.evaluate((candidateSelectors) => {
    const candidates = [document.documentElement, ...candidateSelectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing layout contract element: ${selector}`);
      return element;
    })];

    return candidates.map((element, index) => ({
      selector: index === 0 ? "document" : candidateSelectors[index - 1],
      overflow: element.scrollWidth - element.clientWidth
    }));
  }, selectors);

  expect(overflows.filter(({ overflow }) => overflow > 1)).toEqual([]);
};

export const expectTextFits = async (locator: Locator) => {
  const metrics = await locator.evaluate((element) => ({
    horizontalOverflow: element.scrollWidth - element.clientWidth,
    verticalOverflow: element.scrollHeight - element.clientHeight
  }));
  expect(metrics.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(metrics.verticalOverflow).toBeLessThanOrEqual(1);
};

export const findVisibleTextLayoutDefects = async (page: Page) =>
  page.evaluate(() => {
    const selectors = [
      "button",
      "[role='button']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='menuitemradio']",
      ".ui-badge",
      ".change-kind",
      ".library-primary-status",
      ".profile-skill-state",
      ".capture-resource__status",
      ".ui-resource-disclosure__summary",
      ".agent-settings-status",
      ".target-health-status"
    ];
    const contractCandidates = new Set(
      selectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    );
    const truncatedTextCandidates = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
      ))
      .filter((element) => !element.closest(".ui-visually-hidden"));
    const candidates = Array.from(new Set([...contractCandidates, ...truncatedTextCandidates]));
    const selectorFor = (element: HTMLElement) => {
      const id = element.id ? `#${element.id}` : "";
      const classes = [...element.classList].slice(0, 3).map((name) => `.${name}`).join("");
      return `${element.tagName.toLowerCase()}${id}${classes}`;
    };

    return candidates.flatMap((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
      if (
        !text ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        return [];
      }
      const isControlContract = contractCandidates.has(element);
      const clipsContent = [style.overflow, style.overflowX, style.overflowY]
        .some((value) => value === "hidden" || value === "clip");
      const exposesFullValue = element.dataset.uiOverflowDetail === "true";
      const contentRects: DOMRect[] = [];
      const textNodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let textNode = textNodes.nextNode();
      while (textNode) {
        const parent = textNode.parentElement;
        if (
          textNode.textContent?.trim() &&
          parent &&
          !parent.closest(".ui-visually-hidden") &&
          getComputedStyle(parent).display !== "none" &&
          getComputedStyle(parent).visibility !== "hidden"
        ) {
          const contentRange = document.createRange();
          contentRange.selectNodeContents(textNode);
          contentRects.push(...[...contentRange.getClientRects()].filter(
            (contentRect) => contentRect.width > 0 && contentRect.height > 0
          ));
        }
        textNode = textNodes.nextNode();
      }
      const paintedHorizontalOverflow = clipsContent
        ? Math.max(0, ...contentRects.flatMap((contentRect) => [
            rect.left - contentRect.left,
            contentRect.right - rect.right
          ]))
        : 0;
      const paintedVerticalOverflow = clipsContent
        ? Math.max(0, ...contentRects.flatMap((contentRect) => [
            rect.top - contentRect.top,
            contentRect.bottom - rect.bottom
          ]))
        : 0;
      const horizontalOverflow = Math.max(
        0,
        element.scrollWidth - element.clientWidth,
        paintedHorizontalOverflow
      );
      const verticalOverflow = Math.max(
        0,
        element.scrollHeight - element.clientHeight,
        paintedVerticalOverflow
      );
      if (horizontalOverflow <= 1 && verticalOverflow <= 1) return [];

      if (!isControlContract && (!clipsContent || exposesFullValue)) return [];

      return [{
        className: element.className,
        horizontalOverflow,
        selector: selectorFor(element),
        text: text.slice(0, 120),
        verticalOverflow
      }];
    });
  });

export const expectNoOverlap = async (first: Locator, second: Locator) => {
  const [firstBox, secondBox] = await Promise.all([readBox(first), readBox(second)]);
  const overlap =
    firstBox.x < secondBox.x + secondBox.width &&
    firstBox.x + firstBox.width > secondBox.x &&
    firstBox.y < secondBox.y + secondBox.height &&
    firstBox.y + firstBox.height > secondBox.y;
  expect(overlap).toBe(false);
};

export const expectTopmost = async (locator: Locator) => {
  const isTopmost = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const inset = Math.min(18, rect.height / 4, rect.width / 4);
    const points = [
      [rect.left + rect.width / 2, rect.top + inset],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + rect.width / 2, rect.bottom - inset]
    ];

    return points.every(([x, y]) => {
      const target = document.elementFromPoint(x, y);
      return target === element || element.contains(target);
    });
  });

  expect(isTopmost).toBe(true);
};

export const expectStructuredDialog = async (dialog: Locator) => {
  const geometry = await dialog.evaluate((element) => {
    const header = element.querySelector<HTMLElement>(":scope > .ui-dialog-header");
    const body = element.querySelector<HTMLElement>(":scope > .ui-dialog-body");
    const footer = element.querySelector<HTMLElement>(":scope > .ui-dialog-footer");
    const title = header?.querySelector<HTMLElement>(".ui-dialog-title");
    const box = element.getBoundingClientRect();
    const headerBox = header?.getBoundingClientRect();
    const bodyBox = body?.getBoundingClientRect();
    const footerBox = footer?.getBoundingClientRect();
    return {
      bodyBottom: bodyBox?.bottom ?? 0,
      bodyOverflowY: body ? getComputedStyle(body).overflowY : "",
      bodyTop: bodyBox?.top ?? 0,
      buttonHeights: footer
        ? [...footer.querySelectorAll<HTMLElement>("button")].map((button) =>
            Math.round(button.getBoundingClientRect().height)
          )
        : [],
      dialogBottom: box.bottom,
      dialogOverflowY: getComputedStyle(element).overflowY,
      footerBottom: footerBox?.bottom ?? 0,
      footerTop: footerBox?.top ?? 0,
      headerBottom: headerBox?.bottom ?? 0,
      headerTop: headerBox?.top ?? 0,
      titleTransform: title ? getComputedStyle(title).textTransform : "",
      titleWeight: title ? Number.parseInt(getComputedStyle(title).fontWeight, 10) : 0
    };
  });
  expect(geometry.headerTop).toBeGreaterThan(0);
  expect(geometry.headerBottom).toBeLessThanOrEqual(geometry.bodyTop + 1);
  expect(geometry.bodyBottom).toBeLessThanOrEqual(geometry.footerTop + 1);
  expect(Math.abs(geometry.dialogBottom - geometry.footerBottom)).toBeLessThanOrEqual(1);
  expect(geometry.dialogOverflowY).toBe("hidden");
  expect(["auto", "scroll"]).toContain(geometry.bodyOverflowY);
  expect(new Set(geometry.buttonHeights).size).toBeLessThanOrEqual(1);
  expect(geometry.buttonHeights.every((height) => height === 34)).toBe(true);
  expect(geometry.titleTransform).toBe("none");
  expect(geometry.titleWeight).toBeGreaterThanOrEqual(600);
};
