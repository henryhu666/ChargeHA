import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Select, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import {
  FormError,
  SettingsRow,
  usePluginSettingsHost,
  useSaveStatus,
} from "../../../hostUi.ts";
import { type PlantOption, PlantPicker } from "./PlantPicker.tsx";
import { REGION_HELP, REGION_LABEL, SUNGROW_REGIONS } from "./fields.ts";

type ListPlantsMutation = ReturnType<
  typeof trpc.plugin.energy.sungrow_isolarcloud.listPlants.useMutation
>;
type TestMutation = ReturnType<
  typeof trpc.plugin.energy.sungrow_isolarcloud.testConnection.useMutation
>;

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
} as const;

interface SungrowValues {
  sungrowEmail: string;
  sungrowPassword: string;
  sungrowRegion: string;
  sungrowPsId: string;
}

type SungrowDraft = Partial<SungrowValues>;

/** Buffered like GoodweSemsConfig: a write per keystroke would rebuild the
 *  energy adapter against every half-typed credential (config_changed →
 *  poller). */
function useSungrowDraft(config: SungrowValues | undefined) {
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.energy.sungrow_isolarcloud.setConfig
    .useMutation({
      onSuccess: () =>
        utils.plugin.energy.sungrow_isolarcloud.getConfig.invalidate(),
    });
  const [draft, setDraft] = useState<SungrowDraft>({});
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();

  const sungrowEmail = draft.sungrowEmail ?? config?.sungrowEmail ?? "";
  const sungrowPassword = draft.sungrowPassword ?? config?.sungrowPassword ??
    "";
  const sungrowRegion = draft.sungrowRegion ?? config?.sungrowRegion ??
    "europe";
  const sungrowPsId = draft.sungrowPsId ?? config?.sungrowPsId ?? "";
  const isDirty = Object.keys(draft).length > 0;

  const save = useCallback(() => {
    if (!isDirty) return;
    onMutate();
    configMutation.mutate(
      { sungrowEmail, sungrowPassword, sungrowRegion, sungrowPsId },
      {
        onSuccess: () => {
          onSuccess();
          setDraft({});
        },
        onError,
      },
    );
  }, [
    isDirty,
    sungrowEmail,
    sungrowPassword,
    sungrowRegion,
    sungrowPsId,
    configMutation,
    onMutate,
    onSuccess,
    onError,
  ]);

  const report = usePluginSettingsHost();
  useEffect(() => {
    report?.({ isDirty, save, saveStatus });
  }, [report, isDirty, save, saveStatus]);
  useEffect(() => () => report?.(null), [report]);

  return {
    sungrowEmail,
    sungrowPassword,
    sungrowRegion,
    sungrowPsId,
    setDraft,
  };
}

/** Re-list the account's plants from Settings, so the plant can be changed
 *  without walking back through the setup wizard. */
function PlantSection(
  { email, password, region, psId, plantsMutation, onSelect }: {
    email: string;
    password: string;
    region: string;
    psId: string;
    plantsMutation: ListPlantsMutation;
    onSelect: (psId: string) => void;
  },
) {
  const plants: PlantOption[] = plantsMutation.data?.success
    ? plantsMutation.data.plants.map((p: { psId: string; name: string }) => ({
      id: p.psId,
      name: p.name,
    }))
    : [];

  const error = useMemo(() => {
    if (plantsMutation.isError) return plantsMutation.error.message;
    const data = plantsMutation.data;
    if (data && !data.success) return data.error ?? "Could not list plants";
    return null;
  }, [plantsMutation.isError, plantsMutation.error, plantsMutation.data]);

  return (
    <>
      <div style={rowStyle}>
        <Button
          size="2"
          variant="soft"
          disabled={!email || !password || plantsMutation.isPending}
          onClick={() => plantsMutation.mutate({ email, password, region })}
        >
          {plantsMutation.isPending ? "Loading..." : "Load Plants"}
        </Button>
        <FormError message={error} />
      </div>

      <PlantPicker
        plants={plants}
        selectedPsId={psId}
        onSelect={onSelect}
        searched={plantsMutation.data !== undefined && !error}
      />
    </>
  );
}

