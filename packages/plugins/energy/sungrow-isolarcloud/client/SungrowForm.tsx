import { useMemo, useState } from "react";
import { Button, Select, Text, TextField } from "@radix-ui/themes";
import { Loader2 } from "lucide-react";
import { trpc } from "./trpc.ts";
import {
  FormError,
  stepStyles as styles,
  TestResultBadge,
  type TestStatus,
} from "../../../hostUi.ts";
import { type PlantOption, PlantPicker } from "./PlantPicker.tsx";
import { REGION_HELP, REGION_LABEL, SUNGROW_REGIONS } from "./fields.ts";

interface SungrowFormProps {
  initialEmail: string;
  initialRegion: string;
  initialPsId: string;
  onTestSuccess: (
    email: string,
    password: string,
    region: string,
    psId: string,
  ) => void;
}

function CredentialFields(
  { email, setEmail, password, setPassword }: {
    email: string;
    setEmail: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
  },
) {
  return (
    <>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Email</Text>
        <TextField.Root
          size="2"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e: { target: { value: string } }) =>
            setEmail(e.target.value)}
          aria-label="Email"
        />
      </div>
      <div className={styles.fieldGroup}>
        <Text as="label" size="2" weight="medium">Password</Text>
        <TextField.Root
          size="2"
          type="password"
          placeholder="iSolarCloud password"
          value={password}
          onChange={(e: { target: { value: string } }) =>
            setPassword(e.target.value)}
          aria-label="Password"
        />
      </div>
    </>
  );
}

function RegionField(
  { region, setRegion }: { region: string; setRegion: (v: string) => void },
) {
  return (
    <div className={styles.fieldGroup}>
      <Text as="label" size="2" weight="medium">{REGION_LABEL}</Text>
      <Select.Root value={region} onValueChange={setRegion}>
        <Select.Trigger aria-label={REGION_LABEL} />
        <Select.Content>
          {SUNGROW_REGIONS.map((r) => (
            <Select.Item key={r.value} value={r.value}>{r.label}</Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <Text size="1" color="gray">{REGION_HELP}</Text>
    </div>
  );
}

function ActionRow(
  { label, pendingLabel, pending, disabled, onClick, children }: {
    label: string;
    pendingLabel: string;
    pending: boolean;
    disabled: boolean;
    onClick: () => void;
    children?: JSX.Element | false | null;
  },
) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Button size="2" variant="soft" disabled={disabled} onClick={onClick}>
        {pending && <Loader2 size={14} className={styles.spinner} />}
        {pending ? pendingLabel : label}
      </Button>
      {children}
    </div>
  );
}

interface TestMutationState {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  data?: { success: boolean; systemName?: string; error?: string };
  error: { message: string } | null;
}

/** Collapse the test mutation's flags into the badge's status union. */
function useTestResult(mutation: TestMutationState): TestStatus {
  return useMemo(() => {
    if (mutation.isPending) return { status: "testing" };
    if (mutation.isSuccess && mutation.data?.success) {
      return { status: "success", detail: mutation.data.systemName };
    }
    if (mutation.isSuccess && !mutation.data?.success) {
      return {
        status: "error",
        message: mutation.data?.error ?? "Connection failed",
      };
    }
    if (mutation.isError) {
      return { status: "error", message: mutation.error?.message ?? "Failed" };
    }
    return { status: "idle" };
  }, [
    mutation.isPending,
    mutation.isSuccess,
    mutation.isError,
    mutation.data,
    mutation.error,
  ]);
}

export function SungrowForm({
  initialEmail,
  initialRegion,
  initialPsId,
  onTestSuccess,
}: SungrowFormProps): JSX.Element {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState(initialRegion || "europe");
  const [psId, setPsId] = useState(initialPsId);

  const plantsMutation = trpc.plugin.energy.sungrow_isolarcloud.listPlants
    .useMutation();

  const plants: PlantOption[] = useMemo(() => {
    const data = plantsMutation.data;
    if (!data || !data.success) return [];
    return data.plants.map((p: { psId: string; name: string }) => ({
      id: p.psId,
      name: p.name,
    }));
  }, [plantsMutation.data]);

  // Loading a different account's plants leaves the previous pick behind.
  // Derived rather than reset in an effect, so there is no render-time write.
  const selectedPsId = useMemo(() => {
    if (plants.length === 0) return psId;
    return plants.some((p) => p.id === psId) ? psId : "";
  }, [plants, psId]);

  const testMutation = trpc.plugin.energy.sungrow_isolarcloud.testConnection
    .useMutation({
      onSuccess: (data: { success: boolean }) => {
        if (data.success) {
          onTestSuccess(email, password, region, selectedPsId);
        }
      },
    });

  const plantsError: string | null = useMemo(() => {
    if (plantsMutation.isError) return plantsMutation.error.message;
    const data = plantsMutation.data;
    if (data && !data.success) return data.error ?? "Could not list plants";
    return null;
  }, [plantsMutation.isError, plantsMutation.error, plantsMutation.data]);

  const testResult = useTestResult(testMutation);

  return (
    <>
      <Text as="p" size="3" color="gray">
        Connect to your Sungrow inverter via the iSolarCloud API using your{" "}
        <strong>iSolarCloud</strong>{" "}
        account. Solar production is always available; grid and consumption
        readings require a compatible Sungrow meter.
      </Text>

      <CredentialFields
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
      />

      <RegionField region={region} setRegion={setRegion} />

      <ActionRow
        label="Load Plants"
        pendingLabel="Loading..."
        pending={plantsMutation.isPending}
        disabled={!email || !password || plantsMutation.isPending}
        onClick={() => plantsMutation.mutate({ email, password, region })}
      >
        <FormError message={plantsError} />
      </ActionRow>

      <PlantPicker
        plants={plants}
        selectedPsId={selectedPsId}
        onSelect={setPsId}
        searched={plantsMutation.data !== undefined && !plantsError}
      />

      <ActionRow
        label="Test Connection"
        pendingLabel="Testing..."
        pending={testMutation.isPending}
        disabled={!email || !password || !selectedPsId ||
          testMutation.isPending}
        onClick={() =>
          testMutation.mutate({
            email,
            password,
            region,
            psId: selectedPsId,
          })}
      >
        <TestResultBadge testResult={testResult} />
      </ActionRow>
    </>
  );
}
