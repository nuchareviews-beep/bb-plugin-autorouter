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

export const BAND_COMPARATORS = ["<=", "<", ">=", ">", "=="] as const;
const bandComparatorSchema = z.enum(BAND_COMPARATORS);
export type BandComparator = z.infer<typeof bandComparatorSchema>;
export const DEFAULT_BAND_COMPARATOR: BandComparator = "<=";

const difficultyBandSchema = z
  .object({
    /** This band applies to tasks whose difficulty (0-100) satisfies
     * `difficulty <comparator> maxDifficulty` — e.g. "<=" (the default,
     * matches the plugin's original hardcoded behavior), or ">=" for a
     * "difficulty at least this high" band, "==" for an exact score, etc.
     * The field is still named maxDifficulty for backward compatibility
     * with existing stored settings; with a non-"<=" comparator it's really
     * just "the band's threshold value". */
    maxDifficulty: z.number().int().min(0).max(100),
    comparator: bandComparatorSchema,
    /** Ordered provider (or provider/model) preferences tried for tasks in
     * this band, before falling through to the next band or the normal
     * benchmark-ranked path. */
    fallbackChain: z.array(providerOrModelSchema).max(20),
  })
  .strict();

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
     * Per-difficulty model selection. Bands are checked low-to-high by
     * `maxDifficulty`; the first band covering a task's difficulty score
     * routes through that band's own fallback chain instead of the normal
     * CursorBench-driven ranking. Empty by default in the stock schema
     * default, but the shipped default settings below reproduce the plugin's
     * previous hardcoded "simple task" behavior as a plain, editable band —
     * add, remove, reorder, or clear bands freely.
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
      maxDifficulty: 25,
      comparator: DEFAULT_BAND_COMPARATOR,
      fallbackChain: ["antigravity", "codex", "claude-code"],
    },
  ],
  customInstructions: "",
  frugality: 50,
};

/**
 * Backfills fields added to nested band objects after settings were first
 * stored (e.g. `comparator`), so a top-level merge with defaults doesn't
 * still fail on an old band shape. Only touches what's missing; a band that
 * already has its own comparator is left alone.
 */
function migrateStoredValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.difficultyBands)) return record;
  return {
    ...record,
    difficultyBands: record.difficultyBands.map((band) =>
      typeof band === "object" && band !== null && !("comparator" in band)
        ? { ...band, comparator: DEFAULT_BAND_COMPARATOR }
        : band,
    ),
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
