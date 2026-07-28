import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePiLayout } from "../../../src/main/targets/integrations/pi/layout";

describe("Pi layout", () => {
  it("uses the official global Agent root and sessions directory by default", () => {
    expect(resolvePiLayout({
      homeDir: "/tmp/pi-home",
      environment: {},
      pathExists: () => false
    })).toEqual({
      agentRoot: "/tmp/pi-home/.pi/agent",
      sessionsRoot: "/tmp/pi-home/.pi/agent/sessions",
      settingsPath: "/tmp/pi-home/.pi/agent/settings.json",
      instructionsPath: "/tmp/pi-home/.pi/agent/AGENTS.md",
      skillsDir: "/tmp/pi-home/.pi/agent/skills"
    });
  });

  it("honors Pi environment roots while keeping the explicit Agent root authoritative", () => {
    const environment = {
      PI_CODING_AGENT_DIR: "/tmp/pi-env/agent",
      PI_CODING_AGENT_SESSION_DIR: "/tmp/pi-env/sessions"
    };

    expect(resolvePiLayout({
      homeDir: "/tmp/pi-home",
      environment,
      pathExists: () => false
    })).toMatchObject({
      agentRoot: "/tmp/pi-env/agent",
      sessionsRoot: "/tmp/pi-env/sessions"
    });
    expect(resolvePiLayout({
      homeDir: "/tmp/pi-home",
      rootDirOverride: "/tmp/pi-override",
      environment,
      pathExists: () => false
    })).toMatchObject({
      agentRoot: "/tmp/pi-override",
      sessionsRoot: "/tmp/pi-env/sessions"
    });
  });

  it("ignores a cwd-relative sessionDir that cannot be resolved globally", () => {
    const agentRoot = "/tmp/pi-home/.pi/agent";
    const settingsPath = join(agentRoot, "settings.json");
    expect(resolvePiLayout({
      homeDir: "/tmp/pi-home",
      environment: {},
      pathExists: (path) => path === settingsPath,
      readText: () => JSON.stringify({ sessionDir: "history/sessions" })
    }).sessionsRoot).toBe(join(agentRoot, "sessions"));
  });

  it("expands home-relative session settings and ignores malformed settings safely", () => {
    const settingsPath = "/tmp/pi-home/.pi/agent/settings.json";
    expect(resolvePiLayout({
      homeDir: "/tmp/pi-home",
      environment: {},
      pathExists: (path) => path === settingsPath,
      readText: () => JSON.stringify({ sessionDir: "~/pi-history" })
    }).sessionsRoot).toBe("/tmp/pi-home/pi-history");

    expect(resolvePiLayout({
      homeDir: "/tmp/pi-home",
      environment: {},
      pathExists: (path) => path === settingsPath,
      readText: () => "{broken"
    }).sessionsRoot).toBe("/tmp/pi-home/.pi/agent/sessions");
  });

  it("ignores non-absolute environment overrides", () => {
    expect(resolvePiLayout({
      homeDir: "/tmp/pi-home",
      environment: {
        PI_CODING_AGENT_DIR: "relative-agent",
        PI_CODING_AGENT_SESSION_DIR: "relative-sessions"
      },
      pathExists: () => false
    })).toMatchObject({
      agentRoot: "/tmp/pi-home/.pi/agent",
      sessionsRoot: "/tmp/pi-home/.pi/agent/sessions"
    });
  });
});
