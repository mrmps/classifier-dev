import { describe, expect, test } from "bun:test";

import { callerId, labelFingerprint, normalizeLabels } from "../src/privacy";

const env = { PRIVACY_SALT: "salt-under-test-0000000000000000" };
const other = { PRIVACY_SALT: "a-different-salt-0000000000000000" };

describe("caller pseudonyms", () => {
  test("never carry the address, in any form", async () => {
    const ip = "203.0.113.47";
    const id = await callerId(env, ip);
    expect(id).not.toContain(ip);
    expect(id).not.toContain("203");
    expect(id).toMatch(/^c_[0-9a-f]{16}$/);
  });

  test("are the same caller within a day, and differ between callers", async () => {
    expect(await callerId(env, "203.0.113.47")).toBe(await callerId(env, "203.0.113.47"));
    expect(await callerId(env, "203.0.113.47")).not.toBe(await callerId(env, "203.0.113.48"));
  });

  test("cannot be reproduced without the salt", async () => {
    expect(await callerId(env, "203.0.113.47")).not.toBe(await callerId(other, "203.0.113.47"));
  });

  test("leave an unknown address alone rather than inventing one", async () => {
    expect(await callerId(env, "anon")).toBe("anon");
    expect(await callerId(env, "")).toBe("anon");
  });
});

describe("label fingerprints", () => {
  test("never carry the labels", async () => {
    const fp = await labelFingerprint(env, ["invoice", "receipt", "payslip"]);
    expect(fp).toMatch(/^ls_[0-9a-f]{16}$/);
    for (const label of ["invoice", "receipt", "payslip"]) expect(fp).not.toContain(label);
  });

  test("ignore order and case, the way the classifier does", async () => {
    expect(await labelFingerprint(env, ["spam", "ham"])).toBe(await labelFingerprint(env, [" HAM ", "Spam"]));
  });

  test("separate different label sets", async () => {
    expect(await labelFingerprint(env, ["spam", "ham"])).not.toBe(await labelFingerprint(env, ["spam", "eggs"]));
  });

  test("are empty for no labels, so nothing is registered for them", async () => {
    expect(await labelFingerprint(env, [])).toBe("");
    expect(await labelFingerprint(env, ["  "])).toBe("");
  });

  test("cannot be reproduced without the salt", async () => {
    expect(await labelFingerprint(env, ["spam", "ham"])).not.toBe(await labelFingerprint(other, ["spam", "ham"]));
  });
});

test("normalizing labels drops blanks and sorts", () => {
  expect(normalizeLabels(["B", "a", " ", "C "])).toBe("a|b|c");
});
