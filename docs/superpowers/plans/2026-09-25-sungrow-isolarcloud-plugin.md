# Sungrow iSolarCloud Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an energy plugin that reads live solar production from Sungrow inverters via the iSolarCloud cloud API, so ChargeHA can charge from solar on a site with no smart meter and no home battery.

**Architecture:** Follows `fronius-cloud`, the leanest cloud precedent in the repo. A protocol module owns the AES/RSA request envelope (the one piece likely to break when the vendor changes something, and testable without network). A client owns login and token lifecycle. The adapter fetches one endpoint per poll and maps the payload to `EnergyData` inline. No charging logic — the charge controller's existing gross mode already derives amps from solar production.

**Tech Stack:** Deno, TypeScript (strict), `node:crypto`, tRPC, Zod, React, `@std/testing/bdd` + `@std/expect`.

**Spec:** `docs/superpowers/specs/2026-09-25-sungrow-isolarcloud-design.md`

## Global Constraints

- Runtime is **Deno**; `deno.json` sets `"strict": true`. All code must typecheck under `deno check`.
- Plugin id: `sungrow_isolarcloud`. Settings component key: `sungrow-isolarcloud-config`. Display name: `Sungrow (Cloud / iSolarCloud)`. Vendor: `Sungrow`.
- Import `node:crypto` and `node:buffer` via the `node:` specifier — an established pattern in this repo.
- Tests use `describe`/`it` from `@std/testing/bdd` and `expect` from `@std/expect`.
- Run server tests with: `deno task test:server`
- Typecheck with: `deno check`
- **The API returns every value as a string, and represents "no data" as the literal `"--"`.** Confirmed against a live account: `{"unit":"W","value":"0"}` for live data, `{"unit":"","value":"--"}` for absent. Every numeric read must handle this.
- This is an unofficial, reverse-engineered API. Risk is accepted by the project.

---

### Task 1: Request envelope (`SungrowProtocol.ts`)

Owns the AES/RSA envelope: a random AES-128 key per request encrypts the JSON body to upper-case hex; the key is RSA-wrapped into a header so the server can decrypt it.

**Files:**
- Create: `packages/plugins/energy/sungrow-isolarcloud/server/SungrowProtocol.ts`
- Test: `packages/plugins/energy/sungrow-isolarcloud/server/SungrowProtocol.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SUNGROW_SERVERS: Record<SungrowRegion, string>` and `type SungrowRegion = "china" | "international" | "europe" | "australia" | "india"`
  - `APP_KEY: string`, `ACCESS_KEY: string`, `SYS_CODE: string`, `PUBLIC_KEY_PEM: string`
  - `randomAesKey(): string`
  - `randomNonce(length?: number): string`
  - `aesEncrypt(payload: unknown, key: string): string`
  - `aesDecrypt(hex: string, key: string): Record<string, unknown>`
  - `rsaEncrypt(value: string, publicKeyPem?: string): string`
  - `buildHeaders(key: string, userId: string, publicKeyPem?: string): Record<string, string>`

- [ ] **Step 1: Write the failing test**

Create `packages/plugins/energy/sungrow-isolarcloud/server/SungrowProtocol.test.ts`:

```ts
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  aesDecrypt,
  aesEncrypt,
  buildHeaders,
  randomAesKey,
  randomNonce,
  rsaEncrypt,
  SUNGROW_SERVERS,
} from "./SungrowProtocol.ts";

describe("SungrowProtocol", () => {
  describe("randomAesKey", () => {
    it("returns a 16-char key prefixed with web", () => {
      const key = randomAesKey();
      expect(key.length).toBe(16);
      expect(key.startsWith("web")).toBe(true);
    });

    it("returns a different key each call", () => {
      expect(randomAesKey()).not.toBe(randomAesKey());
    });
  });

  describe("randomNonce", () => {
    it("defaults to 32 alphanumeric chars", () => {
      expect(randomNonce()).toMatch(/^[A-Za-z0-9]{32}$/);
    });

    it("honours an explicit length", () => {
      expect(randomNonce(8).length).toBe(8);
    });
  });

  describe("aes round-trip", () => {
    it("encrypts to upper-case hex and decrypts back", () => {
      const key = randomAesKey();
      const hex = aesEncrypt({ ps_id: "1198878", n: 1 }, key);
      expect(hex).toMatch(/^[0-9A-F]+$/);
      expect(aesDecrypt(hex, key)).toEqual({ ps_id: "1198878", n: 1 });
    });

    it("produces a multiple of the 16-byte block size", () => {
      const key = randomAesKey();
      // 2 hex chars per byte, 16 bytes per block => 32 hex chars per block
      expect(aesEncrypt({ a: "x" }, key).length % 32).toBe(0);
    });
  });

  describe("rsaEncrypt", () => {
    it("returns base64 that differs per call for the same input", () => {
      const a = rsaEncrypt("hello");
      const b = rsaEncrypt("hello");
      expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
      // PKCS#1 v1.5 uses random padding, so ciphertexts differ
      expect(a).not.toBe(b);
    });
  });

  describe("buildHeaders", () => {
    it("carries the app constants and both RSA-wrapped headers", () => {
      const h = buildHeaders(randomAesKey(), "42");
      expect(h["content-type"]).toBe("application/json;charset=UTF-8");
      expect(h["sys_code"]).toBe("200");
      expect(h["x-access-key"]).toBe("9grzgbmxdsp3arfmmgq347xjbza4ysps");
      expect(h["x-random-secret-key"].length).toBeGreaterThan(0);
      expect(h["x-limit-obj"].length).toBeGreaterThan(0);
    });
  });

  describe("SUNGROW_SERVERS", () => {
    it("maps regions to gateway hosts", () => {
      expect(SUNGROW_SERVERS.europe).toBe("https://gateway.isolarcloud.eu");
      expect(SUNGROW_SERVERS.australia).toBe("https://augateway.isolarcloud.com");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-net --allow-read --allow-env packages/plugins/energy/sungrow-isolarcloud/`
