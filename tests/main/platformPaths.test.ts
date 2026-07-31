import { describe, expect, it } from "vitest";
import {
  canonicalPathKey,
  isPathInside,
  pathsEqual,
  platformNullDevice
} from "../../src/main/platformPaths";
import {
  isPortableFileName,
  portableIdentityKey
} from "../../src/shared/portableNames";

describe("platform path semantics", () => {
  it("uses case-insensitive identities and backslash containment on Windows", () => {
    expect(
      pathsEqual(
        "C:\\Users\\Tester\\AgentEnv",
        "c:\\users\\tester\\agentenv",
        "win32"
      )
    ).toBe(true);
    expect(
      isPathInside(
        "C:\\Users\\Tester\\AgentEnv",
        "C:\\Users\\Tester\\AgentEnv\\profiles\\daily",
        { platform: "win32" }
      )
    ).toBe(true);
    expect(
      isPathInside(
        "C:\\Users\\Tester\\AgentEnv",
        "C:\\Users\\Tester\\AgentEnv-Other",
        { platform: "win32" }
      )
    ).toBe(false);
  });

  it("keeps POSIX path identities case-sensitive", () => {
    expect(pathsEqual("/home/tester/Skills", "/home/tester/skills", "linux")).toBe(false);
    expect(canonicalPathKey("/home/tester/../tester/skills", "linux")).toBe(
      "/home/tester/skills"
    );
  });

  it("rejects Windows device names from portable identities", () => {
    expect(isPortableFileName("review")).toBe(true);
    expect(isPortableFileName(".github")).toBe(true);
    expect(isPortableFileName("CON")).toBe(false);
    expect(isPortableFileName("nul.md")).toBe(false);
    expect(isPortableFileName("notes:today.md")).toBe(false);
    expect(isPortableFileName("review?.md")).toBe(false);
    expect(isPortableFileName("review.")).toBe(false);
    expect(portableIdentityKey("Review")).toBe(portableIdentityKey("review"));
  });

  it("provides the platform null device", () => {
    expect(platformNullDevice("win32")).toBe("NUL");
    expect(platformNullDevice("linux")).toBe("/dev/null");
  });
});
