import {
  defineRpcContract,
  type BbPluginApi,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createRoutedThread, resolveDecisionAgentLabel } from "./router.js";
import {
  autorouterSettingsPatchSchema,
  autorouterSettingsSchema,
  defaultAutorouterSettings,
  parseStoredSettings,
  type AutorouterSettings,
} from "./settings.js";

const SETTINGS_KEY = "settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNewThreadRequest(value: unknown): value is NewThreadRequest {
  if (!isRecord(value) || !isRecord(value.environment)) return false;
  return (
    typeof value.projectId === "string" &&
    typeof value.providerId === "string" &&
    typeof value.model === "string" &&
    typeof value.reasoningLevel === "string" &&
    typeof value.permissionMode === "string" &&
    typeof value.environment.type === "string" &&
    Array.isArray(value.input)
  );
}

const newThreadRequestSchema = z.custom<NewThreadRequest>(
  isNewThreadRequest,
  "Invalid new-thread request",
);

const reasoningLevelSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultra",
]);

const routeResultSchema = z
  .object({
    benchmarkScore: z.number().nullable(),
    costPerTask: z.number().nullable(),
    difficulty: z.number().int().min(0).max(100),
    frugality: z.number().int().min(0).max(100),
    model: z.string(),
    overrideApplied: z.boolean(),
    permissionMode: z.enum(["accept-edits", "auto", "full"]),
    providerId: z.string(),
    reasoningLevel: reasoningLevelSchema,
    supportsServiceTier: z.boolean(),
    threadId: z.string(),
  })
  .strict();

export const rpcContract = defineRpcContract({
  getSettings: {
    input: z.null(),
    output: autorouterSettingsSchema,
  },
  getDecisionAgentLabel: {
    input: z.null(),
    output: z.string(),
  },
  updateSettings: {
    input: autorouterSettingsPatchSchema,
    output: autorouterSettingsSchema,
  },
  createThread: {
    input: z.object({ request: newThreadRequestSchema }).strict(),
    output: routeResultSchema,
  },
});

function formatSettings(settings: AutorouterSettings, json: boolean): string {
  if (json) return `${JSON.stringify(settings)}\n`;
  return [
    `Frugality: ${settings.frugality}/100 ($ -> $$$)`,
    `Decision agent: ${settings.decisionAgent}`,
    `Custom instructions: ${settings.customInstructions || "(none)"}`,
    "",
  ].join("\n");
}

export default async function plugin(bb: BbPluginApi) {
  async function readSettings(): Promise<AutorouterSettings> {
    return parseStoredSettings(await bb.storage.kv.get(SETTINGS_KEY));
  }

  async function updateSettings(
    patch: Partial<AutorouterSettings>,
  ): Promise<AutorouterSettings> {
    const next = autorouterSettingsSchema.parse({
      ...(await readSettings()),
      ...patch,
    });
    await bb.storage.kv.set(SETTINGS_KEY, next);
    bb.realtime.publish("settings-changed", next);
    return next;
  }

  if ((await bb.storage.kv.get(SETTINGS_KEY)) === undefined) {
    await bb.storage.kv.set(SETTINGS_KEY, defaultAutorouterSettings);
  }

  bb.rpc.register(rpcContract, {
    getSettings: readSettings,
    getDecisionAgentLabel: async () =>
      resolveDecisionAgentLabel(bb, await readSettings()),
    updateSettings,
    createThread: async ({ request }) =>
      createRoutedThread(bb, request, await readSettings()),
  });

  bb.cli.register({
    name: "autorouter",
    summary: "Route new bb threads by difficulty, quota, and model cost",
    commands: [
      {
        name: "status",
        summary: "Show Autorouter settings",
        usage: "bb autorouter status [--json]",
      },
      {
        name: "config",
        summary: "Update Autorouter settings",
        usage:
          "bb autorouter config [--frugality 0-100] [--decision-agent automatic|provider/model] [--instructions text] [--json]",
      },
      {
        name: "route",
        summary: "Create an automatically routed thread in the current project",
        usage: "bb autorouter route --prompt <text> [--json]",
      },
    ],
    async run(argv, ctx) {
      const args = [...argv];
      const jsonIndex = args.indexOf("--json");
      const json = jsonIndex >= 0;
      if (json) args.splice(jsonIndex, 1);
      const command = args.shift() ?? "status";

      try {
        if (command === "status") {
          return {
            exitCode: 0,
            stdout: formatSettings(await readSettings(), json),
          };
        }

        if (command === "config") {
          const patch: Partial<AutorouterSettings> = {};
          while (args.length > 0) {
            const flag = args.shift();
            const value = args.shift();
            if (!flag || value === undefined) {
              throw new Error(
                `Missing value for ${flag ?? "configuration flag"}`,
              );
            }
            if (flag === "--frugality") patch.frugality = Number(value);
            else if (flag === "--decision-agent") patch.decisionAgent = value;
            else if (flag === "--instructions")
              patch.customInstructions = value;
            else throw new Error(`Unknown config flag: ${flag}`);
          }
          const parsedPatch = autorouterSettingsPatchSchema.parse(patch);
          return {
            exitCode: 0,
            stdout: formatSettings(await updateSettings(parsedPatch), json),
          };
        }

        if (command === "route") {
          if (!ctx.projectId) {
            throw new Error("Run this command from a bb project thread");
          }
          const promptFlag = args.indexOf("--prompt");
          const prompt =
            promptFlag >= 0
              ? args[promptFlag + 1]
              : args.filter((arg) => !arg.startsWith("--")).join(" ");
          if (!prompt?.trim()) throw new Error("Provide --prompt <text>");

          let environment: NewThreadRequest["environment"] = {
            type: "project-default",
          };
          if (ctx.threadId) {
            const current = await bb.sdk.threads.get({
              threadId: ctx.threadId,
              signal: ctx.signal,
            });
            if (current.environmentId) {
              environment = {
                type: "reuse",
                environmentId: current.environmentId,
              };
            }
          }
          const result = await createRoutedThread(
            bb,
            {
              projectId: ctx.projectId,
              environment,
              input: [{ type: "text", text: prompt.trim(), mentions: [] }],
              providerId: "codex",
              model: "gpt-5.6-luna",
              reasoningLevel: "low",
              permissionMode: "auto",
              executionInputSources: {
                providerId: "explicit",
                model: "explicit",
                reasoningLevel: "explicit",
                permissionMode: "explicit",
              },
            },
            await readSettings(),
          );
          return {
            exitCode: 0,
            stdout: json
              ? `${JSON.stringify(result)}\n`
              : [
                  `Difficulty score: ${result.difficulty}/100`,
                  `Chosen agent: ${result.providerId}/${result.model} (${result.reasoningLevel})`,
                  `Thread: ${result.threadId}`,
                  "",
                ].join("\n"),
          };
        }

        throw new Error(`Unknown command: ${command}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          exitCode: 1,
          stderr: json
            ? `${JSON.stringify({ error: message })}\n`
            : `Autorouter: ${message}\n`,
        };
      }
    },
  });

  bb.log.info("Autorouter loaded");
}
