import { describe, expect, it } from "vitest";
import type { AutoModelCandidate, ReasoningLevel } from "./benchmarks.js";
import {
  isModelOverrideGrounded,
  leastClassifierReasoning,
  matchModelOverride,
  parseDifficultyDecision,
  quotaRemainingByProvider,
} from "./router.js";

function candidate(
  providerId: string,
  modelId: string,
  reasoningLevels: ReasoningLevel[],
): AutoModelCandidate {
  return {
    providerId,
    permissionModes: ["accept-edits", "full"],
    supportsServiceTier: true,
    model: {
      id: modelId,
      model: modelId,
      displayName: modelId,
      description: "",
      supportedReasoningEfforts: reasoningLevels.map((reasoningEffort) => ({
        reasoningEffort,
        description: reasoningEffort,
      })),
      defaultReasoningEffort: reasoningLevels[0] ?? "medium",
      isDefault: false,
    },
  };
}

describe("difficulty decision", () => {
  it("parses compact JSON and integer-only fallbacks", () => {
    expect(
      parseDifficultyDecision('{"difficulty":87,"modelOverride":"Fable 5"}'),
    ).toEqual({ difficulty: 87, modelOverride: "Fable 5" });
    expect(parseDifficultyDecision("12")).toEqual({
      difficulty: 12,
      modelOverride: null,
    });
  });

  it("uses Cursor's lowest launchable reasoning despite a none model row", () => {
    expect(
      leastClassifierReasoning(
        candidate("acp-cursor", "gpt-5.6-sol-medium", [
          "none",
          "low",
          "medium",
        ]),
      ),
    ).toBe("low");
  });
});

describe("model overrides", () => {
  const candidates = [
    candidate("codex", "gpt-5.6-sol", ["medium", "high"]),
    candidate("acp-cursor", "claude-fable-5-thinking-medium", ["high", "max"]),
    candidate("acp-cursor", "composer-2.5", ["medium"]),
  ];

  it("matches exact provider/model and human-readable family names", () => {
    expect(matchModelOverride(candidates, "codex/gpt-5.6-sol")).toEqual([
      candidates[0],
    ]);
    expect(matchModelOverride(candidates, "Fable 5")).toEqual([candidates[1]]);
  });

  it("requires an available, grounded model", () => {
    const matched = matchModelOverride(candidates, "Composer 2.5");
    expect(
      isModelOverrideGrounded("Composer 2.5", matched, [
        "Use Composer 2.5 for this task",
        "",
      ]),
    ).toBe(true);
    expect(
      isModelOverrideGrounded("Composer 2.5", matched, [
        "Fix the button color",
        "",
      ]),
    ).toBe(false);
    expect(matchModelOverride(candidates, "best")).toEqual([]);
  });
});

describe("provider quota", () => {
  it("uses Cursor on-demand quota after included usage is exhausted", () => {
    const remaining = quotaRemainingByProvider({
      codex: { status: "expired" },
      claudeCode: { status: "unauthenticated" },
      cursor: {
        status: "ok",
        accountEmail: null,
        planLabel: "Pro",
        windows: [
          { label: "Plan usage", usedPercent: 100, resetsAt: null },
          {
            label: "On-demand spend",
            usedPercent: 25,
            resetsAt: null,
            cost: { usedUsdCents: 2_500, limitUsdCents: 10_000 },
          },
        ],
      },
    });
    expect(remaining.get("codex")).toBe(0);
    expect(remaining.get("claude-code")).toBe(0);
    expect(remaining.get("acp-cursor")).toBe(0.75);
  });
});
