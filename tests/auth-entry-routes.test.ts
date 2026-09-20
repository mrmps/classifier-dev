import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("sign-in binds a safe destination and callback preserves AuthKit state", () => {
  const result = spawnSync(process.execPath, ["-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    let destination, options;
    mock.module("cloudflare:workers", () => ({ env: {
      WORKOS_API_KEY:"test", WORKOS_CLIENT_ID:"test",
      WORKOS_REDIRECT_URI:"https://example.test/api/auth/callback",
      WORKOS_COOKIE_PASSWORD:"test-cookie-password-at-least-32-characters"
    } }));
    mock.module("@workos/authkit-tanstack-react-start", () => ({
      getSignInUrl: async ({data}) => { destination=data.returnPathname; return "https://auth.example.test?state=flow-test"; },
      handleCallbackRoute: (configuration) => { options=configuration; return async () => new Response(null, {
        status:302, headers:{Location:destination,"Set-Cookie":"wos-session=test; HttpOnly; Secure"}
      }); }
    }));
    const {Route:signIn} = await import("./src/routes/api.auth.sign-in.ts");
    const {Route:callback} = await import("./src/routes/api.auth.callback.ts");
    const {Route:login} = await import("./src/routes/login.tsx");
    for (const [query, expected] of [["", "/app"], ["?returnTo=/app/plans", "/app/plans"], ["?returnPathname=/app/usage", "/app/usage"], ["?returnTo=//evil.test/app", "/app"], ["?returnTo=/app/../login", "/app"]]) {
      const signInResponse = await signIn.options.server.handlers.GET({request:new Request("https://example.test/api/auth/sign-in"+query)});
      assert.equal(destination,expected);
      const response = await callback.options.server.handlers.GET({request:new Request("https://example.test/api/auth/callback?state=flow-test", {headers:{Cookie:signInResponse.headers.get("Set-Cookie").split(";")[0]}})});
      assert.equal(options.returnPathname,undefined);
      assert.equal(options.errorRedirectUrl,"/login?error=auth_failed&returnTo="+encodeURIComponent(expected));
      assert.equal(response.headers.get("Location"),expected);
      assert.match(response.headers.get("Set-Cookie"),/wos-session=/);
      assert.match(response.headers.get("Set-Cookie"),/classifier_workspace=;/);
      assert.match(response.headers.get("Set-Cookie"),/classifier_auth_return_.*Max-Age=0/);
    }
    const invitationResponse = await signIn.options.server.handlers.GET({request:new Request("https://example.test/api/auth/sign-in?invitation_token=invite_test")});
    assert.equal(new URL(invitationResponse.headers.get("Location")).searchParams.get("invitation_token"), "invite_test");
    assert.equal(new URL(invitationResponse.headers.get("Location")).searchParams.get("state"), "flow-test");
    const search=login.options.validateSearch({error:"auth_failed",returnTo:"/app/plans"});
    assert.equal(login.options.beforeLoad({search}),undefined);
    try { login.options.beforeLoad({search:login.options.validateSearch({returnTo:"/app/plans"})}); assert.fail("must redirect"); }
    catch(error) { assert.match(error.options.href,/returnTo=%2Fapp%2Fplans/); }
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
