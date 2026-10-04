import { describe, expect, test } from "bun:test";

import { secretEquals, deriveSigningKey, hmacHex } from "../src/secrets";

describe("secretEquals", () => {
  test("matching strings return true", async () => {
    expect(await secretEquals("hunter2", "hunter2")).toBe(true);
  });

  test("non-matching strings return false", async () => {
    expect(await secretEquals("hunter2", "hunter3")).toBe(false);
  });

  test("different lengths return false", async () => {
    expect(await secretEquals("short", "a much longer string")).toBe(false);
  });

  test("empty strings match each other", async () => {
    expect(await secretEquals("", "")).toBe(true);
  });

  test("empty vs non-empty returns false", async () => {
    expect(await secretEquals("", "x")).toBe(false);
  });

  test("unicode strings compare correctly", async () => {
    expect(await secretEquals("café☕", "café☕")).toBe(true);
    expect(await secretEquals("café☕", "cafe☕")).toBe(false);
  });
});

describe("deriveSigningKey", () => {
  test("returns a CryptoKey usable for HMAC signing", async () => {
    const key = await deriveSigningKey("test-material");
    expect(key).toBeDefined();
    // Verify it can sign — would throw if the key were wrong.
    const sig = await crypto.subtle.sign("HMAC", key, new Uint8Array([1]));
    expect(sig.byteLength).toBe(32);
  });

  test("caches: same material returns the same promise", () => {
    const a = deriveSigningKey("same");
    const b = deriveSigningKey("same");
    expect(a).toBe(b);
  });

  test("different material returns a different key", async () => {
    const a = await deriveSigningKey("material-a");
    const b = await deriveSigningKey("material-b");
    // Sign the same message with both; the signatures must differ.
    const msg = new TextEncoder().encode("test");
    const [sigA, sigB] = await Promise.all([
      crypto.subtle.sign("HMAC", a, msg),
      crypto.subtle.sign("HMAC", b, msg),
    ]);
    expect(new Uint8Array(sigA)).not.toEqual(new Uint8Array(sigB));
  });
});

describe("hmacHex", () => {
  test("returns a 64-character lowercase hex string", async () => {
    const key = await deriveSigningKey("hex-test");
    const hex = await hmacHex(key, "hello");
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic", async () => {
    const key = await deriveSigningKey("deterministic");
    expect(await hmacHex(key, "same")).toBe(await hmacHex(key, "same"));
  });

  test("different messages produce different digests", async () => {
    const key = await deriveSigningKey("differ");
    expect(await hmacHex(key, "one")).not.toBe(await hmacHex(key, "two"));
  });
});
