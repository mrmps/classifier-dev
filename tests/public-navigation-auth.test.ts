import { expect, test } from "bun:test";
import {
  mayRenderPublicHtml,
  publicNavigationAuth,
} from "../src/server/public-navigation-auth";
import type { AppEnv } from "../src/server/db";

const configuredEnv = {
  WORKOS_API_KEY: "sk_test",
  WORKOS_CLIENT_ID: "client_test",
  WORKOS_REDIRECT_URI: "https://classifier.dev/api/auth/callback",
  WORKOS_COOKIE_PASSWORD: "test-cookie-password-at-least-32-characters",
} as AppEnv;

test("public HTML detection matches explicit and browser fallback negotiation", () => {
  expect(
    mayRenderPublicHtml(
      new Request("https://classifier.dev/?format=html", {
        headers: { Accept: "*/*", "User-Agent": "curl/8" },
      }),
    ),
  ).toBe(true);
  expect(
    mayRenderPublicHtml(
      new Request("https://classifier.dev/docs", {
        headers: { Accept: "*/*", "User-Agent": "Mozilla/5.0" },
      }),
    ),
  ).toBe(true);
  for (const request of [
    new Request("https://classifier.dev/?format=text", {
      headers: { Accept: "text/html" },
    }),
    new Request("https://classifier.dev/docs", {
      headers: { Accept: "text/markdown", "User-Agent": "Mozilla/5.0" },
    }),
    new Request("https://classifier.dev/docs", {
      headers: { Accept: "*/*", "User-Agent": "curl/8" },
    }),
    new Request("https://classifier.dev/openapi.json", {
      headers: { Accept: "*/*", "User-Agent": "Mozilla/5.0" },
    }),
    new Request("https://classifier.dev/robots.txt", {
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
    }),
    new Request("https://classifier.dev/?labels=yes,no&text=maybe", {
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
    }),
  ])
    expect(mayRenderPublicHtml(request)).toBe(false);
});

test("public navigation trusts a validated WorkOS session", async () => {
  const result = await publicNavigationAuth(
    new Request("https://classifier.dev/", {
      headers: { Cookie: "wos-session=encrypted" },
    }),
    configuredEnv,
    async () => ({ auth: { user: { id: "user_1" } } }),
  );

  expect(result).toEqual({ signedIn: true, setCookies: [] });
});

test("public navigation stays signed out when AuthKit rejects a session", async () => {
  const result = await publicNavigationAuth(
    new Request("https://classifier.dev/", {
      headers: { Cookie: "wos-session=tampered" },
    }),
    configuredEnv,
    async () => ({ auth: { user: null } }),
  );

  expect(result).toEqual({ signedIn: false, setCookies: [] });
});

test("public navigation carries refreshed WorkOS cookies to the response", async () => {
  let saved = "";
  const result = await publicNavigationAuth(
    new Request("https://classifier.dev/"),
    configuredEnv,
    async () => ({
      auth: { user: { id: "user_1" } },
      refreshedSessionData: "refreshed-session",
      saveSession: async (session) => {
        saved = session;
        return ["wos-session=refreshed; Path=/; HttpOnly; Secure"];
      },
    }),
  );

  expect(saved).toBe("refreshed-session");
  expect(result.setCookies).toEqual([
    "wos-session=refreshed; Path=/; HttpOnly; Secure",
  ]);
});
