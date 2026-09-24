'use strict';
// Simple load probe: warms one key then measures HIT vs MISS latency + hit ratio.
const GW = process.env.GATEWAY_URL || 'http://localhost:3000';
const KEY = process.env.KEY || 'load-probe';
const N = Number(process.env.N || 50);

async function put() {
  await fetch(`${GW}/c/${KEY}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'payload ' + Date.now() }) });
}
async function get(region) {
  const t0 = Date.now();
  const r = await fetch(`${GW}/c/${KEY}`, { headers: { 'X-Client-Region': region } });
  const ms = Date.now() - t0;
  const cache = r.headers.get('x-cache');
  await r.json().catch(() => null);
  return { ms, cache };
}
(async () => {
  await put();
  await new Promise((r) => setTimeout(r, 3500)); // let eventual replication settle
  const first = await get('us');
  console.log('cold GET:', first);
  const lats = [];
  let hits = 0;
  for (let i = 0; i < N; i++) {
    const r = await get(['us', 'eu', 'asia'][i % 3]);
    lats.push(r.ms);
    if ((r.cache || '').toUpperCase() === 'HIT') hits++;
  }
  lats.sort((a, b) => a - b);
  const avg = lats.reduce((s, v) => s + v, 0) / lats.length;
  console.log(JSON.stringify({ n: N, hits, hitRatio: hits / N, avgMs: avg.toFixed(1), p50: lats[Math.floor(lats.length / 2)], p95: lats[Math.floor(lats.length * 0.95)] }, null, 2));
  const sum = await (await fetch('http://localhost:3007/metrics/summary')).json().catch(() => null);
  console.log('analytics:', JSON.stringify(sum));
})();
