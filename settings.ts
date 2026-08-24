import { z } from "zod";

export const AUTOMATIC_DECISION_AGENT = "automatic";

const providerModelSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^/]+\/[^/]+$/u, "Must use provider/model format");

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
  customInstructions: "",
  frugality: 50,
};

export function parseStoredSettings(value: unknown): AutorouterSettings {
  const parsed = autorouterSettingsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Merge with defaults before giving up, so settings stored before a field
  // was added (e.g. automaticFallbackChain) don't get silently wiped back
  // to every default — only the genuinely new/invalid keys fall back.
  const merged = autorouterSettingsSchema.safeParse({
    ...defaultAutorouterSettings,
    ...(typeof value === "object" && value !== null ? value : {}),
  });
  return merged.success ? merged.data : defaultAutorouterSettings;
}
