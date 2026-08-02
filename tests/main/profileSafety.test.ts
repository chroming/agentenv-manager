import { describe, expect, it, vi } from "vitest";
import { readAllProfilesForResourceMutation } from "../../src/main/profileSafety";

describe("Profile resource mutation safety", () => {
  it("blocks when a damaged Profile makes references unknowable", async () => {
    const readProfile = vi.fn();
    await expect(
      readAllProfilesForResourceMutation({
        listProfiles: vi.fn().mockResolvedValue([
          {
            id: "broken",
            targetId: "unknown",
            name: "broken",
            description: "",
            loadError: "Invalid manifest"
          }
        ]),
        readProfile
      }, "Skill removal")
    ).rejects.toThrow("Skill removal is blocked until damaged Profile data is repaired: broken");
    expect(readProfile).not.toHaveBeenCalled();
  });
});
