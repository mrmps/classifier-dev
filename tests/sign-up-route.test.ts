import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("sign-up binds only safe workspace destinations and fails closed when unconfigured", () => {
  // Isolate module mocks from the rest of the worker suite.
  const result = spawnSync(process.execPath, ["-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    const env = {
      WORKOS_API_KEY: "test", WORKOS_CLIENT_ID: "test",
      WORKOS_REDIRECT_URI: "https://example.test/api/auth/callback",
      WORKOS_COOKIE_PASSWORD: "test-cookie-password-at-least-32-characters"
    };
    let destination, calls = 0;
    mock.module("cloudflare:workers", () => ({ env }));
    mock.module("@workos/authkit-tanstack-react-start", () => ({
      getSignUpUrl: async ({data}) => {
        calls++;
        destination = data.returnPathname;
        return "https://auth.example.test/sign-up?state=signup-flow";
      }
    }));
    const { Route } = await import("./src/routes/auth.sign-up.ts");
    const signUp = (returnTo) => {
      const url = new URL("https://example.test/auth/sign-up");
      if (returnTo !== undefined) url.searchParams.set("returnTo", returnTo);
      return Route.options.server.handlers.GET({request: new Request(url)});
    };
    for (const [requested, expected] of [
      [undefined, "/app"], ["", "/app"],
      ["/app/plans", "/app/plans"],
      ["/app/keys?created=1#new", "/app/keys?created=1"],
      ["https://evil.test/app", "/app"], ["//evil.test/app", "/app"],
      ["/application", "/app"], ["/login", "/app"],
      ["/app/../login", "/app"], ["/app/%2e%2e/login", "/app"],
      ["/app/..\\\\login", "/app"]
    ]) {
      const response = await signUp(requested);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("Location"), "https://auth.example.test/sign-up?state=signup-flow");
      assert.match(response.headers.get("Set-Cookie"), /classifier_auth_return_/);
      assert.equal(destination, expected);
    }
    const configuredCalls = calls;
    env.WORKOS_API_KEY = "";
    const response = await signUp("/app/plans");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Location"), null);
    assert.match(await response.text(), /sign-up is not configured/);
    assert.equal(calls, configuredCalls);
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
