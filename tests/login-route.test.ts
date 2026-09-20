import { expect, test } from "bun:test";
import { Route } from "../src/routes/login";

test("login enters the hosted sign-in flow without an intermediate page", async () => {
  expect(Route.options.beforeLoad).toBeDefined();

  try {
    await Route.options.beforeLoad!({} as never);
    throw new Error("Expected the login route to redirect");
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(307);
    expect((error as Response & { options?: unknown }).options).toMatchObject({
      to: "/api/auth/sign-in",
      reloadDocument: true,
    });
  }
});