Expected: FAIL — module `./SungrowProtocol.ts` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/plugins/energy/sungrow-isolarcloud/server/SungrowProtocol.ts`:

```ts
import {
  constants,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
} from "node:crypto";
import { Buffer } from "node:buffer";

// iSolarCloud regional API gateways.
export type SungrowRegion =
  | "china"
  | "international"
  | "europe"
  | "australia"
  | "india";

export const SUNGROW_SERVERS: Record<SungrowRegion, string> = {
  china: "https://gateway.isolarcloud.com",
  international: "https://gateway.isolarcloud.com.hk",
  europe: "https://gateway.isolarcloud.eu",
  australia: "https://augateway.isolarcloud.com",
  india: "https://gateway.isolarcloud.in",
};

// App-level constants identifying the web client to iSolarCloud. These are not
// per-user secrets — they are the same for every caller of this API.
export const APP_KEY = "B0455FBE7AA0328DB57B59AA729F05D8";
export const ACCESS_KEY = "9grzgbmxdsp3arfmmgq347xjbza4ysps";
// The web client advertises 200; the phone app sends 900.
export const SYS_CODE = "200";

// Public key the server expects the per-request AES key to be wrapped with.
export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCkecphb6vgsBx4LJknKKes+eyj7+RKQ3fikF5B6
7EObZ3t4moFZyMGuuJPiadYdaxvRqtxyblIlVM7omAasROtKRhtgKwwRxo2a6878qBhTgUVlsqugp
I/7ZC9RmO2Rpmr8WzDeAapGANfHN5bVr7G7GYGwIrjvyxMrAVit/oM4wIDAQAB
-----END PUBLIC KEY-----
`;

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomChars(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** A fresh AES-128 key: the literal "web" plus 13 random alphanumerics. */
export function randomAesKey(): string {
  return "web" + randomChars(13);
}

export function randomNonce(length = 32): string {
  return randomChars(length);
}

/** AES-128-ECB (PKCS#7) encrypt a JSON payload to an upper-cased hex string. */
export function aesEncrypt(payload: unknown, key: string): string {
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(key, "utf8"), null);
  const out = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return out.toString("hex").toUpperCase();
}

/** Reverse {@link aesEncrypt}. */
export function aesDecrypt(hex: string, key: string): Record<string, unknown> {
  const decipher = createDecipheriv(
    "aes-128-ecb",
    Buffer.from(key, "utf8"),
    null,
  );
  const out = Buffer.concat([
    decipher.update(Buffer.from(hex, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(out.toString("utf8")) as Record<string, unknown>;
}

/** RSA PKCS#1 v1.5 encrypt a short string, base64-encoded. */
export function rsaEncrypt(
  value: string,
  publicKeyPem: string = PUBLIC_KEY_PEM,
): string {
  return publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(value, "utf8"),
  ).toString("base64");
}

/** Headers for one enveloped request. `userId` is "" before login. */
export function buildHeaders(
  key: string,
  userId: string,
  publicKeyPem: string = PUBLIC_KEY_PEM,
): Record<string, string> {
  return {
    "content-type": "application/json;charset=UTF-8",
    "sys_code": SYS_CODE,
    "x-access-key": ACCESS_KEY,
    "x-random-secret-key": rsaEncrypt(key, publicKeyPem),
    "x-limit-obj": rsaEncrypt(userId, publicKeyPem),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-net --allow-read --allow-env packages/plugins/energy/sungrow-isolarcloud/`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/energy/sungrow-isolarcloud/server/SungrowProtocol.ts \
        packages/plugins/energy/sungrow-isolarcloud/server/SungrowProtocol.test.ts
