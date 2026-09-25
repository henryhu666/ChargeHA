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
      expect(SUNGROW_SERVERS.australia).toBe(
        "https://augateway.isolarcloud.com",
      );
    });
  });
});
