import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SungrowPlugin } from "./SungrowPlugin.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";

function makeDeps(config: Record<string, string>): PluginDependencies {
  return {
    log: { info() {}, warn() {}, error() {}, debug() {} },
    dbLog: { info() {}, warn() {}, error() {} },
    getConfig: (key: string) => Promise.resolve(config[key] ?? ""),
    getSecret: (key: string) => Promise.resolve(config[key] ?? ""),
  } as unknown as PluginDependencies;
}

describe("SungrowPlugin", () => {
  it("identifies itself with the agreed ids", () => {
    const plugin = new SungrowPlugin(makeDeps({}));
    expect(plugin.id).toBe("sungrow_isolarcloud");
    expect(plugin.vendor).toBe("Sungrow");
    expect(plugin.settingsComponentKey).toBe("sungrow-isolarcloud-config");
  });

  it("marks password as the only secret", () => {
    expect([...new SungrowPlugin(makeDeps({})).secretKeys]).toEqual([
      "password",
    ]);
  });

  it("refuses to build an adapter when config is incomplete", async () => {
    const plugin = new SungrowPlugin(makeDeps({ email: "a@b.c" }));
    await expect(plugin.createAdapter()).rejects.toThrow(
      "Sungrow iSolarCloud credentials incomplete",
    );
  });

  it("builds an adapter when config is complete", async () => {
    const plugin = new SungrowPlugin(
      makeDeps({
        email: "a@b.c",
        password: "pw",
        region: "europe",
        ps_id: "1198878",
      }),
    );
    const adapter = await plugin.createAdapter();
    expect(adapter.pollIntervalSeconds()).toBe(60);
  });

  it("reports a failed plant listing as an error result, not a throw", async () => {
    const plugin = new SungrowPlugin(makeDeps({}));
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("network down"));
    try {
      const result = await plugin.listPlants("a@b.c", "pw", "europe");
      expect(result.success).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
