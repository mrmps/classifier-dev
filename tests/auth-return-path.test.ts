import { expect, test } from "bun:test";
import { authReturnPath } from "../src/lib/auth-return-path";

test("authentication preserves workspace destinations and defaults to the dashboard", () => {
  expect(authReturnPath("/app/plans")).toBe("/app/plans");
  expect(authReturnPath("/app/usage?period=month")).toBe("/app/usage?period=month");
  expect(authReturnPath("/app")).toBe("/app");
  for (const path of [undefined, null, {}, "", "https://evil.test/app", "//evil.test/app", "/app/../../login", "/app/%2e%2e/login", "/app\\..\\login", "/application", "/login"])
    expect(authReturnPath(path)).toBe("/app");
});
