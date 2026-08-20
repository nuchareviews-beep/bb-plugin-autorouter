import { z } from "zod";

export const AUTOMATIC_DECISION_AGENT = "automatic";

export const autorouterSettingsSchema = z
  .object({
    decisionAgent: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (value) =>
          value === AUTOMATIC_DECISION_AGENT || /^[^/]+\/[^/]+$/u.test(value),
        "Decision agent must be 'automatic' or use provider/model format",
      ),
    customInstructions: z.string().max(12_000),
    frugality: z.number().int().min(0).max(100),
  })
  .strict();

export const autorouterSettingsPatchSchema = autorouterSettingsSchema.partial();

export type AutorouterSettings = z.infer<typeof autorouterSettingsSchema>;

export const defaultAutorouterSettings: AutorouterSettings = {
  decisionAgent: AUTOMATIC_DECISION_AGENT,
  customInstructions: "",
  frugality: 50,
};

export function parseStoredSettings(value: unknown): AutorouterSettings {
  // `enabled` was removed in v0.3. Loading the plugin now determines whether
  // routing is available, but retain the rest of existing users' settings.
  const settings =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== "enabled"),
        )
      : value;
  const parsed = autorouterSettingsSchema.safeParse(settings);
  return parsed.success ? parsed.data : defaultAutorouterSettings;
}
