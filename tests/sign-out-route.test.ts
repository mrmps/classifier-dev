import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("sign-out converts AuthKit redirects to GET navigation and clears both session cookies", () => {
  const result = spawnSync(process.execPath, ["-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    import { redirect } from "@tanstack/react-router";
    let signedIn = true, fail = false, calls = 0;
    const bindings = { WORKOS_API_KEY: "test", WORKOS_CLIENT_ID: "test",
      WORKOS_REDIRECT_URI: "https://example.test/api/auth/callback",
      WORKOS_COOKIE_PASSWORD: "test-cookie-password-at-least-32-characters" };
    mock.module("cloudflare:workers", () => ({ env: bindings }));
    mock.module("@workos/authkit-tanstack-react-start", () => ({
      signOut: async ({data}) => {
        calls++;
        assert.equal(data.returnTo, "https://example.test/");
        if (fail) throw new Error("Provider unavailable");
        throw signedIn ? redirect({href:"https://api.workos.com/user_management/sessions/logout?session_id=test",
          headers:{"Set-Cookie":"wos-session=; Path=/; Max-Age=0; HttpOnly; Secure"}})
          : redirect({to:"/"});
      }
    }));
    const { Route } = await import("./src/routes/auth.sign-out.ts");
    const post = Route.options.server.handlers.POST;
    const request = new Request("https://example.test/auth/sign-out", {method:"POST",headers:{Origin:"https://example.test"}});
    const response = await post({request});
    assert.equal(response.status,303);
    assert.equal(new URL(response.headers.get("Location")).hostname,"api.workos.com");
    assert.match(response.headers.get("Set-Cookie"), /wos-session=/);
    assert.match(response.headers.get("Set-Cookie"), /classifier_workspace=;.*Max-Age=0/);
    signedIn = false;
    const expired = await post({request});
    assert.equal(expired.status,303);
    assert.equal(expired.headers.get("Location"),"/");
    assert.match(expired.headers.get("Set-Cookie"), /classifier_workspace=/);
    await assert.rejects(post({request:new Request(request,{headers:{Origin:"https://attacker.test"}})}), /origin does not match/);
    assert.equal(calls,2);
    fail = true;
    await assert.rejects(post({request}), /Provider unavailable/);
    bindings.WORKOS_API_KEY = "";
    assert.equal((await post({request})).status,503);
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
