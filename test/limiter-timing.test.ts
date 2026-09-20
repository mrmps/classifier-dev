import { expect, test } from "bun:test";
import { RateLimiter } from "../src/limiter";

function fixture(delay = 0, failWrite = false) {
  const saved = new Map<string, unknown>();
  let writes = 0;
  const storage = {
    get: async (key: string) => { await new Promise(resolve => setTimeout(resolve, delay)); return structuredClone(saved.get(key)); },
    put: async (values: Record<string, unknown>) => {
      await new Promise(resolve => setTimeout(resolve, delay));
      if (failWrite) throw new Error("storage unavailable");
      writes++;
      for (const [key, value] of Object.entries(values)) saved.set(key, structuredClone(value));
    },
  };
  return { limiter: new RateLimiter({ storage } as unknown as DurableObjectState), saved, writes: () => writes };
}

function timing(response: Response) {
  const header = response.headers.get("server-timing");
  expect(header).toMatch(/^handler;dur=\d+\.\d{2}, read;dur=\d+\.\d{2}, write;dur=\d+\.\d{2}$/);
  return Object.fromEntries(header!.split(", ").map(part => {
    const [name, duration] = part.split(";dur=");
    return [name, Number(duration)];
  }));
}

test("limiter measures awaited reads and write without changing the admission result", async () => {
  const f = fixture(12);
  const response = await f.limiter.fetch(new Request("https://limiter/?limit=60&daily=2000&cost=2"));
  expect(await response.json()).toEqual({ limited: false, remaining: 58, dailyRemaining: 1998 });
  const spans = timing(response);
  expect(spans.read).toBeGreaterThanOrEqual(20);
  expect(spans.write).toBeGreaterThanOrEqual(10);
  expect(spans.handler).toBeGreaterThanOrEqual(spans.read + spans.write - .1);
  expect(f.writes()).toBe(1);
  expect(f.saved.get("b")).toMatchObject({ n: 2 });
  expect(f.saved.get("d")).toMatchObject({ n: 2 });
});

test.each(["minute", "day"])("%s refusal has numeric timing, zero write time and no debit", async scope => {
  const f = fixture();
  const response = await f.limiter.fetch(new Request(`https://limiter/?limit=${scope === "minute" ? 0 : 60}&daily=${scope === "day" ? 0 : 2000}`));
  expect(await response.json()).toMatchObject({ limited: true, scope, remaining: 0 });
  expect(timing(response).write).toBe(0);
  expect(f.writes()).toBe(0);
  expect(f.saved.size).toBe(0);
});

test("instrumentation does not suppress storage write failure", async () => {
  const f = fixture(0, true);
  await expect(f.limiter.fetch(new Request("https://limiter/"))).rejects.toThrow("storage unavailable");
});

test("timing=1 includes pending durability in write time; ordinary requests do not explicitly sync", async () => {
  let syncs = 0, committed = false;
  const limiter = new RateLimiter({ storage: {
    get: async () => undefined,
    put: async () => { committed = false; },
    sync: async () => {
      syncs++;
      await new Promise(resolve => setTimeout(resolve, 15));
      committed = true;
    },
  } } as unknown as DurableObjectState);
  const ordinary = await limiter.fetch(new Request("https://limiter/"));
  expect((await ordinary.json()).limited).toBe(false);
  expect(syncs).toBe(0);
  const measured = await limiter.fetch(new Request("https://limiter/?timing=1"));
  expect(committed).toBe(true);
  expect(syncs).toBe(1);
  expect(timing(measured).write).toBeGreaterThanOrEqual(10);
  expect((await measured.json()).limited).toBe(false);
  await limiter.fetch(new Request("https://limiter/?timing=true"));
  expect(syncs).toBe(1);
});

test("timing=1 does not sync rejected work or suppress durability errors", async () => {
  let syncs = 0;
  const limiter = new RateLimiter({ storage: {
    get: async () => undefined,
    put: async () => {},
    sync: async () => { syncs++; throw new Error("commit failed"); },
  } } as unknown as DurableObjectState);
  const denied = await limiter.fetch(new Request("https://limiter/?timing=1&limit=0"));
  expect((await denied.json()).limited).toBe(true);
  expect(syncs).toBe(0);
  await expect(limiter.fetch(new Request("https://limiter/?timing=1"))).rejects.toThrow("commit failed");
  expect(syncs).toBe(1);
});
