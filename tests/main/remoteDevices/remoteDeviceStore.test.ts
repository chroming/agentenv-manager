import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../../src/main/paths";
import { createRemoteDeviceStore } from "../../../src/main/remoteDevices/remoteDeviceStore";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("remote device store", () => {
  it("persists only the SSH connection descriptor", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-remote-device-"));
    const paths = createPaths({ appDataRoot: root, homeDir: join(root, "home") });
    const store = createRemoteDeviceStore(paths);

    const device = await store.add({
      name: "Build server",
      host: "build.internal",
      user: "agent",
      port: 2222
    });

    expect(await store.list()).toEqual([device]);
    const persisted = await readFile(paths.remoteDevicesPath, "utf8");
    expect(persisted).toContain('"host": "build.internal"');
    expect(persisted).not.toMatch(/password|privateKey|token/i);
  });

  it("rejects command-like hosts and duplicate display names", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-remote-device-invalid-"));
    const store = createRemoteDeviceStore(createPaths({ appDataRoot: root }));

    await expect(store.add({ name: "Bad", host: "host; rm -rf /" })).rejects.toThrow(
      "SSH host"
    );
    await store.add({ name: "Build", host: "build-one" });
    await expect(store.add({ name: "build", host: "build-two" })).rejects.toThrow(
      "already exists"
    );
  });

  it("fails closed when the descriptor file is malformed", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-remote-device-corrupt-"));
    const paths = createPaths({ appDataRoot: root });
    await writeFile(paths.remoteDevicesPath, '{"formatVersion":1,"devices":[{"host":"missing-id"}]}');

    await expect(createRemoteDeviceStore(paths).list()).rejects.toThrow(
      "Remote device settings are invalid"
    );
  });
});
