import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { adminResponse } from "../src/admin";
import { dailyReport } from "../src/report";
import { evaluate } from "../src/alerts";
import type { Env } from "../src/index";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const env = { ADMIN_PASSWORD: "test", ADMIN_SIGNING_KEY: "sampling-test" } as Env;

// Execute the aggregate SQL against sampled rows. Only ClickHouse's time syntax
// is replaced; the actual sums, averages, filters and grouping run unchanged.
function sampledAnalytics(rows: Record<string, string | number>[]) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE classifier_events (timestamp INTEGER DEFAULT 1, _sample_interval REAL DEFAULT 1,
    index1 TEXT DEFAULT 'caller', ${Array.from({length:20}, (_,i)=>`blob${i+1} TEXT DEFAULT ''`).join(",")},
    ${Array.from({length:20}, (_,i)=>`double${i+1} REAL DEFAULT 0`).join(",")})`);
  db.exec("CREATE TABLE classifier_chat_events AS SELECT * FROM classifier_events WHERE 0");
  for (const row of rows) db.query(`INSERT INTO classifier_events (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(()=>"?").join(",")})`).run(...Object.values(row));
  const emails: {subject: string; text: string}[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("api.resend.com")) {
      emails.push(JSON.parse(String(init?.body)));
      return Response.json({id: "test-email"});
    }
    const sqlite = String(init?.body)
      .replace(/toStartOfInterval\(timestamp, INTERVAL '\d+' (?:HOUR|DAY)\)/g, "timestamp")
      .replace(/toDateTime\(now\(\)\) - INTERVAL '\d+' (?:HOUR|MINUTE)/g, "0");
    return Response.json({data: db.query(sqlite).all()});
  }) as typeof fetch;
  return { db, emails };
}
async function dashboard() {
  const body = new FormData(); body.set("password", "test");
  const login = (await adminResponse(new Request("https://classifier.dev/admin", {method:"POST", body, headers:{origin:"https://classifier.dev"}}), env, "admin", "test"))!;
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  return (await adminResponse(new Request("https://classifier.dev/admin", {headers:{cookie}}),env,"admin","test"))!.text();
}
const success = {blob1:"fast",blob2:"ls_test",blob4:"200",blob5:"public",blob6:"jev-test",blob8:"python",blob9:"dimensions",double1:6,double2:100,double3:0.01,double6:2,double7:3,double8:1};

test("dashboard and digest weight sampled requests, decisions, spend and latency", async () => {
  const {db} = sampledAnalytics([
    {...success,_sample_interval:10},
    {...success,_sample_interval:1,double2:1000},
  ]);
  try {
    const html = await dashboard();
    expect(html).not.toContain("some panels are empty");
    expect(html).toContain('requests</dt><dd>11');
    expect(html).toContain('classifications</dt><dd>66');
    expect(html).toContain('upstream spend</dt><dd>$0.110');
    expect(html).toContain('avg latency</dt><dd>182ms');
    expect(html).toContain('successful items</dt><dd>22');
    expect(html).toContain('uncertain fields</dt><dd>11');
    const report = await dailyReport(env,{send:false});
    expect(report).toContain('requests         11');
    expect(report).toContain('classifications  66');
    expect(report).toContain('avg latency      182ms');
    expect(report).toContain('sampling-adjusted');
  } finally { db.close(); }
});

test("digest notifications distinguish server failures from quota rejections", async () => {
  const {db, emails} = sampledAnalytics([
    {...success, _sample_interval:9},
    {blob4:"502", blob5:"public", _sample_interval:3},
    {blob4:"429", blob5:"public", _sample_interval:100000},
  ]);
  try {
    await dailyReport(env, {send:true});
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("⚠3 server failures");
    expect(emails[0].subject).toContain("100000 rejected");
    expect(emails[0].subject).not.toContain("100003 err");
    expect(emails[0].text).toContain("3 server failures  100000 rejected");
  } finally { db.close(); }
});

test("quota traffic cannot hide server failures or slow inference in dashboard and alerts", async () => {
  const {db} = sampledAnalytics([
    {...success,_sample_interval:9,double2:4000},
    {blob4:"502",blob7:"batch_unavailable",blob9:"dimensions",_sample_interval:3,double2:8000},
    {blob4:"429",blob7:"rate_limit_day",blob9:"dimensions",_sample_interval:100000,double2:1},
  ]);
  try {
    const {alerts,checked}=await evaluate(env);
    expect(checked).toBe(true);
    expect(alerts.find(a=>a.id==="5xx")?.title).toContain("25.0%");
    expect(alerts.find(a=>a.id==="latency")?.title).toContain("5000ms");
    expect(alerts.some(a=>a.id==="dimensions_5xx")).toBe(true);
    const html=await dashboard();
    expect(html).toContain('server error rate</dt><dd>25.0%');
    expect(html).toContain('25.0% of accepted');
    expect(html).toContain('rejected requests</dt><dd>100,000');
    expect(html).not.toContain('error rate</dt><dd>100.0%');
  } finally { db.close(); }
});
