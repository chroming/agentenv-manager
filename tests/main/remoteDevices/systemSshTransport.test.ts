import { describe, expect, it } from "vitest";
import {
  remoteDeviceFingerprint,
  shellQuote
} from "../../../src/main/remoteDevices/systemSshTransport";

describe("system SSH transport", () => {
  it("quotes untrusted remote shell values without interpolation", () => {
    expect(shellQuote("a'b; $(touch /tmp/nope)")).toBe(
      `'a'"'"'b; $(touch /tmp/nope)'`
    );
  });

  it("binds endpoint state to the remote machine identity", () => {
    const first = remoteDeviceFingerprint({
      homeDir: "/home/agent",
      platform: "Linux",
      architecture: "x86_64",
      machineId: "machine-a"
    });
    const second = remoteDeviceFingerprint({
      homeDir: "/home/agent",
      platform: "Linux",
      architecture: "x86_64",
      machineId: "machine-b"
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });
});
