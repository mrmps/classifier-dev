import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { QuotaCoordinator, admit, type Quota } from "../src/admission";
import { RateLimiter } from "../src/limiter";

afterEach(() => mock.restore());
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

function fixture() {
  const stores = new Map<string, Map<string, unknown>>();
  const writes = new Map<string, number>();
  let failImport = false;
  const env = {} as {LIMITER: DurableObjectNamespace; QUOTAS: DurableObjectNamespace};
  function namespace(kind: "legacy" | "quota") {
    const instances = new Map<string, RateLimiter | QuotaCoordinator>();
    return {
      idFromName: hash, idFromString: (s: string) => s,
      get(id: string) {
        if (!instances.has(id)) {
          const data = new Map<string, unknown>();
          stores.set(id, data);
          let gate = Promise.resolve();
          const state = { id, storage: {
            get: async (key: string) => structuredClone(data.get(key)),
            put: async (key: string | Record<string,unknown>, value?: unknown) => {
              if (kind === "quota" && failImport) { failImport = false; throw new Error("interrupted import"); }
              writes.set(id, (writes.get(id) ?? 0) + 1);
              for (const [k,v] of Object.entries(typeof key === "string" ? {[key]:value} : key)) data.set(k, structuredClone(v));
            },
            sync: async () => {},
          }, blockConcurrencyWhile<T>(fn: () => Promise<T>) {
            const next = gate.then(fn);
            gate = next.then(() => {}, () => {});
            return next;
          }} as unknown as DurableObjectState;
          instances.set(id, kind === "legacy" ? new RateLimiter(state, env) : new QuotaCoordinator(state, env));
        }
        return {fetch: (url: string, init?: RequestInit) => instances.get(id)!.fetch(new Request(url, init))};
      },
    } as unknown as DurableObjectNamespace;
  }
  env.LIMITER = namespace("legacy"); env.QUOTAS = namespace("quota");
  const quota = (scope: string, cost = 1, limit = 10, daily = 20): Omit<Quota,"id"> => ({scope,cost,limit,daily});
  const take = async (qs: Omit<Quota,"id">[], owner = "caller") => (await admit(env, owner, qs)).json() as Promise<any>;
  const legacy = async (scope: string, cost = 1) => (await env.LIMITER.get(env.LIMITER.idFromName(`${scope}:caller`)).fetch(`https://limiter/?cost=${cost}&limit=10&daily=20`)).json() as Promise<any>;
  return {env, quota, take, legacy, stores, writes, failNextImport: () => {failImport = true;}};
}

test("imports existing allowances, then writes tier and lane in one durable operation", async () => {
  const f = fixture();
  await f.legacy("fast", 6); await f.legacy("laya:fast", 3);
  expect(await f.take([f.quota("fast", 1), f.quota("laya:fast", 2)])).toMatchObject({limited:false,remaining:3,laneRemaining:5});
  const before = f.writes.get(hash("caller"))!;
  expect(await f.take([f.quota("fast"), f.quota("laya:fast")])).toMatchObject({limited:false,remaining:2,laneRemaining:4});
  expect(f.writes.get(hash("caller"))! - before).toBe(1);
  expect(await f.legacy("fast", 3)).toMatchObject({limited:true});
  expect(await f.legacy("laya:fast", 4)).toMatchObject({limited:false,remaining:0});
});

test("Jev shares tier allowance, and Laya shares lane allowance across tiers", async () => {
  const f = fixture();
  await f.take([f.quota("fast", 7)]);
  await f.take([f.quota("fast", 1),f.quota("laya:fast", 6)]);
  expect(await f.take([f.quota("smart", 1),f.quota("laya:fast", 5)])).toMatchObject({limited:true,limitedBy:"lane"});
  expect(await f.take([f.quota("fast", 3),f.quota("laya:bulk", 1)])).toMatchObject({limited:true,limitedBy:"tier"});
  expect(await f.take([f.quota("smart", 9)])).toMatchObject({limited:false,remaining:0});
  expect(await f.take([f.quota("laya:bulk", 10)])).toMatchObject({limited:false,laneRemaining:0});
});

test("owners remain isolated and enterprise can use only a lane", async () => {
  const f = fixture();
  expect(await f.take([f.quota("laya:fast", 10)], "one")).toMatchObject({limited:false});
  expect(await f.take([f.quota("laya:fast")], "one")).toMatchObject({limited:true});
  expect(await f.take([f.quota("laya:fast")], "two")).toMatchObject({limited:false});
});

test("an interrupted snapshot import resumes through a stale legacy caller", async () => {
  const f = fixture();
  await f.legacy("fast", 8);
  f.failNextImport();
  await expect(f.take([f.quota("fast")])).rejects.toThrow("interrupted import");
  expect(await f.legacy("fast")).toMatchObject({limited:false,remaining:1});
  expect(await f.take([f.quota("fast")])).toMatchObject({limited:false,remaining:0});
  expect(await f.legacy("fast")).toMatchObject({limited:true});
});

test("concurrent old and new callers never reset or overspend a transferred counter", async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({length:40}, (_, i) => i % 2 ? f.legacy("fast") : f.take([f.quota("fast")])));
  expect(results.filter(r => !r.limited)).toHaveLength(10);
});

test("daily and minute windows survive migration and expire at their original boundaries", async () => {
  const clock = spyOn(Date,"now").mockReturnValue(Date.UTC(2026,8,20,23,59,30));
  const f = fixture();
  await f.legacy("fast", 9);
  expect(await f.take([f.quota("fast", 1, 100, 10)])).toMatchObject({limited:false,dailyRemaining:0});
  expect(await f.take([f.quota("fast", 1, 100, 10)])).toMatchObject({limited:true,scope:"day",resetIn:30});
  clock.mockReturnValue(Date.UTC(2026,8,21));
  expect(await f.take([f.quota("fast", 1, 100, 10)])).toMatchObject({limited:false,dailyRemaining:9});
});

test("invalid or reordered admission input is rejected without transferring counters", async () => {
  const f = fixture();
  const obj = f.env.QUOTAS.get(f.env.QUOTAS.idFromName("caller"));
  for (const quotas of [[],[null],[{...f.quota("unknown"),id:hash("x")}],[{...f.quota("fast", -1),id:hash("x")}],
    ["laya:fast","fast"].map(scope => ({...f.quota(scope),id:hash(scope)}))]) {
    expect((await obj.fetch("https://quota/admit", {method:"POST",body:JSON.stringify({quotas})})).status).toBe(400);
  }
  expect(f.writes.size).toBe(0);
});
