import { describe, expect, it } from "vitest";
import { parseExternalUrl } from "../../src/main/externalUrl";

describe("external URL validation", () => {
  it("allows normalized HTTP and HTTPS links", () => {
    expect(parseExternalUrl("https://github.com/acme/skills/tree/main/reviewer")).toBe(
      "https://github.com/acme/skills/tree/main/reviewer"
    );
    expect(parseExternalUrl("http://localhost:3000/docs")).toBe(
      "http://localhost:3000/docs"
    );
  });

  it("rejects invalid and non-web protocols", () => {
    expect(() => parseExternalUrl("not a URL")).toThrow("External URL is invalid");
    expect(() => parseExternalUrl("file:///tmp/secret")).toThrow(
      "External URL must use http or https"
    );
    expect(() => parseExternalUrl("javascript:alert(1)")).toThrow(
      "External URL must use http or https"
    );
  });
});
