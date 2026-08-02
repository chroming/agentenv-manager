import { describe, expect, it } from "vitest";
import { parseDiagnosticErrorMessage } from "../../src/renderer/diagnostics";

describe("renderer diagnostics", () => {
  it("removes Electron IPC wrapping while preserving the diagnostic reference", () => {
    expect(parseDiagnosticErrorMessage(
      "Error invoking remote method 'activation:apply': Error: Apply failed\nDiagnostic reference: AEM-20260728-ABC123"
    )).toEqual({
      reference: "AEM-20260728-ABC123",
      message: "Apply failed"
    });
  });
});
