import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { docsServer, handleMcp } from "../src/mcp";
import worker, { type Env } from "../src/index";

const server = docsServer([]);
const request = (args: unknown) => handleMcp(new Request("https://classifier.dev/mcp/docs", {
  method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_examples", arguments: args } }),
}), server);

test("both Python examples execute with a requests stand-in", async () => {
  for (const multi_label of [false, true]) {
    const response = await request({ client: "python", multi_label });
    const body = await response.json() as { result: { structuredContent: { code: string } } };
    const harness = `import sys, types\nclass Response:\n def raise_for_status(self): pass\n def json(self): return {"results": [{"label": "bug", "confidence": 0.9, "labels": ["bug"]}]}\ndef post(url, json):\n assert json.get("multi", False) is ${multi_label ? "True" : "False"}\n return Response()\nsys.modules["requests"] = types.SimpleNamespace(post=post)\n`;
    const run = spawnSync("python3", ["-c", harness + body.result.structuredContent.code], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  }
});

test("prototype names are not example clients", async () => {
  for (const client of ["constructor", "__proto__", "toString"]) {
    const body = await (await request({ client })).json() as { error?: { code: number } };
    expect(body.error?.code).toBe(-32602);
  }
});

test("fractional page sizes do not silently end documentation pagination", async () => {
  const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
  const response = await worker.fetch(new Request("https://classifier.dev/v1/docs?limit=1.5"), {} as Env, ctx);
  const body = await response.json() as { items: unknown[]; page_info: { limit: number; has_more: boolean }; next: string };
  expect(body.items).toHaveLength(1);
  expect(body.page_info.limit).toBe(1);
  expect(body.page_info.has_more).toBe(true);
  expect(body.next).toContain("cursor=");
});

test("a cursor outside the filtered documents is rejected instead of restarting", async () => {
  const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
  const first = await worker.fetch(new Request("https://classifier.dev/v1/docs?limit=1"), {} as Env, ctx);
  const body = await first.json() as { items: { id: string }[] };
  const response = await worker.fetch(new Request(`https://classifier.dev/v1/docs?q=nonexistent-filter&cursor=${encodeURIComponent(body.items[0].id)}`), {} as Env, ctx);
  expect(response.status).toBe(400);
  expect((await response.json() as { code: string }).code).toBe("bad_cursor");
});

test("filtered documentation cursors advance without repeating sections", async () => {
  const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
  const read = async (url: string) => (await worker.fetch(new Request(url), {} as Env, ctx)).json() as Promise<{
    items: { id: string }[]; next: string | null;
  }>;
  const first = await read("https://classifier.dev/v1/docs?q=classify&limit=1");
  expect(first.next).toContain("q=classify");
  const second = await read(first.next!);
  expect(second.items).toHaveLength(1);
  expect(second.items[0].id).not.toBe(first.items[0].id);
});
