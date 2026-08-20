import { describe, expect, it } from "vitest";
import {
  lowestCostModelOption,
  rankAutoModelOptions,
  type AutoModelCandidate,
  type ReasoningLevel,
} from "./benchmarks.js";

function candidate(
  providerId: string,
  modelId: string,
  reasoningLevels: ReasoningLevel[],
): AutoModelCandidate {
  return {
    providerId,
    permissionModes: ["accept-edits", "full"],
    supportsServiceTier: providerId !== "claude-code",
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

const ALL_REASONING: ReasoningLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

describe("rankAutoModelOptions", () => {
  const guideCandidates = [
    candidate("codex", "gpt-5.6-luna", ALL_REASONING),
    candidate("codex", "gpt-5.6-sol", ALL_REASONING),
    candidate("acp-cursor", "grok-4.5", ["low", "medium", "high"]),
    candidate("claude-code", "claude-fable-5", ALL_REASONING),
  ];
  const fullQuota = new Map([
    ["codex", 1],
    ["acp-cursor", 1],
    ["claude-code", 1],
  ]);

  it.each([
    [1, "gpt-5.6-luna", "low"],
    [50, "gpt-5.6-luna", "high"],
    [75, "grok-4.5", "medium"],
    [100, "gpt-5.6-sol", "medium"],
  ] as const)(
    "follows the $ guide at difficulty %i",
    (difficulty, expectedModel, expectedReasoning) => {
      expect(
        rankAutoModelOptions({
          candidates: guideCandidates,
          difficulty,
          frugality: 0,
          quotaRemainingByProvider: fullQuota,
        })[0],
      ).toMatchObject({
        model: expectedModel,
        reasoningLevel: expectedReasoning,
      });
    },
  );

  it.each([
    [1, "grok-4.5", "medium"],
    [50, "gpt-5.6-sol", "high"],
    [75, "claude-fable-5", "high"],
    [100, "claude-fable-5", "max"],
  ] as const)(
    "follows the $$$ guide at difficulty %i",
    (difficulty, expectedModel, expectedReasoning) => {
      expect(
        rankAutoModelOptions({
          candidates: guideCandidates,
          difficulty,
          frugality: 100,
          quotaRemainingByProvider: fullQuota,
        })[0],
      ).toMatchObject({
        model: expectedModel,
        reasoningLevel: expectedReasoning,
      });
    },
  );

  it("never sends a minimum-difficulty task to the strongest option", () => {
    expect(
      rankAutoModelOptions({
        candidates: guideCandidates,
        difficulty: 1,
        frugality: 75,
        quotaRemainingByProvider: fullQuota,
      })[0],
    ).not.toMatchObject({ model: "claude-fable-5", reasoningLevel: "max" });
  });

  it("moves work away from a provider with scarce quota", () => {
    expect(
      rankAutoModelOptions({
        candidates: [
          candidate("codex", "gpt-5.6-luna", ALL_REASONING),
          candidate("acp-cursor", "composer-2.5", ["medium"]),
        ],
        difficulty: 50,
        frugality: 0,
        quotaRemainingByProvider: new Map([
          ["codex", 0.1],
          ["acp-cursor", 1],
        ]),
      })[0],
    ).toMatchObject({
      providerId: "acp-cursor",
      model: "composer-2.5",
      reasoningLevel: "medium",
    });
  });

  it("does not invent scores for unmeasured models", () => {
    expect(
      rankAutoModelOptions({
        candidates: [candidate("codex", "gpt-5.4-mini", ALL_REASONING)],
        difficulty: 0,
        frugality: 50,
        quotaRemainingByProvider: new Map([["codex", 1]]),
      }),
    ).toEqual([]);
  });
});

describe("lowestCostModelOption", () => {
  it("chooses the least expensive scored option with quota", () => {
    expect(
      lowestCostModelOption({
        candidates: [
          candidate("acp-cursor", "composer-2.5", ["medium"]),
          candidate("codex", "gpt-5.6-luna", ["low", "medium"]),
          candidate("claude-code", "claude-sonnet-5", ["low"]),
        ],
        quotaRemainingByProvider: new Map([
          ["acp-cursor", 1],
          ["codex", 1],
          ["claude-code", 1],
        ]),
      }),
    ).toMatchObject({
      providerId: "codex",
      model: "gpt-5.6-luna",
      reasoningLevel: "low",
      costPerTask: 0.16,
    });
  });

  it("excludes providers without remaining quota", () => {
    expect(
      lowestCostModelOption({
        candidates: [
          candidate("acp-cursor", "composer-2.5", ["medium"]),
          candidate("codex", "gpt-5.6-luna", ["low"]),
        ],
        quotaRemainingByProvider: new Map([
          ["acp-cursor", 1],
          ["codex", 0],
        ]),
      }),
    ).toMatchObject({ providerId: "acp-cursor", model: "composer-2.5" });
  });
});
