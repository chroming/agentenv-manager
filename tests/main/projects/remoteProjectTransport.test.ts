import { describe, expect, it } from "vitest";
import type { RemoteDevice } from "../../../src/shared/types";
import {
  inspectRemoteGit,
  readRemoteTextFile,
  testRemoteProjectPath,
  writeRemoteTextFile
} from "../../../src/main/projects/remoteProjectTransport";

const mockDevice: RemoteDevice = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Dev VM",
  host: "devbox",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

describe("remoteProjectTransport", () => {
  it("probes a remote directory and returns canonical path", async () => {
    const transport = {
      execute: async (_device: unknown, command: string) => {
        expect(command).toContain("DIR");
        return {
          stdout: Buffer.from("DIR\t/home/ubuntu/my-workspace\n"),
          stderr: "",
          exitCode: 0
        };
      }
    };

    const probe = await testRemoteProjectPath(mockDevice, transport, "~/my-workspace");
    expect(probe).toEqual({
      exists: true,
      isDirectory: true,
      canonicalPath: "/home/ubuntu/my-workspace"
    });
  });

  it("reports missing directory when remote check fails", async () => {
    const transport = {
      execute: async () => ({
        stdout: Buffer.from("MISSING\t/nonexistent\n"),
        stderr: "Path does not exist",
        exitCode: 1
      })
    };

    const probe = await testRemoteProjectPath(mockDevice, transport, "/nonexistent");
    expect(probe.exists).toBe(false);
  });

  it("inspects remote git status across candidate paths", async () => {
    const transport = {
      execute: async (_device: unknown, _cmd: string) => ({
        stdout: Buffer.from("IS_GIT\t/home/ubuntu/repo\n M CLAUDE.md\0?? .agent/skills/new-skill\0"),
        stderr: "",
        exitCode: 0
      })
    };

    const git = await inspectRemoteGit(
      mockDevice,
      transport,
      "/home/ubuntu/repo",
      ["CLAUDE.md", ".agent/skills/new-skill", "clean.txt"]
    );

    expect(git.repository).toBe("git");
    expect(git.rootRelation).toBe("workspace-root");
    expect(git.pathStates).toEqual({
      "CLAUDE.md": "tracked-modified",
      ".agent/skills/new-skill": "untracked",
      "clean.txt": "tracked-clean"
    });
  });

  it("reads remote text file content", async () => {
    const transport = {
      execute: async () => ({
        stdout: Buffer.from("# My Workspace Instructions\n"),
        stderr: "",
        exitCode: 0
      })
    };

    const content = await readRemoteTextFile(mockDevice, transport, "/home/ubuntu/repo/CLAUDE.md");
    expect(content).toBe("# My Workspace Instructions\n");
  });

  it("writes remote text file with atomic temporary swap", async () => {
    let capturedInput = "";
    const transport = {
      execute: async (_device: unknown, cmd: string, opts?: { input?: Buffer }) => {
        expect(cmd).toContain("mkdir -p");
        expect(cmd).toContain("mv -f");
        capturedInput = opts?.input?.toString("utf8") ?? "";
        return { stdout: Buffer.alloc(0), stderr: "", exitCode: 0 };
      }
    };

    await writeRemoteTextFile(mockDevice, transport, "/home/ubuntu/repo/CLAUDE.md", "new instructions");
    expect(capturedInput).toBe("new instructions");
  });
});