git commit -m "adds sungrow isolarcloud request envelope"
```

---

### Task 2: API client (`SungrowClient.ts`)

Owns login, token lifecycle and the two reads the plugin needs. The login endpoint returns an HTTP-200 **success** envelope even for bad credentials — the real signal is `result_data.login_state === "0"` — so this must be checked explicitly or a wrong password looks like a working connection.

**Files:**
- Create: `packages/plugins/energy/sungrow-isolarcloud/server/SungrowClient.ts`
- Test: `packages/plugins/energy/sungrow-isolarcloud/server/SungrowClient.test.ts`

**Interfaces:**
- Consumes (Task 1): `SUNGROW_SERVERS`, `SungrowRegion`, `APP_KEY`, `aesEncrypt`, `aesDecrypt`, `buildHeaders`, `randomAesKey`, `randomNonce`.
- Produces:
  - `class SungrowAuthError extends Error` (name `"SungrowAuthError"`)
  - `class SungrowConnectionError extends Error` (name `"SungrowConnectionError"`)
  - `interface SungrowPlantSummary { psId: string; name: string }`
  - `class SungrowClient`
    - `constructor(region: SungrowRegion, email: string, password: string, log?: { info(m: string): void; warn(m: string): void })`
    - `login(): Promise<void>`
    - `request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>>` — logs in if needed; on a token-rejection code re-logs in **once** then retries
    - `getPlants(): Promise<SungrowPlantSummary[]>`
    - `getPlantDetail(psId: string): Promise<Record<string, unknown>>`

- [ ] **Step 1: Write the failing test**

Create `packages/plugins/energy/sungrow-isolarcloud/server/SungrowClient.test.ts`:

```ts
import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { aesDecrypt, aesEncrypt } from "./SungrowProtocol.ts";
import {
  SungrowAuthError,
  SungrowClient,
} from "./SungrowClient.ts";

// The client decrypts each response with the AES key it generated for that
// request. A test stub cannot recover that key (it is RSA-wrapped), so
// SungrowClient takes an injectable keyFactory and tests pin it to a known
// value — letting the stub encrypt its reply with the same key.

function stubFetch(
  handler: (url: string, body: string, key: string) => unknown,
  key: string,
) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const payload = handler(url, String(init?.body ?? ""), key);
    return Promise.resolve(
      new Response(aesEncrypt(payload, key), { status: 200 }),
    );
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const KEY = "webTESTKEY123456".slice(0, 16);

function makeClient() {
  return new SungrowClient("europe", "a@b.c", "pw", undefined, () => KEY);
}

