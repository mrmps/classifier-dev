// Real HTTP + model smoke test. Run against an isolated staging Worker before merge and live after deploy.
// CLASSIFIER_API_KEY is optional; no caller text or credentials are written to analytics.
import assert from 'node:assert/strict';
const base = (process.argv[2] || 'https://classifier.dev').replace(/\/$/, '');
const headers = {'content-type':'application/json', 'user-agent':'classifier-dimensions-e2e/1.0'};
if (process.env.CLASSIFIER_API_KEY) headers.authorization = `Bearer ${process.env.CLASSIFIER_API_KEY}`;
const dimensions = {
  team: { labels:['billing','identity','platform'], instructions:'billing handles payments and invoices. identity handles all authentication, including passwords, sign-in, and passkey login features. platform handles uptime and availability.' },
  urgency: { labels:['immediate','normal','low'], instructions:'immediate means an active outage or repeated financial harm. normal means a single user cannot complete a task. low means a cosmetic issue or future feature request.' },
  kind: { labels:['bug','request','question'], instructions:'bug is broken existing behavior. request asks for a new capability. question asks for information.' },
};
const fixtures = [
  ['Checkout is broken and repeatedly charges my card twice for every purchase.', ['billing','immediate','bug']],
  ['Please add passkey login next year. My current login works fine.', ['identity','low','request']],
  ['The service is completely down for every customer right now.', ['platform','immediate','bug']],
  ['My password reset link is broken and I cannot sign in.', ['identity','normal','bug']],
];
async function post(body,path='/v1/classify',status=200){
  const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  const data=await r.json(); assert.equal(r.status,status,JSON.stringify(data)); return data;
}
function validateMatrix(data, items, dims){
  assert.equal(data.results.length,items.length);
  assert.equal(data.usage.classifications,items.length*Object.keys(dims).length);
  assert.equal(data.usage.items,items.length);assert.equal(data.usage.dimensions,Object.keys(dims).length);
  for(const row of data.results){
    assert.deepEqual(Object.keys(row.dimensions),Object.keys(dims));
    for(const [name,field] of Object.entries(row.dimensions)){
      const labels=Array.isArray(dims[name])?dims[name]:dims[name].labels;
      assert.ok(labels.includes(field.label));assert.ok(field.model);
      assert.ok(field.confidence===null||(field.confidence>=0&&field.confidence<=1));
      if(field.scores!==null){
        assert.deepEqual(Object.keys(field.scores).sort(),[...labels].sort());
        assert.ok(Math.abs(Object.values(field.scores).reduce((n,v)=>n+v,0)-1)<0.01);
      }
    }
  }
}
const items=fixtures.map(f=>f[0]);
const fast=await post({items,dimensions});validateMatrix(fast,items,dimensions);
assert.equal(fast.usage.fallback,0);assert.ok(fast.modelsUsed.every(m=>m.includes('jev')));
for(let i=0;i<fixtures.length;i++)assert.deepEqual(Object.values(fast.results[i].dimensions).map(v=>v.label),fixtures[i][1]);
console.log(JSON.stringify({check:'semantic examples',items:items.length,decisions:fast.usage.classifications,ms:fast.usage.ms,model:fast.model}));
const smart=await post({items,dimensions,tier:'smart'});validateMatrix(smart,items,dimensions);assert.equal(smart.usage.escalation_failed,undefined);
console.log(JSON.stringify({check:'smart matrix',usage:smart.usage,model:smart.model}));
const large=Array.from({length:100},(_,i)=>items[i%items.length]);
const batch=await post({items:large,dimensions});validateMatrix(batch,large,dimensions);assert.equal(batch.usage.fallback,0);
for(let i=0;i<large.length;i++)assert.deepEqual(Object.values(batch.results[i].dimensions).map(v=>v.label),fixtures[i%items.length][1]);
console.log(JSON.stringify({check:'100-item batch ordering',usage:batch.usage,model:batch.model}));
const bad=await post({items,dimensions:{team:['only']}},'/v1/classify',400);assert.equal(bad.code,'bad_dimensions');
const tooMany=await post({items:Array(501).fill(items[0]),dimensions:{team:['billing','platform'],kind:['bug','request']}},'/v1/classify',400);assert.equal(tooMany.code,'too_many_decisions');
const legacy=await post({input:'Win a free iPhone now',labels:['spam','not spam']});assert.equal(legacy.results[0].label,'spam');assert.equal(legacy.results[0].dimensions,undefined);
const multi=await post({input:'The billing page is broken.',labels:['billing','bug','praise'],multi:true});assert.ok(multi.results[0].labels.includes('billing'));assert.ok(multi.results[0].labels.includes('bug'));
const rpc=await post({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'classify_dimensions',arguments:{items:[items[0]],dimensions}}},'/mcp');
assert.equal(rpc.result.isError,undefined);validateMatrix(rpc.result.structuredContent,[items[0]],dimensions);
const api=await(await fetch(base+'/openapi.json')).json();assert.ok(api.components.schemas.ClassifyRequest.properties.dimensions);
console.log('PASS: real HTTP/model matrix, smart, 300-decision batch, validation, old API, multi-label, MCP, and discovery');
