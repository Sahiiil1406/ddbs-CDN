'use strict';
/** Analytics Service (:3007) — hit/miss + latency collector (node:sqlite). */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { requestIdMiddleware, nowIso } = require('../../packages/common/index.js');

const PORT = process.env.PORT || 3007;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'analytics.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT, key TEXT, edge TEXT, hit_miss TEXT,
    edge_latency_ms REAL, origin_latency_ms REAL, ts TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_events_edge ON events(edge);
`);

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

const app = express();
app.use(cors());
app.use(requestIdMiddleware);
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'analytics', time: nowIso() }));

app.post('/events', (req, res) => {
  const { requestId, key, edge, hitMiss, edgeLatencyMs, originLatencyMs, ts } = req.body || {};
  db.prepare('INSERT INTO events(request_id,key,edge,hit_miss,edge_latency_ms,origin_latency_ms,ts) VALUES(?,?,?,?,?,?,?)')
    .run(requestId || null, key || null, edge || null, hitMiss || null, Number(edgeLatencyMs || 0), Number(originLatencyMs || 0), ts || nowIso());
  res.json({ ok: true });
});

app.delete('/metrics/reset', (_req, res) => { db.exec('DELETE FROM events'); res.json({ ok: true, reset: true }); });

app.get('/metrics/summary', (_req, res) => {
  const rows = db.prepare('SELECT hit_miss, edge_latency_ms, origin_latency_ms FROM events').all();
  const hits = rows.filter((r) => r.hit_miss === 'HIT').map((r) => r.edge_latency_ms).sort((a, b) => a - b);
  const misses = rows.filter((r) => r.hit_miss === 'MISS').map((r) => r.edge_latency_ms).sort((a, b) => a - b);
  const total = rows.length;
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  res.json({
    total, hits: hits.length, misses: misses.length,
    hitRatio: total ? hits.length / total : 0,
    hit: { avgMs: avg(hits), p50Ms: percentile(hits, 50), p95Ms: percentile(hits, 95) },
    miss: { avgMs: avg(misses), p50Ms: percentile(misses, 50), p95Ms: percentile(misses, 95) },
  });
});

app.get('/metrics/by-edge', (_req, res) => {
  const rows = db.prepare('SELECT edge, COUNT(*) c, SUM(CASE WHEN hit_miss=? THEN 1 ELSE 0 END) h, AVG(edge_latency_ms) avgMs FROM events GROUP BY edge',).all('HIT');
  res.json({ byEdge: rows });
});

app.get('/metrics/timeseries', (req, res) => {
  const windowSec = Number(req.query.windowSec || 120);
  const bucketSec = Number(req.query.bucketSec || 5);
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  const rows = db.prepare('SELECT hit_miss, edge_latency_ms, ts FROM events WHERE ts >= ? ORDER BY ts').all(since);
  const buckets = {};
  for (const r of rows) {
    const t = Math.floor(new Date(r.ts).getTime() / 1000 / bucketSec) * bucketSec;
    buckets[t] = buckets[t] || { t: new Date(t * 1000).toISOString(), hits: 0, misses: 0, lat: [] };
    if (r.hit_miss === 'HIT') buckets[t].hits++; else buckets[t].misses++;
    buckets[t].lat.push(r.edge_latency_ms);
  }
  const series = Object.values(buckets).map((b) => ({ ...b, avgMs: b.lat.length ? b.lat.reduce((s, v) => s + v, 0) / b.lat.length : 0 }));
  delete series.lat;
  res.json({ windowSec, bucketSec, series });
});

app.listen(PORT, () => console.log(`[analytics] listening on :${PORT}`));
