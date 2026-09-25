import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { SUNGROW_SECRET_KEYS, sungrowConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { SungrowPlugin } from "./SungrowPlugin.ts";

// ── Typed Zod schemas for Sungrow plugin procedures ─────────────────────────

const credentialsInput = z.object({
  email: z.string(),
  password: z.string(),
  region: z.string(),
});

const testConnectionInput = credentialsInput.extend({ psId: z.string() });

// ── Sungrow iSolarCloud plugin tRPC router ──────────────────────────────────

export function createSungrowRouter(
  deps: PluginDependencies,
  plugin: Pick<SungrowPlugin, "listPlants" | "testConnection">,
) {
  return router({
    ...createPluginConfigProcedures(
      deps,
      sungrowConfigDef,
      SUNGROW_SECRET_KEYS,
    ),

    listPlants: publicProcedure
      .input(credentialsInput)
      .mutation(({ input }) =>
        plugin.listPlants(input.email, input.password, input.region)
      ),

    testConnection: publicProcedure
      .input(testConnectionInput)
      .mutation(({ input }) =>
        plugin.testConnection(
          input.email,
          input.password,
          input.region,
          input.psId,
        )
      ),
  });
}
