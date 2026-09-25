import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Sungrow iSolarCloud plugin config section ───────────────────────────────
// Keys are relative — PluginDependencies prefixes them with the plugin id.

export const sungrowConfigDef = defineSection({
  sungrowEmail: { key: "email", schema: z.string(), default: "" },
  sungrowPassword: { key: "password", schema: z.string(), default: "" },
  sungrowRegion: { key: "region", schema: z.string(), default: "europe" },
  sungrowPsId: { key: "ps_id", schema: z.string(), default: "" },
});

export type SungrowConfig = SectionType<typeof sungrowConfigDef>;

export type SungrowConfigKey = SectionKeys<typeof sungrowConfigDef>;

export const SUNGROW_SECRET_KEYS: readonly SungrowConfigKey[] = [
  "password",
] as const satisfies readonly SungrowConfigKey[];
