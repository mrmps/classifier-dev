import { afterEach, expect, test } from "bun:test";
import { evaluate } from "../src/alerts";
import { adminResponse } from "../src/admin";
import type { Env } from "../src/index";
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const env = { ADMIN_PASSWORD: "test", ADMIN_SIGNING_KEY: "test-signing" } as Env;
const rows = [
  {mode:"single",status:"200",model:"jev-test",requests:10000,ms_sum:100000,usd:0,escfail:0,fallback:0},
  {mode:"dimensions",status:"200",reason:"",model:"jev-test",requests:10,classifications:60,items:20,dimensions:30,uncertain:3,fallback:2,ms_sum:4000,usd:0.001,escfail:0},
  {mode:"dimensions",status:"502",reason:"batch_unavailable",model:"",requests:3,classifications:0,items:0,dimensions:9,uncertain:0,fallback:0,ms_sum:9000,usd:0,escfail:0},
];
test("dimension failures and fallback alert despite healthy aggregate traffic",async()=>{
  globalThis.fetch=(async(_u,i)=>Response.json({data:String(i?.body).includes('GROUP BY')?rows:[{requests:10000,usd:0}]})) as typeof fetch;
  const result=await evaluate(env);
  expect(result.checked).toBe(true);
  expect(result.alerts.map(a=>a.id)).toContain("dimensions_5xx");
  expect(result.alerts.map(a=>a.id)).toContain("dimensions_fallback");
  expect(result.alerts.map(a=>a.id)).not.toContain("5xx");
});
test("validation errors and low volume do not raise a dimension server failure alert",async()=>{
  globalThis.fetch=(async(_u,i)=>Response.json({data:String(i?.body).includes('GROUP BY')?[
    {...rows[1],fallback:0},{...rows[2],requests:2},{...rows[2],status:'400',requests:100}
  ]:[{requests:200,usd:0}]})) as typeof fetch;
  const result=await evaluate(env);
  expect(result.alerts.map(a=>a.id)).not.toContain("dimensions_5xx");
  expect(result.alerts.map(a=>a.id)).not.toContain("dimensions_fallback");
});
async function dashboard(){
  const body=new FormData();body.set('password','test');
  const login=(await adminResponse(new Request('https://classifier.dev/admin',{method:'POST',body,headers:{origin:'https://classifier.dev'}}),env,'admin','127.0.0.1'))!;
  const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const page=(await adminResponse(new Request('https://classifier.dev/admin',{headers:{cookie}}),env,'admin','127.0.0.1'))!;
  return await page.text();
}
test("dashboard queries the feature separately and shows failures and adoption",async()=>{
  const queries:string[]=[];
  globalThis.fetch=(async(_u,i)=>{
    const q=String(i?.body);queries.push(q);
    return Response.json({data:q.includes("blob9 = 'dimensions'") ? q.includes('index1')?[{index1:'c_one',n:10},{index1:'c_two',n:3}]:rows.slice(1):[{requests:10013,classifications:600,usd:0.01,avg_ms:10}]});
  }) as typeof fetch;
  const html=await dashboard();
  expect(queries.filter(q=>q.includes("blob9 = 'dimensions'"))).toHaveLength(3);
  expect(html).toContain("Multidimensional classification");
  expect(html).toContain("successful items");expect(html).toContain("fallback fields");expect(html).toContain("uncertain fields");
  expect(html).toContain("batch too large for the LLM fallback");expect(html).toContain("23.1%");
  expect(html).not.toContain("some panels are empty");
});
test("a broken feature query is shown as unavailable rather than silent success",async()=>{
  globalThis.fetch=(async(_u,i)=>String(i?.body).includes("blob9 = 'dimensions'")?new Response('query unavailable',{status:503}):Response.json({data:[]})) as typeof fetch;
  const html=await dashboard();
  expect(html).toContain("some panels are empty");expect(html).toContain("AE 503");
});