function TestConnectionRow(
  { email, password, region, psId, testMutation }: {
    email: string;
    password: string;
    region: string;
    psId: string;
    testMutation: TestMutation;
  },
) {
  return (
    <div style={rowStyle}>
      <Button
        size="2"
        variant="soft"
        disabled={!email || !password || !psId || testMutation.isPending}
        onClick={() =>
          testMutation.mutate({ email, password, region, psId })}
      >
        {testMutation.isPending ? "Testing..." : "Test Connection"}
      </Button>

      {testMutation.isSuccess && testMutation.data.success && (
        <Badge color="green" size="2">
          Connected{testMutation.data.systemName
            ? ` — ${testMutation.data.systemName}`
            : ""}
        </Badge>
      )}
      {testMutation.isError && (
        <FormError message={testMutation.error.message} />
      )}
      {testMutation.isSuccess && !testMutation.data.success && (
        <FormError message={testMutation.data.error ?? "Connection failed"} />
      )}
    </div>
  );
}

export function SungrowConfig(): JSX.Element | null {
  const { data: config } = trpc.plugin.energy.sungrow_isolarcloud.getConfig
    .useQuery();
  const plantsMutation = trpc.plugin.energy.sungrow_isolarcloud.listPlants
    .useMutation();
  const testMutation = trpc.plugin.energy.sungrow_isolarcloud.testConnection
    .useMutation();

  const {
    sungrowEmail,
    sungrowPassword,
    sungrowRegion,
    sungrowPsId,
    setDraft,
  } = useSungrowDraft(config as SungrowValues | undefined);

  if (!config) return null;

  return (
    <>
      <Text size="1" color="gray">
        Uses your <strong>iSolarCloud</strong>{" "}
        account. Solar production is always available; grid and consumption
        readings require a compatible Sungrow meter.
      </Text>

      <SettingsRow label="Email">
        <TextField.Root
          size="2"
          placeholder="your@email.com"
          value={sungrowEmail}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, sungrowEmail: e.target.value }))}
          style={{ width: 220 }}
        />
      </SettingsRow>

      <SettingsRow label="Password">
        <TextField.Root
          size="2"
          type="password"
          placeholder="iSolarCloud password"
          value={sungrowPassword}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, sungrowPassword: e.target.value }))}
          style={{ width: 220 }}
        />
      </SettingsRow>

      <SettingsRow label={REGION_LABEL} help={REGION_HELP}>
        <Select.Root
          value={sungrowRegion}
          onValueChange={(sungrowRegion: string) =>
            setDraft((d) => ({ ...d, sungrowRegion }))}
        >
          <Select.Trigger aria-label={REGION_LABEL} />
          <Select.Content>
            {SUNGROW_REGIONS.map((r) => (
              <Select.Item key={r.value} value={r.value}>{r.label}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </SettingsRow>

      <SettingsRow
        label="Plant ID"
        help="The plant this inverter belongs to. Use Load Plants to pick it from your account."
      >
        <TextField.Root
          size="2"
          placeholder="1198878"
          value={sungrowPsId}
          onChange={(e: { target: { value: string } }) =>
            setDraft((d) => ({ ...d, sungrowPsId: e.target.value }))}
          style={{ width: 320 }}
        />
      </SettingsRow>

      <PlantSection
        email={sungrowEmail}
        password={sungrowPassword}
        region={sungrowRegion}
        psId={sungrowPsId}
        plantsMutation={plantsMutation}
        onSelect={(sungrowPsId: string) =>
          setDraft((d) => ({ ...d, sungrowPsId }))}
      />

      <TestConnectionRow
        email={sungrowEmail}
        password={sungrowPassword}
        region={sungrowRegion}
        psId={sungrowPsId}
        testMutation={testMutation}
      />
    </>
  );
}
