import { z } from "zod";

export const AUTOMATIC_DECISION_AGENT = "automatic";

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
    customInstructions: z.string().max(12_000),
    frugality: z.number().int().min(0).max(100),
  })
  .strict();

export const autorouterSettingsPatchSchema = autorouterSettingsSchema.partial();

export type AutorouterSettings = z.infer<typeof autorouterSettingsSchema>;

export const defaultAutorouterSettings: AutorouterSettings = {
  enabled: true,
  decisionAgent: AUTOMATIC_DECISION_AGENT,
  customInstructions: "",
  frugality: 50,
};

export function parseStoredSettings(value: unknown): AutorouterSettings {
  const parsed = autorouterSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultAutorouterSettings;
}
