# Sungrow iSolarCloud energy plugin — design

Status: draft — pending review
Date: 2026-09-25

## Purpose

An energy plugin for Sungrow inverters reading live solar production from
iSolarCloud, so ChargeHA can charge from solar on a site with no smart meter and
no home battery.

## What the spike established

Probed against a live account on 2026-09-25.

- A plain iSolarCloud app login (email + password) works without a developer
  application: `POST /v1/userService/login` on the region's `gateway.isolarcloud.*`
  host.
- `getPsDetailWithPsType` — the endpoint the app's realtime household dashboard
  uses — returns `pv_power_map_virgin.value` (W) plus daily/total yield.
- Grid / load / battery keys are present but null on a PV-only site.
- `node:crypto` in this repo's Deno provides the AES-128-ECB and RSA PKCS#1 v1.5
  primitives the request envelope needs. Verified by round-trip.

This is an unofficial, reverse-engineered API that can change without notice.
Risk accepted; we patch or re-route if it breaks.

## Non-goals

- **No charging logic.** The charge controller's existing gross mode already
  derives amps from solar production, applies `solarMarginKw`, converts W→A, and
  handles ramping and grace periods. This plugin is a data source; the user
  configures gross mode and a small margin.
- No local/Modbus support.
- No control/write endpoints — read-only.

## Structure

`packages/plugins/energy/sungrow-isolarcloud/`, following `fronius-cloud` — the
leanest cloud precedent in the repo.

```
server/
  config.ts             config section + secret keys
  SungrowProtocol.ts    request envelope (AES body, RSA-wrapped key headers)
  SungrowClient.ts      login, token lifecycle, authenticated request
  SungrowAdapter.ts     EnergySourceAdapter; maps payload -> EnergyData inline
  SungrowPlugin.ts      EnergyPlugin: listPlants, testConnection, createAdapter
  router.ts, index.ts
client/
  SungrowConfig.tsx, SungrowForm.tsx, PlantPicker.tsx, wizardSteps.ts, trpc.ts
```

Protocol and client are separate files only because the envelope crypto is the
one part likely to break when the vendor changes something, and it is testable
without network or credentials. Everything else follows `fronius-cloud`: mapping
lives in the adapter.

Registration: `registerPlugins.ts` (id `sungrow_isolarcloud`),
`componentRegistry.ts`, `demoPluginSummaries.ts`.

`measuresLoad` stays true (the default) — real hardware measuring real
electricity, so a simulated vehicle's draw must not be added to its readings.

## Configuration

`email`, `password` (secret), `region` (enum → gateway host), `ps_id`.

Wizard: credentials + region → `listPlants` → plant picker → `testConnection`,
mirroring GoodWe's `StationPicker`.

## Data flow

One `getPsDetailWithPsType` call per poll. `pollIntervalSeconds()` returns 60;
the server refreshes roughly every 5 minutes.

Mapping reads the `_virgin` fields, which carry raw watts (the non-virgin twins
are display-formatted and rounded):

```
solarProductionW: pv_power_map_virgin ?? curr_power ?? 0
gridPowerW:       power_grid_power_map_virgin ?? 0
homeConsumptionW: load_energy_map ?? 0
batteryPowerW:    charging_discharging_power_map ?? null
batterySoc:       battery_level_percent ?? null
gridVoltageV:     null
```

Same `?? 0` / `?? null` treatment `fronius-cloud` uses. Nothing is derived: with
no meter, a computed home-consumption figure would be fabricated data.

## Error handling

The login endpoint returns a success envelope even for bad credentials — the
real signals are `login_state == "0"` and a `remain_times` counter. The wizard
must say "credentials or region rejected" and surface remaining attempts,
because repeated failures can lock the account. Token rejection triggers one
re-login. Poll exceptions propagate to `EnergyPoller`, which already sets
`pollFailed` / `pollError`.

Wizard calls reuse a single session rather than logging in per click.

## Testing

TDD. Envelope round-trip; client against a fake transport (login success,
`login_state == "0"`, token expiry → single re-login); adapter mapping from the
captured payload including the all-nulls case; plugin tests mirroring
`FroniusCloudAdapter.test.ts` and `GoodweSemsPlugin.test.ts`.
