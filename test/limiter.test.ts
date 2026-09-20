import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { RateLimiter } from "../src/limiter";

afterEach(() => mock.restore());

function limiter() {
  const data = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => structuredClone(data.get(key)),
    put: async (key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === "string") data.set(key, structuredClone(value));
      else for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v));
    },
  };
  const instance = new RateLimiter({ storage, blockConcurrencyWhile: (fn: () => Promise<unknown>) => fn() } as unknown as DurableObjectState);
  return async (cost: number, limit = 10, daily = 15) => (await instance.fetch(
    new Request(`https://limiter/?cost=${cost}&limit=${limit}&daily=${daily}`),
  )).json() as Promise<{ limited: boolean; scope?: string; remaining: number; dailyRemaining?: number; resetIn?: number }>;
}

test("a batch must fit the minute quota and rejected batches spend nothing", async () => {
  spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 19, 12, 0, 30));
  const take = limiter();
  expect((await take(7)).limited).toBe(false);
  expect(await take(4)).toMatchObject({ limited: true, scope: "minute", resetIn: 30 });
  expect((await take(3)).limited).toBe(false);
  expect((await take(1)).limited).toBe(true);
});

test("daily quota includes the entire batch and expires at UTC midnight", async () => {
  const time = spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 19, 23, 59, 30));
  const take = limiter();
  expect((await take(14, 100)).limited).toBe(false);
  expect(await take(2, 100)).toMatchObject({ limited: true, scope: "day", resetIn: 30 });
  expect((await take(1, 100)).limited).toBe(false);
  time.mockReturnValue(Date.UTC(2026, 8, 20));
  expect(await take(10)).toMatchObject({ limited: false, remaining: 0, dailyRemaining: 5 });
});

test("a batch larger than a fresh minute quota is rejected", async () => {
  expect(await limiter()(1000, 200, 2000)).toMatchObject({ limited: true, scope: "minute" });
});
