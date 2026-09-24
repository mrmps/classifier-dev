import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dashboard } from "../src/admin";
import { adminFixture } from "../test/admin-fixture";

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/admin-assets/"))
      return new Response(Bun.file("public" + url.pathname));
    const data = adminFixture();
    if (url.searchParams.has("empty")) {
      data.chatOutcomes = [];
      data.chatSeries = [];
      data.chatCallers = 0;
    }
    if (url.searchParams.has("unavailable")) {
      data.unavailable = ["chatOutcomes", "chatSeries", "chatCallers"];
      data.errors = ["Synthetic unavailable analytics"];
    }
    if (url.searchParams.has("unknown"))
      data.chatOutcomes = [
        {
          outcome: "stopped",
          turns: 1,
          modelCalls: 1,
          unknownTokenCalls: 1,
          unknownCostCalls: 1,
        },
      ];
    return new Response(dashboard("24h", data, "fixture-nonce"), {
      headers: { "content-type": "text/html" },
    });
  },
});
const run = promisify(execFile);
const browser = async (...args: string[]) =>
  (await run("agent-browser", ["--session", "chat-analytics-e2e", ...args]))
    .stdout;
const check = async (condition: string) =>
  browser(
    "eval",
    `if (!(${condition})) throw new Error(${JSON.stringify(condition)}); true`,
  );
const url = new URL("/admin", server.url).href;
const results: string[] = [];
try {
  await mkdir("captures", { recursive: true });
  await browser("open", url);
  await browser("set", "viewport", "1366", "900");
  await browser("wait", "--text", "Chat model accounting");
  await browser("eval", "document.fonts.ready.then(()=>true)");
  await check('document.querySelectorAll(".analytics-section").length === 6');
  await check('!document.querySelector("[role=tab]")');
  await check(
    'document.querySelector("#Dimensions").getBoundingClientRect().height > 0',
  );
  await check(
    'Array.from(document.querySelectorAll(".section-nav a")).every(a => { const id = decodeURIComponent(a.hash.slice(1)); return !/\\s/.test(id) && document.getElementById(id); })',
  );
  await browser("screenshot", "captures/desktop-after.png");
  await browser("click", 'a[href="#Chat"]');
  await browser("mouse", "move", "0", "0");
  await browser("screenshot", "captures/chat-desktop.png");
  await browser("download", "button.control", "captures/admin-export.json");
  const exported = JSON.parse(await readFile("captures/admin-export.json", "utf8"));
  assert.equal(exported.range, "24h");
  assert.deepEqual(exported.chatOutcomes, adminFixture().chatOutcomes);
  results.push("JSON export downloads the selected range and chat accounting");
  for (const term of [
    "Model economics",
    "Dimension outcomes",
    "ls_9f3c7a8d",
    "Chat model accounting",
  ]) {
    await browser("eval", "getSelection()?.removeAllRanges(); scrollTo(0,0)");
    await check(`window.find(${JSON.stringify(term)})`);
  }
  results.push(
    "all six sections rendered together; browser Find reaches models, dimensions, classifier fingerprints and chat",
  );
  await browser("open", url + "?unknown");
  await browser("wait", "--text", "Chat model accounting");
  await check(
    'document.querySelector("#Chat").innerText.includes("0 / 1 calls returned cost")',
  );
  await check(
    'document.querySelector("#Chat .metrics").innerText.includes("Model spend reported\\n—")',
  );
  results.push(
    "unknown model spend shown as unavailable with explicit coverage, never zero",
  );
  await browser("open", url + "?empty");
  await browser("wait", "--text", "Chat model accounting");
  await check(
    'document.querySelector("#Chat").innerText.includes("No activity recorded")',
  );
  await browser("open", url + "?unavailable");
  await browser("wait", "--text", "Some analytics are unavailable.");
  await check(
    'document.querySelector("#Chat").innerText.includes("Data unavailable")',
  );
  results.push(
    "empty traffic and unavailable analytics remain distinguishable",
  );
  await browser("open", url);
  await browser("set", "viewport", "390", "844");
  await browser("wait", "--text", "Chat model accounting");
  await browser("screenshot", "captures/mobile-after.png");
  await browser("click", 'a[href="#Chat"]');
  await browser("mouse", "move", "0", "0");
  await browser("screenshot", "captures/chat-mobile.png");
  await check("document.documentElement.scrollWidth <= innerWidth");
  results.push(
    "mobile layout has no page overflow; chat and section links remain usable",
  );
  assert.equal(results.length, 5);
} finally {
  await browser("close");
  server.stop(true);
  await writeFile(
    "captures/admin-browser.json",
    JSON.stringify(
      {
        runtime:
          "real browser, Vite-built admin bundle and synthetic analytics snapshot",
        results,
      },
      null,
      2,
    ),
  );
}
console.log(
  `${results.length} dashboard browser scenarios passed; captures/admin-browser.json`,
);
