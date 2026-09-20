// Synthetic end-to-end measurement; keep cold/first-call and warm samples separate.
import {writeFileSync} from 'node:fs';
const output = process.argv[2];
const model = process.argv[3] ?? 'laya';
if (!output || !['laya','jev'].includes(model)) throw new Error('Usage: node inference/laya/latency.mjs <output.json> [laya|jev]');
const rows = [];
for (let i = 0; i < 20; i++) {
  const started = performance.now();
  const response = await fetch('https://classifier.dev/v1/classify', {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({model,processing:'fast',input:'Please refund this charge',labels:['billing','technical']}),
  });
  const body = await response.json();
  const timing = Object.fromEntries((response.headers.get('server-timing') ?? '').split(',').flatMap(part => {
    const match = /\s*([\w_]+);dur=([\d.]+)/.exec(part);
    return match ? [[match[1],Number(match[2])]] : [];
  }));
  const row = {status:response.status,ms:performance.now()-started,label:body.results?.[0]?.label,timing};
  rows.push(row);
  if (response.status !== 200 || row.label !== 'billing') throw new Error(`Unexpected response: ${JSON.stringify(body)}`);
  await new Promise(resolve => setTimeout(resolve, 300));
}
const percentile = (key,p) => {
  const values=rows.slice(1).map(r => key==='ms' ? r.ms : r.timing[key]).filter(Number.isFinite).sort((a,b)=>a-b);
  return values[Math.ceil(values.length*p)-1];
};
const summary = Object.fromEntries(['ms','worker_total','quota_regular','quota_laya','quota_combined','modal_fetch','backend'].map(key=>[key,{p50:percentile(key,.5),p95:percentile(key,.95)}]));
writeFileSync(output,JSON.stringify({at:new Date().toISOString(),model,conditions:'20 sequential public anonymous fast-lane calls from the same local client; first call reported separately; 300ms between requests',first:rows[0],summary,rows},null,2));
console.log(JSON.stringify({first:rows[0],summary}));
