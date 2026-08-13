import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import type { Rectangle } from "electron";

export interface PersistedWindowState extends Rectangle {
  maximized: boolean;
}

const minimumWidth = 920;
const minimumHeight = 620;

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const parseWindowState = (value: unknown): PersistedWindowState | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<PersistedWindowState>;
  if (
    !finiteNumber(candidate.x) ||
    !finiteNumber(candidate.y) ||
    !finiteNumber(candidate.width) ||
    !finiteNumber(candidate.height) ||
    typeof candidate.maximized !== "boolean"
  ) {
    return undefined;
  }
  return {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    width: Math.round(candidate.width),
    height: Math.round(candidate.height),
    maximized: candidate.maximized
  };
};

export const constrainWindowState = (
  state: PersistedWindowState,
  workArea: Rectangle
): PersistedWindowState => {
  const width = Math.min(workArea.width, Math.max(minimumWidth, state.width));
  const height = Math.min(workArea.height, Math.max(minimumHeight, state.height));
  const x = Math.min(
    workArea.x + workArea.width - width,
    Math.max(workArea.x, state.x)
  );
  const y = Math.min(
    workArea.y + workArea.height - height,
    Math.max(workArea.y, state.y)
  );
  return { x, y, width, height, maximized: state.maximized };
};

export const readWindowState = (path: string): PersistedWindowState | undefined => {
  try {
    return parseWindowState(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
};

export const writeWindowState = (path: string, state: PersistedWindowState) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

export const writeWindowStateWhenReady = (
  path: string,
  state: PersistedWindowState,
  dataReady: boolean
): boolean => {
  if (!dataReady) return false;
  writeWindowState(path, state);
  return true;
};