describe("SungrowClient", () => {
  let stub: { calls: string[]; restore: () => void } | null = null;

  afterEach(() => {
    stub?.restore();
    stub = null;
  });

  it("logs in and stores the token", async () => {
    stub = stubFetch(() => ({
      result_code: "1",
      result_msg: "success",
      result_data: { login_state: "1", token: "TK", user_id: "42" },
    }), KEY);
    const client = makeClient();
    await client.login();
    expect(stub.calls[0]).toBe(
      "https://gateway.isolarcloud.eu/v1/userService/login",
    );
  });

  it("throws SungrowAuthError when login_state is 0, quoting remaining attempts", async () => {
    stub = stubFetch(() => ({
      result_code: "1",
      result_msg: "success",
      result_data: { login_state: "0", msg: "password error", remain_times: 3 },
    }), KEY);
    const client = makeClient();
    await expect(client.login()).rejects.toThrow(SungrowAuthError);
  });

  it("encrypts the request body rather than sending plaintext", async () => {
    let seenBody = "";
    stub = stubFetch((_u, body) => {
      seenBody = body;
      return {
        result_code: "1",
        result_data: { login_state: "1", token: "TK", user_id: "42" },
      };
    }, KEY);
    await makeClient().login();
    expect(seenBody).toMatch(/^[0-9A-F]+$/);
    expect(seenBody).not.toContain("a@b.c");
    expect(aesDecrypt(seenBody, KEY).user_account).toBe("a@b.c");
  });

  it("maps the plant list to psId/name pairs", async () => {
    stub = stubFetch((url) => {
      if (url.endsWith("/login")) {
        return {
          result_code: "1",
          result_data: { login_state: "1", token: "TK", user_id: "42" },
        };
      }
      return {
        result_code: "1",
        result_data: {
          pageList: [{ ps_id: 1198878, ps_name: "Home" }],
        },
      };
    }, KEY);
    const plants = await makeClient().getPlants();
    expect(plants).toEqual([{ psId: "1198878", name: "Home" }]);
  });

  it("re-logs in once when the token is rejected, then succeeds", async () => {
    let detailCalls = 0;
    stub = stubFetch((url) => {
      if (url.endsWith("/login")) {
        return {
          result_code: "1",
          result_data: { login_state: "1", token: "TK", user_id: "42" },
        };
      }
      detailCalls += 1;
      if (detailCalls === 1) return { result_code: "401" };
      return { result_code: "1", result_data: { curr_power: { value: "5" } } };
    }, KEY);
    const detail = await makeClient().getPlantDetail("1198878");
    expect(detail.curr_power).toEqual({ value: "5" });
    expect(detailCalls).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-net --allow-read --allow-env packages/plugins/energy/sungrow-isolarcloud/`
Expected: FAIL — `./SungrowClient.ts` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/plugins/energy/sungrow-isolarcloud/server/SungrowClient.ts`:

```ts
import {
  aesDecrypt,
  aesEncrypt,
  APP_KEY,
  buildHeaders,
  randomAesKey,
  randomNonce,
  type SungrowRegion,
  SUNGROW_SERVERS,
} from "./SungrowProtocol.ts";

export class SungrowAuthError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "SungrowAuthError";
  }
}

export class SungrowConnectionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "SungrowConnectionError";
  }
}

export interface SungrowPlantSummary {
  psId: string;
  name: string;
}

const LOGIN_PATH = "/v1/userService/login";
const PLANT_LIST_PATH = "/v1/powerStationService/getPsList";
const PLANT_DETAIL_PATH = "/v1/powerStationService/getPsDetailWithPsType";

// Result codes that mean the session is dead and one re-login is worth trying.
const TOKEN_REJECTED = new Set(["401", "403"]);

interface ClientLog {
  info(message: string): void;
  warn(message: string): void;
}

export class SungrowClient {
  private token: string | null = null;
  private userId = "";
  private readonly host: string;

  constructor(
    region: SungrowRegion,
    private readonly email: string,
    private readonly password: string,
    private readonly log?: ClientLog,
    // Injectable only so tests can pin the per-request AES key.
    private readonly keyFactory: () => string = randomAesKey,
  ) {
    this.host = SUNGROW_SERVERS[region];
  }

  private common(): Record<string, unknown> {
    return {
      appkey: APP_KEY,
      api_key_param: { timestamp: Date.now(), nonce: randomNonce() },
    };
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const key = this.keyFactory();
    let res: Response;
    try {
      res = await fetch(`${this.host}${path}`, {
        method: "POST",
        headers: buildHeaders(key, this.userId),
        body: aesEncrypt(body, key),
      });
    } catch (err) {
      throw new SungrowConnectionError(
        `iSolarCloud request failed: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err : undefined,
      );
    }
    if (!res.ok) {
      throw new SungrowConnectionError(`iSolarCloud HTTP ${res.status}`);
    }
    try {
      return aesDecrypt(await res.text(), key);
    } catch (err) {
      throw new SungrowConnectionError(
        "iSolarCloud response could not be decrypted",
        err instanceof Error ? err : undefined,
      );
    }
  }

  private static succeeded(data: Record<string, unknown>): boolean {
    return data.result_msg === "success" || String(data.result_code) === "1";
  }

  async login(): Promise<void> {
    const data = await this.post(LOGIN_PATH, {
      ...this.common(),
      user_account: this.email,
      user_password: this.password,
    });
    const result = (data.result_data ?? {}) as Record<string, unknown>;
    const token = result.token;
    // The endpoint returns a success envelope even for bad credentials; the
    // real signal is login_state.
    if (
      !SungrowClient.succeeded(data) || String(result.login_state) === "0" ||
      !token
    ) {
      const msg = result.msg ?? data.result_msg ?? data.result_code;
      const remain = result.remain_times;
      const suffix = remain === undefined || remain === null || remain === ""
        ? ""
        : ` (${remain} attempt(s) remaining)`;
      throw new SungrowAuthError(`Login failed: ${msg}${suffix}`);
    }
    this.token = String(token);
    this.userId = String(result.user_id ?? "");
    this.log?.info("iSolarCloud login successful");
  }

  async request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.token === null) await this.login();
    const send = () =>
      this.post(path, { ...this.common(), token: this.token, ...body });

    let data = await send();
    if (TOKEN_REJECTED.has(String(data.result_code))) {
      this.log?.warn("iSolarCloud token rejected; re-logging in");
      this.token = null;
      await this.login();
      data = await send();
    }
    if (!SungrowClient.succeeded(data)) {
      throw new SungrowConnectionError(
        `iSolarCloud ${path} failed: ${data.result_msg ?? data.result_code}`,
      );
    }
    return data;
  }

  async getPlants(): Promise<SungrowPlantSummary[]> {
    const data = await this.request(PLANT_LIST_PATH, { valid_flag: "1,3" });
    const result = (data.result_data ?? {}) as Record<string, unknown>;
    const list = Array.isArray(result.pageList) ? result.pageList : [];
    return list.map((raw) => {
      const p = raw as Record<string, unknown>;
      return {
        psId: String(p.ps_id ?? ""),
        name: String(p.ps_name ?? p.ps_short_name ?? p.ps_id ?? ""),
      };
    });
  }

  async getPlantDetail(psId: string): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      ps_id: String(psId),
      is_get_ps_level_data: "1",
      version_tag: "1",
      is_shut_down_flag: "1",
      is_get_hm_info: "1",
    };
    // Every region except China mirrors the "oversea" variant.
    if (this.host !== SUNGROW_SERVERS.china) body.func_code = "5";
    const data = await this.request(PLANT_DETAIL_PATH, body);
    return (data.result_data ?? {}) as Record<string, unknown>;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-net --allow-read --allow-env packages/plugins/energy/sungrow-isolarcloud/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/energy/sungrow-isolarcloud/server/SungrowClient.ts \
        packages/plugins/energy/sungrow-isolarcloud/server/SungrowClient.test.ts
