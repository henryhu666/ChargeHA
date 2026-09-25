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
        `iSolarCloud request failed: ${
          err instanceof Error ? err.message : err
        }`,
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
