// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ProfileDetail, ProfileSummary } from "../../src/shared/types";
import { useProfileRefresh } from "../../src/renderer/hooks/useProfileRefresh";

const profile = { id: "daily" } as ProfileDetail;
const summary = { id: "daily" } as ProfileSummary;
const setup = () => ({
  disabled: false, selectedId: "daily", beginFlow: vi.fn(() => 1),
  isFlowCurrent: vi.fn(() => true),
  refresh: vi.fn(async () => ({ profileItems: [summary] })),
  read: vi.fn(async () => profile), accept: vi.fn(), clear: vi.fn(),
  invalidate: vi.fn(), onError: vi.fn()
});

it("refreshes records and the selected saved Profile without writing or selecting another", async () => {
  const options = setup();
  const { result } = renderHook(() => useProfileRefresh(options));
  await act(() => result.current.refresh());
  expect(options.read).toHaveBeenCalledWith("daily");
  expect(options.accept).toHaveBeenCalledWith(profile);
  expect(options.invalidate).toHaveBeenCalledOnce();
  expect(result.current.refreshing).toBe(false);
});

it("keeps the local spinner pending and coalesces repeated clicks", async () => {
  const options = setup();
  let finish!: (value: { profileItems: ProfileSummary[] }) => void;
  options.refresh.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useProfileRefresh(options));
  let running!: Promise<void>;
  act(() => { running = result.current.refresh(); });
  expect(result.current.refreshing).toBe(true);
  await act(() => result.current.refresh());
  expect(options.refresh).toHaveBeenCalledOnce();
  await act(async () => { finish({ profileItems: [summary] }); await running; });
  expect(result.current.refreshing).toBe(false);
});

it("does not overwrite an edit or selection made while reading the Profile", async () => {
  const options = setup();
  options.read.mockImplementation(async () => {
    options.isFlowCurrent.mockReturnValue(false);
    return profile;
  });
  const { result } = renderHook(() => useProfileRefresh(options));
  await act(() => result.current.refresh());
  expect(options.accept).not.toHaveBeenCalled();
  expect(options.invalidate).not.toHaveBeenCalled();
});

it("retains displayed data on failure and allows retry", async () => {
  const options = setup();
  options.refresh.mockRejectedValueOnce(new Error("Unavailable"));
  const { result } = renderHook(() => useProfileRefresh(options));
  await act(() => result.current.refresh());
  expect(options.onError).toHaveBeenCalledWith("Unavailable");
  expect(options.clear).not.toHaveBeenCalled();
  expect(result.current.refreshing).toBe(false);
  await act(() => result.current.refresh());
  expect(options.accept).toHaveBeenCalledWith(profile);
});

it("never starts while an edit is dirty or saving", async () => {
  const options = { ...setup(), disabled: true };
  const { result } = renderHook(() => useProfileRefresh(options));
  await act(() => result.current.refresh());
  expect(options.refresh).not.toHaveBeenCalled();
});

it("handles a deleted selection and an empty Library", async () => {
  const options = { ...setup(), selectedId: "removed" };
  const { result } = renderHook(() => useProfileRefresh(options));
  await act(() => result.current.refresh());
  expect(options.accept).toHaveBeenCalledWith(profile);
  options.refresh.mockResolvedValue({ profileItems: [] });
  await act(() => result.current.refresh());
  expect(options.clear).toHaveBeenCalledOnce();
});
