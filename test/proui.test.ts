import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { proHtml } from "../src/proui";

// Execute the shipped browser script with isolated DOM and billing boundaries.
// Timers advance explicitly so delayed activation and cancellation are deterministic.
async function browser(search = "", initial: Record<string, unknown> = {email: "person@example.com", active: false, hasKey: false}) {
  const nodes = new Map<string, any>();
  const timers = new Map<number, () => Promise<void>>();
  const calls: string[] = [];
  let nextTimer = 0, account = initial, status = 200, copied = "", replacedUrl = "";
  const element = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, {hidden: true, value: "", textContent: "", disabled: false, classList: {toggle() {}}, addEventListener(name: string, fn: unknown) {this[name] = fn;}});
    return nodes.get(id);
  };
  const html = proHtml();
  const script = html.match(/<script>\s*\(\(\) => \{[\s\S]*?<\/script>/)![0].replace(/^<script>|<\/script>$/g, "");
  runInNewContext(script, {
    document: {getElementById: element}, location: {search, hash: "", pathname: "/pro"}, URLSearchParams,
    history: {replaceState(_state: unknown, _title: string, url: string) {replacedUrl = url;}}, addEventListener() {}, confirm: () => true,
    navigator: {clipboard: {writeText: async (value: string) => {copied = value;}}},
    setTimeout: (fn: () => Promise<void>) => {timers.set(++nextTimer, fn); return nextTimer;},
    clearTimeout: (id: number) => timers.delete(id),
    fetch: async (path: string) => {
      calls.push(path);
      if (path.endsWith("/account")) return Response.json(account, {status});
      if (path.endsWith("/key")) return Response.json({key: "fixture-key"});
      return Response.json({});
    },
  });
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  await flush();
  return {element, timers, calls, flush, get copied() {return copied;}, get replacedUrl() {return replacedUrl;},
    setAccount(value: Record<string, unknown>, code = 200) {account = value; status = code;},
    async tick() {const [id, fn] = timers.entries().next().value!; timers.delete(id); await fn(); await flush();},
  };
}

test("checkout return automatically reveals key setup when the subscription activates", async () => {
  const b = await browser("?checkout=complete");
  expect(b.element("checkout").hidden).toBe(true);
  expect(b.element("keys").hidden).toBe(true);
  expect(b.timers.size).toBe(1);
  b.setAccount({email: "person@example.com", active: true, hasKey: false});
  await b.tick();
  expect(b.element("keys").hidden).toBe(false);
  expect(b.element("pending").hidden).toBe(true);
  expect(b.element("plan-status").textContent).toContain("10× usage");
  expect(b.timers.size).toBe(0);
  b.element("create-key").onclick(); await b.flush();
  expect(b.element("api-key").value).toBe("fixture-key");
  expect(b.element("create-key").textContent).toBe("Replace API key");
  expect(b.element("create-key").disabled).toBe(false);
  await b.element("copy-key").onclick();
  expect(b.copied).toBe("fixture-key");
  b.element("hide-key").onclick();
  expect(b.element("api-key").value).toBe("");
});

test("activation polling is bounded and manual refresh can recover afterwards", async () => {
  const b = await browser("?checkout=complete");
  for (let i = 0; i < 6; i++) await b.tick();
  expect(b.timers.size).toBe(0);
  expect(b.calls.filter(path => path.endsWith("/account"))).toHaveLength(7);
  expect(b.element("checkout").hidden).toBe(false);
  expect(b.element("plan-status").textContent).toBe("Subscribe to unlock 10× usage");
  expect(b.element("pending").textContent).toContain("already paid");
  await b.element("refresh").onclick();
  expect(b.element("checkout").hidden).toBe(false);
  b.setAccount({active: true, hasKey: true});
  await b.element("refresh").onclick();
  expect(b.element("keys").hidden).toBe(false);
  expect(b.element("create-key").textContent).toBe("Replace API key");
});

test("signing out stops pending activation checks and clears credentials", async () => {
  const b = await browser("?checkout=complete");
  await b.element("logout").onclick();
  expect(b.timers.size).toBe(0);
  expect(b.element("signin").hidden).toBe(false);
  expect(b.element("account").hidden).toBe(true);
  expect(b.element("api-key").value).toBe("");
});

test("activation errors stop polling and leave a recoverable message", async () => {
  const b = await browser("?checkout=complete");
  b.setAccount({error: "Billing is temporarily unavailable. Please try again."}, 503);
  await b.tick();
  expect(b.timers.size).toBe(0);
  expect(b.element("message").textContent).toContain("Please try again");
  expect(b.element("account").hidden).toBe(false);
  expect(b.element("checkout").hidden).toBe(false);
});

test("ordinary account visits do not poll or hide checkout", async () => {
  const b = await browser();
  expect(b.timers.size).toBe(0);
  expect(b.element("checkout").hidden).toBe(false);
});

test("checkout marker is consumed without removing other query parameters", async () => {
  const b = await browser("?checkout=complete&source=receipt");
  expect(b.replacedUrl).toBe("/pro?source=receipt");
});

test("a confirmed checkout does not hide checkout if the account later becomes inactive", async () => {
  const b = await browser("?checkout=complete", {active: true, hasKey: true});
  expect(b.replacedUrl).toBe("/pro");
  expect(b.element("message").textContent).toContain("Pro is active");
  b.setAccount({active: false, hasKey: true});
  await b.element("refresh").onclick();
  expect(b.element("checkout").hidden).toBe(false);
  expect(b.timers.size).toBe(0);
});

test("an expired session ends checkout confirmation before sign-in recovery", async () => {
  const b = await browser("?checkout=complete");
  b.setAccount({error: "Sign in again to continue."}, 401);
  await b.tick();
  expect(b.timers.size).toBe(0);
  expect(b.element("signin").hidden).toBe(false);
  b.setAccount({active: false, hasKey: false});
  await b.element("refresh").onclick();
  expect(b.element("checkout").hidden).toBe(false);
});
