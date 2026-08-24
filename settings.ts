import { z } from "zod";

export const AUTOMATIC_DECISION_AGENT = "automatic";

const providerModelSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^/]+\/[^/]+$/u, "Must use provider/model format");

/** A fallback-chain entry: a bare provider id (any/default model from that
 * provider) or a provider/model pin. */
const providerOrModelSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^/]+(\/[^/]+)?$/u, "Must be provider or provider/model");

const difficultyBoundSchema = z.number().int().min(0).max(100).nullable();

const difficultyBandSchema = z
  .object({
    /** Inclusive lower bound (0-100); null = unbounded below (matches down
     * to 0). A band with `minDifficulty === maxDifficulty` matches an exact
     * score. */
    minDifficulty: difficultyBoundSchema,
    /** Inclusive upper bound (0-100); null = unbounded above (matches up to
     * 100). */
    maxDifficulty: difficultyBoundSchema,
    /** Ordered provider (or provider/model) preferences tried for tasks in
     * this band, before falling through to the next band or the normal
     * benchmark-ranked path. */
    fallbackChain: z.array(providerOrModelSchema).max(20),
  })
  .strict()
  .refine(
    (band) =>
      band.minDifficulty === null ||
      band.maxDifficulty === null ||
      band.minDifficulty <= band.maxDifficulty,
    { message: "minDifficulty must be <= maxDifficulty", path: ["minDifficulty"] },
  );

export type DifficultyBand = z.infer<typeof difficultyBandSchema>;

export const autorouterSettingsSchema = z
  .object({
    enabled: z.boolean(),
    decisionAgent: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (value) =>
          value === AUTOMATIC_DECISION_AGENT || /^[^/]+\/[^/]+$/u.test(value),
        "Decision agent must be 'automatic' or use provider/model format",
      ),
    /**
     * Ordered provider/model preference list tried, in order, when
     * `decisionAgent` is `"automatic"`. Not opinionated by default beyond
     * matching pre-existing behavior: the stock default reproduces the
     * chain this plugin used to hardcode (Cursor -> Codex), but it's a
     * plain user setting now — reorder, add, or clear it freely. If none
     * of these are available, the classifier falls back to any launchable
     * model, then the first available candidate; that fallback is a
     * last-resort safety net, not a preference, so it isn't user-facing.
     */
    automaticFallbackChain: z.array(providerModelSchema).max(20),
    /**
     * Per-difficulty model selection: native two-sided ranges. Bands are
     * checked low-to-high by their effective lower bound; the first band
     * whose [minDifficulty, maxDifficulty] range covers a task's difficulty
     * score routes through that band's own fallback chain instead of the
     * normal CursorBench-driven ranking. Empty by default in the stock
     * schema default, but the shipped default settings below reproduce the
     * plugin's previous hardcoded "simple task" behavior as a plain,
     * editable band — add, remove, reorder, or clear bands freely.
     */
    difficultyBands: z.array(difficultyBandSchema).max(20),
    customInstructions: z.string().max(12_000),
    frugality: z.number().int().min(0).max(100),
  })
  .strict();

export const autorouterSettingsPatchSchema = autorouterSettingsSchema.partial();

export type AutorouterSettings = z.infer<typeof autorouterSettingsSchema>;

export const defaultAutorouterSettings: AutorouterSettings = {
  enabled: true,
  decisionAgent: AUTOMATIC_DECISION_AGENT,
  automaticFallbackChain: ["acp-cursor/gpt-5.6-sol-medium", "codex/gpt-5.6-luna"],
  difficultyBands: [
    {
      minDifficulty: null,
      maxDifficulty: 25,
      fallbackChain: ["antigravity", "codex", "claude-code"],
    },
  ],
  customInstructions: "",
  frugality: 50,
};

/**
 * Converts a band stored in an older shape into the current
 * `{ minDifficulty, maxDifficulty }` range shape. Two prior shapes existed:
 *   1. `{ maxDifficulty, fallbackChain }` (pre-comparator; implicitly "<=")
 *   2. `{ maxDifficulty, comparator, fallbackChain }` (single-sided compare)
 * A band that already has `minDifficulty` is the current shape and is
 * returned unchanged.
 */
function migrateBand(band: unknown): unknown {
  if (typeof band !== "object" || band === null) return band;
  const record = band as Record<string, unknown>;
  if ("minDifficulty" in record) return record;
  const comparator = typeof record.comparator === "string" ? record.comparator : "<=";
  const threshold = typeof record.maxDifficulty === "number" ? record.maxDifficulty : 100;
  const range = ((): { minDifficulty: number | null; maxDifficulty: number | null } => {
    switch (comparator) {
      case "<":
        return { minDifficulty: null, maxDifficulty: Math.max(0, threshold - 1) };
      case ">=":
        return { minDifficulty: threshold, maxDifficulty: null };
      case ">":
        return { minDifficulty: Math.min(100, threshold + 1), maxDifficulty: null };
      case "==":
        return { minDifficulty: threshold, maxDifficulty: threshold };
      default: // "<=" (or an unrecognized legacy value; fail safe to the original default)
        return { minDifficulty: null, maxDifficulty: threshold };
    }
  })();
  return { fallbackChain: record.fallbackChain, ...range };
}

/**
 * Backfills fields added or reshaped since settings were first stored, so a
 * top-level merge with defaults doesn't still fail on an old band shape.
 */
function migrateStoredValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.difficultyBands)) return record;
  return {
    ...record,
    difficultyBands: record.difficultyBands.map(migrateBand),
  };
}

export function parseStoredSettings(value: unknown): AutorouterSettings {
  const parsed = autorouterSettingsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Merge with defaults before giving up, so settings stored before a field
  // was added (e.g. automaticFallbackChain, or a band's comparator) don't
  // get silently wiped back to every default — only the genuinely new or
  // invalid keys fall back.
  const migrated = migrateStoredValue(value);
  const merged = autorouterSettingsSchema.safeParse({
    ...defaultAutorouterSettings,
    ...(typeof migrated === "object" && migrated !== null ? migrated : {}),
  });
  return merged.success ? merged.data : defaultAutorouterSettings;
}
