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
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCkecphb6vgsBx4LJknKKes+eyj
7+RKQ3fikF5B67EObZ3t4moFZyMGuuJPiadYdaxvRqtxyblIlVM7omAasROtKRht
gKwwRxo2a6878qBhTgUVlsqugpI/7ZC9RmO2Rpmr8WzDeAapGANfHN5bVr7G7GYG
wIrjvyxMrAVit/oM4wIDAQAB
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
