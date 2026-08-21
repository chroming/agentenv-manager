import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../../src/main/paths";
import {
  createRemoteEndpointStateRepository,
  type RemoteEndpointState
} from "../../../src/main/remoteDevices/remoteEndpointStateRepository";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const stateFor = (endpointId: string): RemoteEndpointState => ({
  formatVersion: 1,
  endpointId,
  deviceFingerprint: `fingerprint:${endpointId}`
});

describe("remote endpoint state repository", () => {
  it("lists persisted endpoint receipts", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-remote-state-"));
    const repository = createRemoteEndpointStateRepository(createPaths({ appDataRoot: root }));
    const first = stateFor("ssh:device-a:opencode");
    const second = stateFor("ssh:device-b:codex");

    await repository.write(first);
    await repository.write(second);

    await expect(repository.list()).resolves.toEqual(expect.arrayContaining([first, second]));
  });

  it("removes only receipts owned by the removed device", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-remote-state-remove-"));
    const repository = createRemoteEndpointStateRepository(createPaths({ appDataRoot: root }));
    const removed = stateFor("ssh:device-a:opencode");
    const retained = stateFor("ssh:device-b:opencode");

    await repository.write(removed);
    await repository.write(retained);
    await repository.removeDevice("device-a");

    await expect(repository.read(removed.endpointId)).resolves.toBeUndefined();
    await expect(repository.read(retained.endpointId)).resolves.toEqual(retained);
  });
});
