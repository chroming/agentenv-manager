import { describe, expect, it } from "vitest";
import {
  AGENTENV_RUNTIME_VERSION,
  isAgentEnvRuntimeCompatible
} from "../../src/shared/runtimeVersion";

describe("desktop runtime compatibility", () => {
  it("accepts only the current preload contract", () => {
    expect(isAgentEnvRuntimeCompatible(AGENTENV_RUNTIME_VERSION)).toBe(true);
    expect(isAgentEnvRuntimeCompatible(AGENTENV_RUNTIME_VERSION - 1)).toBe(false);
    expect(isAgentEnvRuntimeCompatible(undefined)).toBe(false);
  });
});
