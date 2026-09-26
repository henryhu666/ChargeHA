import { useCallback, useState } from "react";
import {
  type PluginStepDef,
  stepStyles as styles,
  type WizardNext,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";
import { SungrowForm } from "./SungrowForm.tsx";

interface ValidatedConnection {
  email: string;
  password: string;
  region: string;
  psId: string;
}

/** Only the tested-connection branch carries a handler, so there is no
 *  "save without a validated connection" state to guard against. */
function sungrowNext(
  validated: ValidatedConnection | null,
  save: (v: ValidatedConnection) => Promise<void>,
): WizardNext {
  if (!validated) {
    return { kind: "blocked", reason: "Test the connection to continue" };
  }
  return {
    kind: "ready",
    hint: "Next saves your iSolarCloud settings",
    onNext: () => save(validated),
  };
}

export const sungrowSetupStep: PluginStepDef = {
  id: "sungrow-isolarcloud-setup",
  label: "Sungrow iSolarCloud Setup",
  useStep: () => {
    const { data: config } = trpc.plugin.energy.sungrow_isolarcloud.getConfig
      .useQuery();
    const saveMutation = trpc.plugin.energy.sungrow_isolarcloud.setConfig
      .useMutation();

    const [validated, setValidated] = useState<ValidatedConnection | null>(
      null,
    );

    const handleTestSuccess = useCallback(
      (email: string, password: string, region: string, psId: string) => {
        setValidated({ email, password, region, psId });
      },
      [],
    );

    const save = async (v: ValidatedConnection) => {
      await saveMutation.mutateAsync({
        sungrowEmail: v.email,
        sungrowPassword: v.password,
        sungrowRegion: v.region,
        sungrowPsId: v.psId,
      });
    };

    return {
      next: sungrowNext(validated, save),
      view: (
        <div className={styles.stepContainer}>
          <SungrowForm
            initialEmail={config?.sungrowEmail || ""}
            initialRegion={config?.sungrowRegion || "europe"}
            initialPsId={config?.sungrowPsId || ""}
            onTestSuccess={handleTestSuccess}
          />
        </div>
      ),
    };
  },
};
