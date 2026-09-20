import { expect, test } from "bun:test";
import { authNavigationResponse, callbackNavigation } from "../src/server/auth-navigation";

test("failed login remembers only its own safe destination and expires the navigation cookie", async () => {
  const request = new Request("https://example.test/api/auth/sign-in");
  const first = await authNavigationResponse("https://auth.test?state=first", "/app/plans", request);
  const second = await authNavigationResponse("https://auth.test?state=second", "/app/usage", request);
  const cookies = [first, second].map(response => response.headers.get("Set-Cookie")!.split(";")[0]);
  expect(cookies[0].split("=")[0]).not.toBe(cookies[1].split("=")[0]);
  expect(first.headers.get("Set-Cookie")).toContain("HttpOnly; SameSite=Lax; Max-Age=3600; Secure");
  for (const [state, destination] of [["first", "/app/plans"], ["second", "/app/usage"], ["missing", "/app"]]) {
    const navigation = await callbackNavigation(new Request(`https://example.test/api/auth/callback?state=${state}`, { headers: { Cookie: cookies.join("; ") } }));
    expect(navigation.errorRedirectUrl).toBe(`/login?error=auth_failed&returnTo=${encodeURIComponent(destination)}`);
    expect(navigation.clearCookie).toContain("Max-Age=0");
  }
  for (const value of ["https://evil.test", "/app/../login", "%malformed"]) {
    const navigation = await callbackNavigation(new Request("https://example.test/api/auth/callback?state=first", { headers: { Cookie: cookies[0].split("=")[0] + "=" + value } }));
    expect(navigation.errorRedirectUrl).toContain("returnTo=%2Fapp");
  }
  expect((await callbackNavigation(new Request("https://example.test/api/auth/callback"))).clearCookie).toBeNull();
});
