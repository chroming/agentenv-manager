import type { Locator, Page } from "playwright-core";
import { expect } from "vitest";

type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

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
