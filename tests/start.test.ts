import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("request middleware skips AuthKit only when WorkOS is unconfigured", () => {
  for (const configured of [false, true]) {
    // Separate processes keep framework mocks out of the rest of the suite.
    const result = spawnSync(process.execPath, ["-e", `
      import { mock } from "bun:test";
      const bindings = ${JSON.stringify(configured ? {
        WORKOS_API_KEY: "test", WORKOS_CLIENT_ID: "test",
        WORKOS_REDIRECT_URI: "https://example.test/api/auth/callback",
        WORKOS_COOKIE_PASSWORD: "test-cookie-password-at-least-32-characters",
      } : {})};
      for (const key of ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_REDIRECT_URI", "WORKOS_COOKIE_PASSWORD"])
        delete process.env[key];
      Object.assign(process.env, bindings);
      mock.module("@tanstack/react-start", () => ({
        createStart: (configure) => configure(),
        createCsrfMiddleware: () => "csrf",
      }));
      mock.module("@workos/authkit-tanstack-react-start", () => ({
        authkitMiddleware: () => "authkit",
      }));
      const { startInstance } = await import("./src/start.ts");
      console.log(JSON.stringify(startInstance.requestMiddleware));
    `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual(configured ? ["csrf", "authkit"] : ["csrf"]);
  }
});
