import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SungrowAdapter, toEnergyData } from "./SungrowAdapter.ts";
import type { SungrowClient } from "./SungrowClient.ts";

// Shape captured from a live PV-only account: values are strings and absent
// data is the literal "--".
const pvOnlyPayload = {
  curr_power: { unit: "W", value: "0" },
  pv_power_map_virgin: { unit: "W", value: "0" },
  power_grid_power_map_virgin: { unit: "W", value: "--" },
  load_energy_map: { unit: "", value: "--" },
  charging_discharging_power_map: { unit: "", value: "--" },
  battery_level_percent: "--",
};

const fullPayload = {
  curr_power: { unit: "W", value: "3100" },
  pv_power_map_virgin: { unit: "W", value: "3200.5" },
  power_grid_power_map_virgin: { unit: "W", value: "-900" },
  load_energy_map: { unit: "W", value: "2300" },
  charging_discharging_power_map: { unit: "W", value: "500" },
  battery_level_percent: "87",
};

describe("toEnergyData", () => {
  it("reads solar production from pv_power_map_virgin, rounded to watts", () => {
    expect(toEnergyData(fullPayload).solarProductionW).toBe(3201);
  });

  it("falls back to curr_power when pv_power_map_virgin is absent", () => {
    const d = toEnergyData({ curr_power: { unit: "W", value: "1500" } });
    expect(d.solarProductionW).toBe(1500);
  });

  it("treats -- as missing and yields zeros, not NaN, on a PV-only site", () => {
    const d = toEnergyData(pvOnlyPayload);
    expect(d.solarProductionW).toBe(0);
    expect(d.gridPowerW).toBe(0);
    expect(d.homeConsumptionW).toBe(0);
  });

  it("reports battery fields as null when absent", () => {
    const d = toEnergyData(pvOnlyPayload);
    expect(d.batteryPowerW).toBe(null);
    expect(d.batterySoc).toBe(null);
  });

  it("maps battery fields when the site has a battery", () => {
    const d = toEnergyData(fullPayload);
    expect(d.batteryPowerW).toBe(500);
    expect(d.batterySoc).toBe(87);
  });

  it("maps grid and load when a meter is present", () => {
    const d = toEnergyData(fullPayload);
    expect(d.gridPowerW).toBe(-900);
    expect(d.homeConsumptionW).toBe(2300);
  });

  it("never reports gridVoltageV, which the payload does not carry", () => {
    expect(toEnergyData(fullPayload).gridVoltageV).toBe(null);
  });

  it("stamps lastUpdated as an ISO timestamp", () => {
    expect(toEnergyData(fullPayload).lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("survives a completely empty payload", () => {
    const d = toEnergyData({});
    expect(d.solarProductionW).toBe(0);
    expect(d.batterySoc).toBe(null);
  });
});

describe("SungrowAdapter", () => {
  function fakeClient(detail: Record<string, unknown>): SungrowClient {
    return {
      getPlantDetail: () => Promise.resolve(detail),
    } as unknown as SungrowClient;
  }

  it("polls every 60 seconds", () => {
    expect(new SungrowAdapter(fakeClient({}), "1").pollIntervalSeconds())
      .toBe(60);
  });

  it("returns mapped realtime data", async () => {
    const adapter = new SungrowAdapter(fakeClient(fullPayload), "1198878");
    expect((await adapter.getRealtimeData()).solarProductionW).toBe(3201);
  });

  it("reports device info using the plant name when known", async () => {
    const adapter = new SungrowAdapter(fakeClient({}), "1198878", "Home");
    const info = await adapter.getDeviceInfo();
    expect(info.name).toBe("Home");
  });

  it("falls back to the plant id when no name is known", async () => {
    const info = await new SungrowAdapter(fakeClient({}), "1198878")
      .getDeviceInfo();
    expect(info.name).toContain("1198878");
  });
});
