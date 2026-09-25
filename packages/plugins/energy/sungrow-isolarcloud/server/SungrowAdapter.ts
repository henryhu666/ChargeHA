import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { SungrowClient } from "./SungrowClient.ts";

// The cloud refreshes roughly every 5 minutes; 60s keeps us from sitting a
// full cycle stale without hammering the API.
const POLL_INTERVAL_SECONDS = 60;

/**
 * Read one numeric field. Values arrive as strings, usually wrapped as
 * `{ unit, value }`, and "no data" is the literal "--".
 */
function num(raw: unknown): number | null {
  const value = raw !== null && typeof raw === "object"
    ? (raw as Record<string, unknown>).value
    : raw;
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || text === "--") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** First non-null reading among the given keys. */
function firstNum(
  detail: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = num(detail[key]);
    if (value !== null) return value;
  }
  return null;
}

export function toEnergyData(detail: Record<string, unknown>): EnergyData {
  const solar = firstNum(detail, "pv_power_map_virgin", "curr_power") ?? 0;
  const grid = firstNum(detail, "power_grid_power_map_virgin") ?? 0;
  // No derivation when a meter is absent — a computed figure would be invented.
  const home = firstNum(detail, "load_energy_map") ?? 0;
  return {
    solarProductionW: Math.round(solar),
    gridPowerW: Math.round(grid),
    homeConsumptionW: Math.round(home),
    batteryPowerW: firstNum(detail, "charging_discharging_power_map"),
    batterySoc: firstNum(detail, "battery_level_percent"),
    gridVoltageV: null,
    sourceUpdatedAt: null,
    lastUpdated: new Date().toISOString(),
  };
}

export class SungrowAdapter implements EnergySourceAdapter {
  constructor(
    private readonly client: SungrowClient,
    private readonly psId: string,
    private readonly plantName?: string,
  ) {}

  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  async getRealtimeData(): Promise<EnergyData> {
    return toEnergyData(await this.client.getPlantDetail(this.psId));
  }

  getDeviceInfo(): Promise<DeviceInfo> {
    return Promise.resolve({
      id: this.psId,
      name: this.plantName ?? `Sungrow plant ${this.psId}`,
      manufacturer: "Sungrow",
      model: "iSolarCloud",
    });
  }

  pollIntervalSeconds(): number {
    return POLL_INTERVAL_SECONDS;
  }
}
