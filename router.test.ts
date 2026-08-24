import { describe, expect, it } from "vitest";
import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import { rankAutoModelOptions } from "./benchmarks.js";
import type { AutoModelCandidate, ReasoningLevel } from "./benchmarks.js";
import {
  fallbackSelection,
  isModelOverrideGrounded,
  leastClassifierPermissionMode,
  leastClassifierReasoning,
  matchModelOverride,
  parseDifficultyDecision,
  quotaRemainingByProvider,
  isRoutableProvider,
  difficultyBandSelection,
  bandMatchesDifficulty,
} from "./router.js";
import type { BandComparator } from "./settings.js";

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

describe("routable providers", () => {
  it("includes the local agy-backed Antigravity provider without broadening to OmniRoute", () => {
    expect(isRoutableProvider("antigravity")).toBe(true);
    expect(isRoutableProvider("omniroute")).toBe(false);
  });

  // Regression test: router.ts and benchmarks.ts each used to hardcode their
  // own separate provider allowlist. Adding Antigravity to router.ts's copy
  // (the one isRoutableProvider reads) left it eligible for thread creation
  // but silently excluded from rankAutoModelOptions's *own* copy in
  // benchmarks.ts, so it was never actually selected outside total
  // benchmarked-provider exhaustion -- confirmed live against a running bb
  // instance (bb autorouter route), not just inferred from reading the code.
  // Both files now read the same ROUTABLE_PROVIDER_IDS from benchmarks.ts.
  it("is honored identically by rankAutoModelOptions, not just candidate discovery", () => {
    const antigravityOnly = [
      candidate("antigravity", "gemini-3.7-flash-high", ["medium"]),
    ];
    expect(
      rankAutoModelOptions({
        candidates: antigravityOnly,
        difficulty: 50,
        frugality: 50,
        quotaRemainingByProvider: new Map([["antigravity", 1]]),
      }),
    ).toEqual([]); // no CursorBench entry exists for it -- correctly unscored, not fabricated
  });

  it("still gets a real routed thread via fallbackSelection when it's the only eligible candidate", () => {
    // This is the actual condition under which Antigravity gets chosen in
    // practice: every benchmarked provider (Codex, Claude Code, Cursor) is
    // unavailable or quota-exhausted, so rankAutoModelOptions returns no
    // ranked option and resolveRoute falls through to fallbackSelection.
    const request = {
      providerId: "codex",
      model: "gpt-5.6-sol",
      permissionMode: "accept-edits",
    } as unknown as NewThreadRequest;
    const route = fallbackSelection(
      [candidate("antigravity", "gemini-3.7-flash-high", ["medium"])],
      request,
      50,
      50,
      false,
    );
    expect(route).toMatchObject({
      providerId: "antigravity",
      model: "gemini-3.7-flash-high",
      benchmarkScore: null,
    });
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

describe("leastClassifierPermissionMode", () => {
  it("prefers accept-edits over the more permissive presets", () => {
    expect(leastClassifierPermissionMode(["full", "auto", "accept-edits"])).toBe(
      "accept-edits",
    );
  });

  it("falls back to auto before full when accept-edits is unsupported", () => {
    expect(leastClassifierPermissionMode(["full", "auto"])).toBe("auto");
  });

  it("uses accept-edits when a provider advertises nothing", () => {
    expect(leastClassifierPermissionMode([])).toBe("accept-edits");
  });
});

describe("per-difficulty band selection", () => {
  const request = {
    providerId: "codex",
    model: "gpt-5.6-sol",
    permissionMode: "accept-edits",
  } as unknown as NewThreadRequest;
  const allThree = [
    candidate("antigravity", "gemini-3.7-flash-high", ["medium"]),
    candidate("codex", "gpt-5.6-luna", ["low", "medium"]),
    candidate("claude-code", "claude-fable-5", ["low", "medium"]),
  ];
  const fullQuota = new Map([
    ["antigravity", 1],
    ["codex", 1],
    ["claude-code", 1],
  ]);
  // Reproduces the plugin's previous hardcoded simple-task band, now as
  // plain settings data instead of constants baked into router.ts.
  const simpleTaskBand = [
    { maxDifficulty: 25, comparator: "<=" as const, fallbackChain: ["antigravity", "codex", "claude-code"] },
  ];

  it("prefers Antigravity for a simple task when it's available", () => {
    expect(
      difficultyBandSelection(allThree, fullQuota, request, 10, 50, false, simpleTaskBand),
    ).toMatchObject({ providerId: "antigravity" });
  });

  it("falls back to Codex when Antigravity has no candidates", () => {
    const withoutAntigravity = allThree.filter(
      (candidate) => candidate.providerId !== "antigravity",
    );
    expect(
      difficultyBandSelection(
        withoutAntigravity,
        fullQuota,
        request,
        10,
        50,
        false,
        simpleTaskBand,
      ),
    ).toMatchObject({ providerId: "codex" });
  });

  it("falls back to Claude Code when Antigravity and Codex are both unavailable", () => {
    const onlyClaude = allThree.filter(
      (candidate) => candidate.providerId === "claude-code",
    );
    expect(
      difficultyBandSelection(onlyClaude, fullQuota, request, 10, 50, false, simpleTaskBand),
    ).toMatchObject({ providerId: "claude-code" });
  });

  it("respects quota exhaustion, not just candidate presence", () => {
    const antigravityOutOfQuota = new Map([
      ["antigravity", 0],
      ["codex", 1],
      ["claude-code", 1],
    ]);
    expect(
      difficultyBandSelection(
        allThree,
        antigravityOutOfQuota,
        request,
        10,
        50,
        false,
        simpleTaskBand,
      ),
    ).toMatchObject({ providerId: "codex" });
  });

  it("does not apply above the band's difficulty threshold", () => {
    expect(
      difficultyBandSelection(allThree, fullQuota, request, 30, 50, false, simpleTaskBand),
    ).toBeNull();
  });

  it("returns null (defer to benchmark ranking) when none of the chain is eligible", () => {
    const onlyCursor = [candidate("acp-cursor", "composer-2.5", ["medium"])];
    expect(
      difficultyBandSelection(onlyCursor, fullQuota, request, 10, 50, false, simpleTaskBand),
    ).toBeNull();
  });

  it("returns null when no band covers the task's difficulty", () => {
    expect(
      difficultyBandSelection(allThree, fullQuota, request, 10, 50, false, []),
    ).toBeNull();
  });

  it("picks the lowest-threshold band that still covers the difficulty, checked ascending", () => {
    const bands = [
      { maxDifficulty: 80, comparator: "<=" as const, fallbackChain: ["claude-code"] },
      { maxDifficulty: 20, comparator: "<=" as const, fallbackChain: ["antigravity"] },
    ];
    expect(
      difficultyBandSelection(allThree, fullQuota, request, 15, 50, false, bands),
    ).toMatchObject({ providerId: "antigravity" });
  });

  it("pins an exact provider/model chain entry, not just a bare provider", () => {
    const bands = [{ maxDifficulty: 25, comparator: "<=" as const, fallbackChain: ["codex/gpt-5.6-luna"] }];
    const withExtraCodexModel = [
      ...allThree,
      candidate("codex", "gpt-5.6-sol", ["medium"]),
    ];
    const result = difficultyBandSelection(
      withExtraCodexModel,
      fullQuota,
      request,
      10,
      50,
      false,
      bands,
    );
    expect(result).toMatchObject({ providerId: "codex", model: "gpt-5.6-luna" });
  });
});

describe("bandMatchesDifficulty (configurable comparator)", () => {
  const band = (comparator: BandComparator, maxDifficulty: number) => ({
    maxDifficulty,
    comparator,
    fallbackChain: [],
  });

  it("<= (default) matches at and below the threshold only", () => {
    expect(bandMatchesDifficulty(25, band("<=", 25))).toBe(true);
    expect(bandMatchesDifficulty(24, band("<=", 25))).toBe(true);
    expect(bandMatchesDifficulty(26, band("<=", 25))).toBe(false);
  });

  it("< matches strictly below the threshold", () => {
    expect(bandMatchesDifficulty(25, band("<", 25))).toBe(false);
    expect(bandMatchesDifficulty(24, band("<", 25))).toBe(true);
  });

  it(">= matches at and above the threshold", () => {
    expect(bandMatchesDifficulty(75, band(">=", 75))).toBe(true);
    expect(bandMatchesDifficulty(74, band(">=", 75))).toBe(false);
    expect(bandMatchesDifficulty(90, band(">=", 75))).toBe(true);
  });

  it("> matches strictly above the threshold", () => {
    expect(bandMatchesDifficulty(75, band(">", 75))).toBe(false);
    expect(bandMatchesDifficulty(76, band(">", 75))).toBe(true);
  });

  it("== matches only the exact score", () => {
    expect(bandMatchesDifficulty(50, band("==", 50))).toBe(true);
    expect(bandMatchesDifficulty(49, band("==", 50))).toBe(false);
    expect(bandMatchesDifficulty(51, band("==", 50))).toBe(false);
  });

  it("difficultyBandSelection actually uses the configured comparator, not a hardcoded <=", () => {
    const request = {
      providerId: "codex",
      model: "gpt-5.6-sol",
      permissionMode: "accept-edits",
    } as unknown as NewThreadRequest;
    const highDifficultyOnly = [
      { maxDifficulty: 80, comparator: ">=" as const, fallbackChain: ["claude-code"] },
    ];
    const quota = new Map([["claude-code", 1]]);
    const claudeOnly = [candidate("claude-code", "claude-fable-5", ["medium"])];

    // A difficulty of 30 must NOT match a ">=80" band -- if the comparator
    // were still hardcoded to "<=", this would incorrectly match.
    expect(
      difficultyBandSelection(claudeOnly, quota, request, 30, 50, false, highDifficultyOnly),
    ).toBeNull();
    expect(
      difficultyBandSelection(claudeOnly, quota, request, 85, 50, false, highDifficultyOnly),
    ).toMatchObject({ providerId: "claude-code" });
  });
});
