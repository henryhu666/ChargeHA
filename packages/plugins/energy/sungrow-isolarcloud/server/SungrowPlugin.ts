import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/shared/plugins";
import { SUNGROW_SECRET_KEYS, sungrowConfigDef } from "./config.ts";
import { SungrowAdapter } from "./SungrowAdapter.ts";
import { SungrowClient, type SungrowPlantSummary } from "./SungrowClient.ts";
import { type SungrowRegion, SUNGROW_SERVERS } from "./SungrowProtocol.ts";
import { createSungrowRouter } from "./router.ts";

export type SungrowUiResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string };

// deps.getConfig returns the raw stored string, or null when never set.
function asRegion(raw: string | null): SungrowRegion {
  return raw !== null && raw in SUNGROW_SERVERS
    ? raw as SungrowRegion
    : "europe";
}

/** Sungrow iSolarCloud energy plugin — cloud readings for Sungrow inverters. */
export class SungrowPlugin implements EnergyPlugin {
  readonly id = "sungrow_isolarcloud";
  readonly displayName = "Sungrow (Cloud / iSolarCloud)";
  readonly vendor = "Sungrow";
  readonly settingsComponentKey = "sungrow-isolarcloud-config";
  readonly configDef = sungrowConfigDef;
  readonly secretKeys = SUNGROW_SECRET_KEYS;

  // Wizard clicks reuse one session instead of logging in per request —
  // repeated logins count against a lockout counter.
  private uiSession: { key: string; client: SungrowClient } | null = null;

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Sungrow iSolarCloud plugin initialized");
  }

  private clientFor(
    email: string,
    password: string,
    region: string,
  ): SungrowClient {
    const key = `${email}\n${password}\n${region}`;
    if (this.uiSession?.key !== key) {
      this.uiSession = {
        key,
        client: new SungrowClient(
          asRegion(region),
          email,
          password,
          this.deps.log,
        ),
      };
    }
    return this.uiSession.client;
  }

  async listPlants(
    email: string,
    password: string,
    region: string,
  ): Promise<SungrowUiResult<{ plants: SungrowPlantSummary[] }>> {
    this.deps.log.info(`iSolarCloud (ui) listPlants requested (${region})`);
    try {
      const plants = await this.clientFor(email, password, region).getPlants();
      this.deps.log.info(`iSolarCloud (ui) listPlants → ${plants.length} plant(s)`);
      return { success: true, plants };
    } catch (err) {
      this.deps.log.warn(`iSolarCloud (ui) listPlants failed: ${err}`);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Login failed",
      };
    }
  }

  async testConnection(
    email: string,
    password: string,
    region: string,
    psId: string,
  ): Promise<SungrowUiResult<{ systemName: string }>> {
    this.deps.log.info(`iSolarCloud (ui) testConnection for plant ${psId}`);
    try {
      const client = this.clientFor(email, password, region);
      const plants = await client.getPlants();
      const match = plants.find((p) => p.psId === psId);
      await client.getPlantDetail(psId);
      const systemName = match?.name ?? psId;
      this.deps.log.info(`iSolarCloud (ui) testConnection ok — ${systemName}`);
      return { success: true, systemName };
    } catch (err) {
      this.deps.log.warn(`iSolarCloud (ui) testConnection failed: ${err}`);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    const email = await this.deps.getConfig("email");
    const password = await this.deps.getSecret("password");
    const region = await this.deps.getConfig("region");
    const psId = await this.deps.getConfig("ps_id");
    if (!email || !password || !psId) {
      throw new Error("Sungrow iSolarCloud credentials incomplete");
    }
    return new SungrowAdapter(
      new SungrowClient(asRegion(region), email, password, this.deps.log),
      psId,
    );
  }

  shutdown(): Promise<void> {
    this.uiSession = null;
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return createSungrowRouter(this.deps, this);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