git commit -m "adds sungrow isolarcloud api client"
```

---

### Task 3: Adapter and payload mapping (`SungrowAdapter.ts`)

Maps the plant-detail payload to `EnergyData`. Values arrive as **strings**, and absent data is the literal `"--"` — both confirmed against a live account.

**Files:**
- Create: `packages/plugins/energy/sungrow-isolarcloud/server/SungrowAdapter.ts`
- Test: `packages/plugins/energy/sungrow-isolarcloud/server/SungrowAdapter.test.ts`

**Interfaces:**
- Consumes (Task 2): `SungrowClient`, `SungrowPlantSummary`. (Task 1): `SungrowRegion`.
- Produces:
  - `toEnergyData(detail: Record<string, unknown>): EnergyData` (exported for tests)
  - `class SungrowAdapter implements EnergySourceAdapter`
    - `constructor(client: SungrowClient, psId: string, plantName?: string)`
    - `connect()`, `disconnect()`, `getRealtimeData()`, `getDeviceInfo()`, `pollIntervalSeconds()`

- [ ] **Step 1: Write the failing test**

Create `packages/plugins/energy/sungrow-isolarcloud/server/SungrowAdapter.test.ts`:

```ts
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SungrowAdapter, toEnergyData } from "./SungrowAdapter.ts";
import type { SungrowClient } from "./SungrowClient.ts";

// Shape captured from a live PV-only account: values are strings and absent
// data is the literal "--".
const pvOnlyPayload = {
  curr_power: { unit: "W", value: "0" },
  pv_power_map_virgin: { unit: "W", value: "0" },
  power_grid_power_map_virgin: { unit: "W", value: "--" },
  load_energy_map: { unit: "", value: "--" },
  charging_discharging_power_map: { unit: "", value: "--" },
  battery_level_percent: "--",
};

const fullPayload = {
  curr_power: { unit: "W", value: "3100" },
  pv_power_map_virgin: { unit: "W", value: "3200.5" },
  power_grid_power_map_virgin: { unit: "W", value: "-900" },
  load_energy_map: { unit: "W", value: "2300" },
  charging_discharging_power_map: { unit: "W", value: "500" },
  battery_level_percent: "87",
};

describe("toEnergyData", () => {
  it("reads solar production from pv_power_map_virgin, rounded to watts", () => {
    expect(toEnergyData(fullPayload).solarProductionW).toBe(3201);
  });

  it("falls back to curr_power when pv_power_map_virgin is absent", () => {
    const d = toEnergyData({ curr_power: { unit: "W", value: "1500" } });
    expect(d.solarProductionW).toBe(1500);
  });

  it("treats -- as missing and yields zeros, not NaN, on a PV-only site", () => {
    const d = toEnergyData(pvOnlyPayload);
    expect(d.solarProductionW).toBe(0);
    expect(d.gridPowerW).toBe(0);
    expect(d.homeConsumptionW).toBe(0);
  });

  it("reports battery fields as null when absent", () => {
    const d = toEnergyData(pvOnlyPayload);
    expect(d.batteryPowerW).toBe(null);
    expect(d.batterySoc).toBe(null);
  });

  it("maps battery fields when the site has a battery", () => {
    const d = toEnergyData(fullPayload);
    expect(d.batteryPowerW).toBe(500);
    expect(d.batterySoc).toBe(87);
  });

  it("maps grid and load when a meter is present", () => {
    const d = toEnergyData(fullPayload);
    expect(d.gridPowerW).toBe(-900);
    expect(d.homeConsumptionW).toBe(2300);
  });

  it("never reports gridVoltageV, which the payload does not carry", () => {
    expect(toEnergyData(fullPayload).gridVoltageV).toBe(null);
  });

  it("stamps lastUpdated as an ISO timestamp", () => {
    expect(toEnergyData(fullPayload).lastUpdated).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });

  it("survives a completely empty payload", () => {
    const d = toEnergyData({});
    expect(d.solarProductionW).toBe(0);
    expect(d.batterySoc).toBe(null);
  });
});

