import type { PluginStepDef } from "../../../hostUi.ts";
import type { EnergyPluginOption } from "../../../pluginOptions.ts";
import { sungrowSetupStep } from "./SungrowSetupStep.tsx";

export const sungrowWizardSteps: PluginStepDef[] = [sungrowSetupStep];

export const sungrowOption: EnergyPluginOption = {
  id: "sungrow_isolarcloud",
  label: "Sungrow (Cloud / iSolarCloud)",
  description:
    "Connect via your iSolarCloud account login. Reads solar production from " +
    "the Sungrow cloud. Grid and consumption readings need a compatible " +
    "Sungrow meter; without one, use gross solar mode.",
  iconKey: "cloud",
};
