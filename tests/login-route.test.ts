import { expect, test } from "bun:test";
import { Route } from "../src/routes/login";

test("login enters the hosted sign-in flow without an intermediate page", async () => {
  expect(Route.options.beforeLoad).toBeDefined();

  try {
    await Route.options.beforeLoad!({ search: { returnTo: "/app" } } as never);
    throw new Error("Expected the login route to redirect");
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(307);
    expect((error as Response & { options?: unknown }).options).toMatchObject({
      href: "/api/auth/sign-in?returnTo=%2Fapp",
      reloadDocument: true,
    });
  }
});
