import { describe, expect, it } from "vitest";
import { defaultAutorouterSettings, parseStoredSettings } from "./settings.js";

describe("parseStoredSettings migration", () => {
  it("returns stored settings unchanged when they already match the current schema", () => {
    const stored = {
      ...defaultAutorouterSettings,
      decisionAgent: "antigravity/gemini-3.7-flash-high",
    };
    expect(parseStoredSettings(stored)).toEqual(stored);
  });

  it("preserves a user override when a new top-level field was added since it was stored", () => {
    // Reproduces a real regression hit live: settings stored before
    // automaticFallbackChain existed used to get wholesale reset to
    // defaultAutorouterSettings on the next load, silently discarding
    // decisionAgent along with it.
    const legacyStored = {
      enabled: true,
      decisionAgent: "antigravity/gemini-3.7-flash-high",
      customInstructions: "Route CSS-only work to Antigravity.",
      frugality: 50,
      // automaticFallbackChain and difficultyBands intentionally absent.
    };
    const result = parseStoredSettings(legacyStored);
    expect(result.decisionAgent).toBe("antigravity/gemini-3.7-flash-high");
    expect(result.customInstructions).toBe("Route CSS-only work to Antigravity.");
    expect(result.automaticFallbackChain).toEqual(
      defaultAutorouterSettings.automaticFallbackChain,
    );
    expect(result.difficultyBands).toEqual(defaultAutorouterSettings.difficultyBands);
  });

  it("backfills a missing band comparator instead of discarding the whole band list", () => {
    const legacyStored = {
      ...defaultAutorouterSettings,
      difficultyBands: [
        // Pre-comparator shape: no `comparator` field at all.
        { maxDifficulty: 40, fallbackChain: ["codex/gpt-5.6-luna"] },
      ],
    };
    const result = parseStoredSettings(legacyStored);
    expect(result.difficultyBands).toEqual([
      { maxDifficulty: 40, comparator: "<=", fallbackChain: ["codex/gpt-5.6-luna"] },
    ]);
  });

  it("leaves a band's existing comparator alone during migration", () => {
    const legacyStored = {
      ...defaultAutorouterSettings,
      difficultyBands: [
        { maxDifficulty: 80, comparator: ">=", fallbackChain: ["claude-code"] },
        { maxDifficulty: 10, fallbackChain: ["antigravity"] }, // missing comparator
      ],
    };
    const result = parseStoredSettings(legacyStored);
    expect(result.difficultyBands).toEqual([
      { maxDifficulty: 80, comparator: ">=", fallbackChain: ["claude-code"] },
      { maxDifficulty: 10, comparator: "<=", fallbackChain: ["antigravity"] },
    ]);
  });

  it("falls back to full defaults only for genuinely unparseable data", () => {
    expect(parseStoredSettings(null)).toEqual(defaultAutorouterSettings);
    expect(parseStoredSettings("not an object")).toEqual(defaultAutorouterSettings);
    expect(parseStoredSettings({ enabled: "not a boolean" })).toEqual(
      defaultAutorouterSettings,
    );
  });
});
