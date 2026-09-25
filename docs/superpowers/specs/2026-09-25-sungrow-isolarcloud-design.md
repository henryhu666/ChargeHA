# Sungrow iSolarCloud energy plugin — design

Status: draft — pending review
Date: 2026-09-25

## Purpose

Add an energy plugin for Sungrow inverters, reading live solar production from
the iSolarCloud cloud service so ChargeHA can charge a vehicle from solar on a
site with **no smart meter and no home battery**.

## Background: what the spike established

Probed against a live account (ps_id 1198878) on 2026-09-25.

- A **plain iSolarCloud app login** (email + password) authenticates without a
  developer-portal application, via `POST /v1/userService/login` on the region's
  `gateway.isolarcloud.*` host.
- `getPsDetailWithPsType` — the endpoint the app's own realtime household
  dashboard uses — returns the plant payload with `pv_power_map_virgin.value`
  (W), `curr_power.value` (W), and daily/total yield counters.
- On a PV-only system, grid / load / battery keys are **present but null**, not
  absent. That is the expected shape for a site with no meter and no battery
  (`is_have_es_battery` null, `design_capacity_battery` 0).
- Sungrow documents plant data as refreshing every 5 minutes.
- `node:crypto` in this repo's Deno provides both primitives the transport needs
  (AES-128-ECB and RSA PKCS#1 v1.5 encryption). Verified by round-trip.

**Accepted risk:** this is an unofficial, reverse-engineered API. It can change
without notice. The project accepts this and will patch or re-route if it
breaks. Design mitigates by isolating the fragile parts (see Modules).

## Non-goals

- **No charging logic.** The charge controller's existing **gross mode** already
  derives amps from total solar production regardless of home consumption,
  applies `solarMarginKw`, converts W→A by configured voltage/phase count, and
  handles ramping, grace periods and cooldown. The plugin is a data source only.
  Users configure gross mode plus a small margin.
- No local/Modbus access (no eligible dongle on the target site).
- No write/control endpoints (charge scheduling, operation mode) — read-only.

## Placement

`packages/plugins/energy/sungrow-isolarcloud/`, following `goodwe-sems`, the
closest precedent: cloud-backed, username/password, station picker, brittle
vendor API.

Registration touches:
- `packages/plugins/registerPlugins.ts` — id `sungrow_isolarcloud`
- `packages/plugins/componentRegistry.ts` — wizard steps
- `packages/plugins/demoPluginSummaries.ts` — demo summary

`measuresLoad` stays **true** (the interface default). Per `docs/simulated-load.md`
the flag marks adapters that measure no real electricity; this is real hardware,
so a simulated vehicle's draw must not be added to its readings.

## Modules

```
server/
  SungrowPlugin.ts     EnergyPlugin: config, listPlants, testConnection, createAdapter
  SungrowAdapter.ts    EnergySourceAdapter: connect/disconnect/getRealtimeData/getDeviceInfo
  SungrowClient.ts     login, token lifecycle, authenticated request
  SungrowCrypto.ts     AES-128-ECB/PKCS7 body envelope, RSA-wrapped key headers
  SungrowMapping.ts    payload -> EnergyData (pure function, no I/O)
  SungrowTypes.ts      response shapes
  config.ts            config section + secret keys
  router.ts            tRPC router for wizard calls
  errors.ts            login vs transport vs poll error types
  index.ts
client/
  SungrowConfig.tsx    settings panel
  SungrowForm.tsx      credentials + region fields
  PlantPicker.tsx      plant selection (mirrors StationPicker)
  wizardSteps.ts, trpc.ts, fields.ts
```

Boundaries are drawn so the volatile parts are contained: `SungrowCrypto` knows
only bytes, `SungrowClient` only transport and session, `SungrowMapping` is a
pure function over a decoded payload. A vendor change to the envelope is then a
one-module fix, and mapping is testable from a captured payload with no network
and no credentials.

## Configuration

| Key | Type | Notes |
|---|---|---|
| `email` | string | iSolarCloud account |
| `password` | string | **secret key** |
| `region` | enum | Europe / International / Australia / China / India → gateway host |
| `ps_id` | string | plant id, chosen via picker |

Wizard flow: credentials + region → `listPlants` → plant picker → `testConnection`.

## Data flow

One `getPsDetailWithPsType` call per poll. `pollIntervalSeconds()` returns
**60** — the server refreshes roughly every 5 minutes, so 60s is cheap insurance
against sitting a full cycle stale without hammering the API.

### Mapping to `EnergyData`

Read the `_virgin` variants: they carry raw watts, while the non-virgin twins are
display-formatted and rounded.

| Field | Source | PV-only site |
|---|---|---|
| `solarProductionW` | `pv_power_map_virgin.value`, fallback `curr_power.value` | live value |
| `gridPowerW` | `power_grid_power_map_virgin.value` | null → `0` |
| `homeConsumptionW` | `load_energy_map.value` | null → derived `max(0, solar + grid)` |
| `batteryPowerW` | `charging_discharging_power_map.value` | null → `null` |
| `batterySoc` | `battery_level_percent` | null → `null` |
| `gridVoltageV` | not exposed | `null` |
| `sourceUpdatedAt` | payload timestamp if present | else `null` |

Null-tolerant by design: the same mapping serves metered and battery-equipped
Sungrow systems without a rewrite.

**Unverified assumption:** grid and battery sign conventions cannot be confirmed
from a PV-only site. GoodWe required inverting grid sign (export-positive
upstream vs import-positive in ChargeHA). The mapping will state the assumed
convention in a comment marked unverified, following the precedent of the
existing GoodWe battery-direction TODO, rather than guessing silently.

## Error handling

- **Login failures are distinct from poll failures.** The login endpoint returns
  a success envelope even for bad credentials; the real signals are
  `login_state == "0"` and a `remain_times` counter. The wizard must report
  "credentials or region rejected" and surface remaining attempts, because
  repeated failures can lock the account.
- Token rejection triggers exactly one re-login, then fails.
- Poll exceptions propagate to `EnergyPoller`, which already substitutes zeros
  and sets `pollFailed` / `pollError` for the dashboard.
- Wizard calls reuse a single session rather than logging in per click.

## Testing

TDD throughout.

- `SungrowMapping` — from the captured payload: PV-only (nulls), fully populated,
  missing keys, zero production. Pure, no network.
- `SungrowCrypto` — envelope round-trip; fixed-key vector.
- `SungrowClient` — fake transport: login success, `login_state == "0"`, token
  expiry → single re-login, malformed envelope.
- `SungrowPlugin` — mirrors `GoodweSemsPlugin.test.ts`: listPlants,
  testConnection, createAdapter with incomplete config.
- Client component tests mirroring the GoodWe form/config tests.

Not coverable by tests: that `pv_power_map_virgin` carries a sane non-zero value
in daylight. The spike ran at night, when zero is the correct reading. This
requires one manual daylight verification during implementation — treat it as a
gate before considering the plugin working, not an afterthought.

## Open items

1. Daylight verification of live production value and observed refresh cadence.
2. Grid/battery sign convention, pending a metered Sungrow system.
