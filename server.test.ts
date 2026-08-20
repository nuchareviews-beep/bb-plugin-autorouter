import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server.js";

describe("Autorouter plugin", () => {
  it("registers RPC and autosaved settings storage", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "autorouter" });
    await plugin(bb);

    expect(await harness.behavior.callRpc("getSettings", null)).toMatchObject({
      enabled: true,
      frugality: 50,
      decisionAgent: "automatic",
    });
    expect(
      await harness.behavior.callRpc("updateSettings", { frugality: 75 }),
    ).toMatchObject({ frugality: 75 });
    expect(await harness.behavior.callRpc("getSettings", null)).toMatchObject({
      frugality: 75,
    });
    expect(harness.inspection.registrations.cli?.name).toBe("autorouter");

    await harness.lifecycle.dispose();
  });
});
