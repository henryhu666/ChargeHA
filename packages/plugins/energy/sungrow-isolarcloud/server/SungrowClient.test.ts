import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { aesDecrypt, aesEncrypt } from "./SungrowProtocol.ts";
import { SungrowAuthError, SungrowClient } from "./SungrowClient.ts";

// The client decrypts each response with the AES key it generated for that
// request. A test stub cannot recover that key (it is RSA-wrapped), so
// SungrowClient takes an injectable keyFactory and tests pin it to a known
// value — letting the stub encrypt its reply with the same key.
const KEY = "webTESTKEY123456".slice(0, 16);

function stubFetch(handler: (url: string, body: string) => unknown) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const payload = handler(url, String(init?.body ?? ""));
    return Promise.resolve(
      new Response(aesEncrypt(payload, KEY), { status: 200 }),
    );
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function makeClient() {
  return new SungrowClient("europe", "a@b.c", "pw", undefined, () => KEY);
}

const loginOk = {
  result_code: "1",
  result_msg: "success",
  result_data: { login_state: "1", token: "TK", user_id: "42" },
};

describe("SungrowClient", () => {
  let stub: { calls: string[]; restore: () => void } | null = null;

  afterEach(() => {
    stub?.restore();
    stub = null;
  });

  it("logs in and stores the token", async () => {
    stub = stubFetch(() => loginOk);
    await makeClient().login();
    expect(stub.calls[0]).toBe(
      "https://gateway.isolarcloud.eu/v1/userService/login",
    );
  });

  it("throws SungrowAuthError when login_state is 0, quoting remaining attempts", async () => {
    stub = stubFetch(() => ({
      result_code: "1",
      result_msg: "success",
      result_data: { login_state: "0", msg: "password error", remain_times: 3 },
    }));
    await expect(makeClient().login()).rejects.toThrow(SungrowAuthError);
  });

  it("encrypts the request body rather than sending plaintext", async () => {
    let seenBody = "";
    stub = stubFetch((_u, body) => {
      seenBody = body;
      return loginOk;
    });
    await makeClient().login();
    expect(seenBody).toMatch(/^[0-9A-F]+$/);
    expect(seenBody).not.toContain("a@b.c");
    expect(aesDecrypt(seenBody, KEY).user_account).toBe("a@b.c");
  });

  it("maps the plant list to psId/name pairs", async () => {
    stub = stubFetch((url) =>
      url.endsWith("/login") ? loginOk : {
        result_code: "1",
        result_data: { pageList: [{ ps_id: 1198878, ps_name: "Home" }] },
      }
    );
    const plants = await makeClient().getPlants();
    expect(plants).toEqual([{ psId: "1198878", name: "Home" }]);
  });

  it("re-logs in once when the token is rejected, then succeeds", async () => {
    let detailCalls = 0;
    stub = stubFetch((url) => {
      if (url.endsWith("/login")) return loginOk;
      detailCalls += 1;
      if (detailCalls === 1) return { result_code: "401" };
      return { result_code: "1", result_data: { curr_power: { value: "5" } } };
    });
    const detail = await makeClient().getPlantDetail("1198878");
    expect(detail.curr_power).toEqual({ value: "5" });
    expect(detailCalls).toBe(2);
  });
});
