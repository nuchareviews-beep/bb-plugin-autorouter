import { describe, expect, it } from "vitest";
import { parseStoredSettings } from "./settings.js";

describe("parseStoredSettings", () => {
  it("preserves legacy settings after dropping the removed enabled flag", () => {
    expect(
      parseStoredSettings({
        enabled: false,
        decisionAgent: "automatic",
        customInstructions: "Prefer fast models.",
        frugality: 75,
      }),
    ).toEqual({
      decisionAgent: "automatic",
      customInstructions: "Prefer fast models.",
      frugality: 75,
    });
  });
});
