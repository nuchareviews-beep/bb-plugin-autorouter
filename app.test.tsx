// @vitest-environment jsdom
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it } from "vitest";

describe("Autorouter app", () => {
  it("registers its routing page and settings section", async () => {
    const app = await loadPluginApp(() => import("./app.js"));

    expect(app.homepageSections).toEqual([]);
    expect(app.navPanels.map((slot) => slot.id)).toEqual(["autorouter"]);
    expect(app.settingsSections.map((slot) => slot.id)).toEqual([
      "autorouter-settings",
    ]);
  });
});