describe("SungrowAdapter", () => {
  function fakeClient(detail: Record<string, unknown>): SungrowClient {
    return {
      getPlantDetail: () => Promise.resolve(detail),
    } as unknown as SungrowClient;
  }

  it("polls every 60 seconds", () => {
    expect(new SungrowAdapter(fakeClient({}), "1").pollIntervalSeconds())
      .toBe(60);
  });

  it("returns mapped realtime data", async () => {
    const adapter = new SungrowAdapter(fakeClient(fullPayload), "1198878");
    expect((await adapter.getRealtimeData()).solarProductionW).toBe(3201);
  });

  it("reports device info using the plant name when known", async () => {
    const adapter = new SungrowAdapter(fakeClient({}), "1198878", "Home");
    const info = await adapter.getDeviceInfo();
    expect(info.name).toBe("Home");
  });

  it("falls back to the plant id when no name is known", async () => {
    const info = await new SungrowAdapter(fakeClient({}), "1198878")
      .getDeviceInfo();
    expect(info.name).toContain("1198878");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-net --allow-read --allow-env packages/plugins/energy/sungrow-isolarcloud/`
Expected: FAIL — `./SungrowAdapter.ts` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/plugins/energy/sungrow-isolarcloud/server/SungrowAdapter.ts`:

```ts
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
 * Read one numeric field. Values arrive as strings, wrapped as
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-net --allow-read --allow-env packages/plugins/energy/sungrow-isolarcloud/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/energy/sungrow-isolarcloud/server/SungrowAdapter.ts \
        packages/plugins/energy/sungrow-isolarcloud/server/SungrowAdapter.test.ts
git commit -m "adds sungrow isolarcloud energy adapter"
```

---

### Task 4: Plugin, config, router and registration

Wires the adapter into ChargeHA. After this task the plugin is selectable in the backend.

**Files:**
- Create: `packages/plugins/energy/sungrow-isolarcloud/server/config.ts`
- Create: `packages/plugins/energy/sungrow-isolarcloud/server/SungrowPlugin.ts`
- Create: `packages/plugins/energy/sungrow-isolarcloud/server/router.ts`
- Create: `packages/plugins/energy/sungrow-isolarcloud/server/index.ts`
- Create: `packages/plugins/energy/sungrow-isolarcloud/routerType.ts`
- Test: `packages/plugins/energy/sungrow-isolarcloud/server/SungrowPlugin.test.ts`
- Modify: `packages/plugins/registerPlugins.ts`
- Modify: `packages/plugins/demoPluginSummaries.ts`

**Interfaces:**
- Consumes (Tasks 1-3): `SungrowClient`, `SungrowAdapter`, `SungrowRegion`, `SUNGROW_SERVERS`, `SungrowPlantSummary`, `SungrowAuthError`.
- Produces:
  - `sungrowConfigDef`, `SUNGROW_SECRET_KEYS`, `type SungrowConfigKey`
  - `class SungrowPlugin implements EnergyPlugin` with `listPlants(email, password, region)` and `testConnection(email, password, region, psId)`, each returning `{ success: true, ... } | { success: false, error: string }`
  - `createSungrowRouter(deps, plugin)`

- [ ] **Step 1: Write the failing test**

Create `packages/plugins/energy/sungrow-isolarcloud/server/SungrowPlugin.test.ts`:

```ts
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SungrowPlugin } from "./SungrowPlugin.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";

function makeDeps(config: Record<string, string>): PluginDependencies {
  return {
    log: { info() {}, warn() {}, error() {}, debug() {} },
    dbLog: { info() {}, warn() {}, error() {} },
    getConfig: (key: string) => Promise.resolve(config[key] ?? ""),
    getSecret: (key: string) => Promise.resolve(config[key] ?? ""),
  } as unknown as PluginDependencies;
}

describe("SungrowPlugin", () => {
  it("identifies itself with the agreed ids", () => {
    const plugin = new SungrowPlugin(makeDeps({}));
    expect(plugin.id).toBe("sungrow_isolarcloud");
    expect(plugin.vendor).toBe("Sungrow");
    expect(plugin.settingsComponentKey).toBe("sungrow-isolarcloud-config");
  });

  it("marks password as the only secret", () => {
    expect([...new SungrowPlugin(makeDeps({})).secretKeys]).toEqual(["password"]);
  });

  it("refuses to build an adapter when config is incomplete", async () => {
    const plugin = new SungrowPlugin(makeDeps({ email: "a@b.c" }));
    await expect(plugin.createAdapter()).rejects.toThrow(
      "Sungrow iSolarCloud credentials incomplete",
    );
  });

  it("builds an adapter when config is complete", async () => {
    const plugin = new SungrowPlugin(
      makeDeps({
        email: "a@b.c",
        password: "pw",
        region: "europe",
        ps_id: "1198878",
      }),
    );
    const adapter = await plugin.createAdapter();
    expect(adapter.pollIntervalSeconds()).toBe(60);
  });

  it("reports a failed plant listing as an error result, not a throw", async () => {
    const plugin = new SungrowPlugin(makeDeps({}));
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("network down"));
    try {
      const result = await plugin.listPlants("a@b.c", "pw", "europe");
      expect(result.success).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-net --allow-read --allow-env packages/plugins/energy/sungrow-isolarcloud/`
Expected: FAIL — `./SungrowPlugin.ts` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/plugins/energy/sungrow-isolarcloud/server/config.ts`:

```ts
import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

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
```

Create `packages/plugins/energy/sungrow-isolarcloud/server/SungrowPlugin.ts`:

```ts
import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/shared/plugins";
import { SUNGROW_SECRET_KEYS, sungrowConfigDef } from "./config.ts";
import { SungrowAdapter } from "./SungrowAdapter.ts";
import {
  SungrowClient,
  type SungrowPlantSummary,
} from "./SungrowClient.ts";
import { type SungrowRegion, SUNGROW_SERVERS } from "./SungrowProtocol.ts";
import { createSungrowRouter } from "./router.ts";

export type SungrowUiResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string };

function asRegion(raw: string): SungrowRegion {
  return raw in SUNGROW_SERVERS ? raw as SungrowRegion : "europe";
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
    try {
      const plants = await this.clientFor(email, password, region).getPlants();
      this.deps.log.info(`iSolarCloud listPlants → ${plants.length} plant(s)`);
      return { success: true, plants };
    } catch (err) {
      this.deps.log.warn(`iSolarCloud listPlants failed: ${err}`);
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
    try {
      const client = this.clientFor(email, password, region);
      const plants = await client.getPlants();
      const match = plants.find((p) => p.psId === psId);
      await client.getPlantDetail(psId);
      return { success: true, systemName: match?.name ?? psId };
    } catch (err) {
      this.deps.log.warn(`iSolarCloud testConnection failed: ${err}`);
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
```

Create `packages/plugins/energy/sungrow-isolarcloud/server/router.ts`:

```ts
import { z } from "zod";
import { publicProcedure, router } from "../../../../server/src/trpc/trpc.ts";
import { SUNGROW_SECRET_KEYS, sungrowConfigDef } from "./config.ts";
import { createPluginConfigProcedures } from "../../../createPluginConfigProcedures.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { SungrowPlugin } from "./SungrowPlugin.ts";

const credentialsInput = z.object({
  email: z.string(),
  password: z.string(),
  region: z.string(),
});

const testConnectionInput = credentialsInput.extend({ psId: z.string() });

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
```

Create `packages/plugins/energy/sungrow-isolarcloud/server/index.ts`:

```ts
export * from "./SungrowPlugin.ts";
```

Create `packages/plugins/energy/sungrow-isolarcloud/routerType.ts` by copying the
shape of `packages/plugins/energy/goodwe-sems/routerType.ts` — read that file and
mirror it, substituting `createSungrowRouter` and the Sungrow paths.

Modify `packages/plugins/registerPlugins.ts` — add beside the other energy imports:

```ts
import { SungrowPlugin } from "./energy/sungrow-isolarcloud/server/index.ts";
```

and beside the other energy registrations:

```ts
energyRegistry.register(new SungrowPlugin(make("sungrow_isolarcloud")));
```

Modify `packages/plugins/demoPluginSummaries.ts` — add an entry beside the others:

```ts
  {
    id: "sungrow_isolarcloud",
    displayName: "Sungrow (Cloud / iSolarCloud)",
    vendor: "Sungrow",
    settingsComponentKey: "sungrow-isolarcloud-config",
  },
```

- [ ] **Step 4: Run tests and typecheck**

Run: `deno test --allow-net --allow-read --allow-env packages/plugins/energy/sungrow-isolarcloud/`
Expected: PASS.

Run: `deno check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/energy/sungrow-isolarcloud packages/plugins/registerPlugins.ts packages/plugins/demoPluginSummaries.ts
git commit -m "registers sungrow isolarcloud energy plugin"
```

---

### Task 5: Setup UI (form, plant picker, config panel)

Mirrors the GoodWe client, which already solves the same problem: credentials, then a station list fetched with them, then a selection.

**Files:**
- Create: `packages/plugins/energy/sungrow-isolarcloud/client/fields.ts`
- Create: `packages/plugins/energy/sungrow-isolarcloud/client/trpc.ts`
- Create: `packages/plugins/energy/sungrow-isolarcloud/client/PlantPicker.tsx`
- Create: `packages/plugins/energy/sungrow-isolarcloud/client/SungrowForm.tsx`
- Create: `packages/plugins/energy/sungrow-isolarcloud/client/SungrowConfig.tsx`
- Create: `packages/plugins/energy/sungrow-isolarcloud/client/SungrowSetupStep.tsx`
- Create: `packages/plugins/energy/sungrow-isolarcloud/client/wizardSteps.ts`
- Test: `packages/plugins/energy/sungrow-isolarcloud/client/SungrowForm.test.tsx`
- Modify: `packages/plugins/componentRegistry.ts`

**Interfaces:**
- Consumes (Task 4): the `listPlants` / `testConnection` / config procedures on the plugin router; `sungrowConfigDef` keys `email`, `password`, `region`, `ps_id`.
- Produces: `sungrowWizardSteps` (a `PluginStepDef[]`), and a settings component registered under `sungrow-isolarcloud-config`.

- [ ] **Step 1: Read the GoodWe client files to copy their structure**

Run:

```bash
cat packages/plugins/energy/goodwe-sems/client/fields.ts \
    packages/plugins/energy/goodwe-sems/client/trpc.ts \
    packages/plugins/energy/goodwe-sems/client/StationPicker.tsx \
    packages/plugins/energy/goodwe-sems/client/GoodweSemsForm.tsx \
    packages/plugins/energy/goodwe-sems/client/GoodweSemsConfig.tsx \
    packages/plugins/energy/goodwe-sems/client/GoodweSemsSetupStep.tsx \
    packages/plugins/energy/goodwe-sems/client/wizardSteps.ts
```

These are the templates. The Sungrow versions differ in exactly three ways:
1. `account` → `email`, `station_id` → `ps_id`, station → plant in labels.
2. An extra **region** field: a select over `europe | international | australia | china | india`, defaulting to `europe`, labelled "Server region". It must be set before the plant list can load, and the help text should say that picking the wrong region makes login fail.
3. No "SEMS+" toggle — Sungrow has no equivalent.

- [ ] **Step 2: Write the failing form test**

Create `packages/plugins/energy/sungrow-isolarcloud/client/SungrowForm.test.tsx`, modelled on `GoodweSemsForm.test.tsx` (read it first). It must cover:

```
- renders email, password and region fields
- defaults the region select to europe
- disables the "Load plants" action until email and password are non-empty
- renders the returned plants as selectable options after a successful listPlants
- shows the error string when listPlants returns { success: false }
```

Copy the harness/mocking approach from `GoodweSemsForm.test.tsx` verbatim —
it already mocks the plugin tRPC client.

- [ ] **Step 3: Run test to verify it fails**

Run: `deno task --filter client test`
Expected: FAIL — components not found.

- [ ] **Step 4: Implement the client components**

Write the seven client files by adapting the GoodWe equivalents per the three
differences in Step 1. Then modify `packages/plugins/componentRegistry.ts`:

add the import beside the other energy wizard steps:

```ts
import { sungrowWizardSteps } from "./energy/sungrow-isolarcloud/client/wizardSteps.ts";
```

and the entry in `energyPluginSteps`:

```ts
  sungrow_isolarcloud: sungrowWizardSteps,
```

Also register the settings component in the same map that holds
`"goodwe-sems-config": GoodweSemsConfig` (`packages/plugins/componentRegistry.ts:141`):

```ts
  "sungrow-isolarcloud-config": SungrowConfig,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno task --filter client test`
Expected: PASS.

Run: `deno check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/plugins/energy/sungrow-isolarcloud/client packages/plugins/componentRegistry.ts
git commit -m "adds sungrow isolarcloud setup ui"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run the whole suite**

Run: `deno task test`
Expected: PASS. If anything unrelated fails, check whether it failed before your
changes (`git stash` and re-run) before investigating.

- [ ] **Step 2: Typecheck**

Run: `deno check`
Expected: no errors.

- [ ] **Step 3: Verify the plugin appears**

Start the server (`deno task dev:server`), open the energy plugin list in
settings, and confirm "Sungrow (Cloud / iSolarCloud)" is selectable and its
wizard renders the region select and plant picker.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fixes issues found in full verification"
```
