'use strict';
/**
 * Edge Cache Service — one image, deployed 3x (REGION=us|eu|asia).
 * In-memory LRU + per-entry TTL, origin-pull on miss.
 * Push replication via POST /internal/replicate; purge via DELETE /cache/:key.
 */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { requestIdMiddleware, nowIso, emitAnalytics } = require('../../packages/common/index.js');

const PORT = process.env.PORT || 3002;
const REGION = (process.env.REGION || 'us').toLowerCase();
const ORIGIN_URL = (process.env.ORIGIN_URL || 'http://localhost:3001').replace(/\/$/, '');
const ANALYTICS_URL = process.env.ANALYTICS_URL || 'http://localhost:3007';
let TTL_MS = Number(process.env.TTL_DEFAULT_MS || 60000);
let LRU_MAX = Number(process.env.LRU_MAX || 500);

// --- Minimal LRU with TTL (Map preserves insertion order) ---
class LruTtl {
  constructor(max) { this.max = max; this.map = new Map(); this.evictions = 0; }
  get(k) {
    const e = this.map.get(k);
    if (!e) return null;
    if (Date.now() > e.expiresAt) { this.map.delete(k); return null; }
    this.map.delete(k); this.map.set(k, e); // mark recent
    return e;
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k);
    else if (this.map.size >= this.max) { const oldest = this.map.keys().next().value; this.map.delete(oldest); this.evictions++; }
    this.map.set(k, v);
  }
  del(k) { return this.map.delete(k); }
  dump() { return [...this.map.entries()].map(([key, e]) => ({ key, version: e.version, expiresInMs: Math.max(0, e.expiresAt - Date.now()) })); }
}
const cache = new LruTtl(LRU_MAX);
let hits = 0, misses = 0;

const app = express();
app.use(cors({
  exposedHeaders: ['X-Cache', 'X-Edge', 'X-Version', 'X-Edge-Latency-Ms', 'X-Origin-Latency-Ms', 'X-Request-Id'],
}));
app.use(requestIdMiddleware);
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: `edge-${REGION}`, ttlMs: TTL_MS, lruMax: cache.max, time: nowIso() }));

app.get('/cache/_stats', (_req, res) => {
  const total = hits + misses;
  res.json({ region: REGION, hits, misses, hitRatio: total ? hits / total : 0, size: cache.map.size, evictions: cache.evictions, ttlMs: TTL_MS, lruMax: cache.max });
});

app.get('/cache/_dump', (_req, res) => res.json({ region: REGION, entries: cache.dump() }));

app.post('/cache/_config', (req, res) => {
  if (req.body.ttlMs != null) TTL_MS = Number(req.body.ttlMs);
  if (req.body.max != null) { cache.max = Number(req.body.max); LRU_MAX = cache.max; }
  res.json({ region: REGION, ttlMs: TTL_MS, lruMax: cache.max });
});

app.delete('/cache', (_req, res) => { cache.map.clear(); res.json({ region: REGION, purged: true }); });

// Push replication from Replication service / Coordinator.
app.post('/internal/replicate', (req, res) => {
  const { key, version, data, contentType, op } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key_required' });
  if (op === 'delete' || op === 'invalidate') {
    cache.del(key);
    return res.json({ region: REGION, key, purged: true });
  }
  cache.set(key, { data: data ?? null, contentType: contentType || 'text/plain', version: version ?? 1, expiresAt: Date.now() + TTL_MS, cachedAt: nowIso() });
  res.json({ region: REGION, key, version, cached: true });
});

app.delete('/cache/:key', (req, res) => {
  cache.del(req.params.key);
  res.json({ region: REGION, key: req.params.key, purged: true });
});

app.get('/cache/:key', async (req, res) => {
  const key = req.params.key;
  const t0 = Date.now();
  const entry = cache.get(key);
  if (entry) {
    hits++;
    const edgeLatencyMs = Date.now() - t0;
    res.set({ 'X-Cache': 'HIT', 'X-Edge': REGION, 'X-Version': String(entry.version), 'X-Edge-Latency-Ms': String(edgeLatencyMs) });
    emitAnalytics(ANALYTICS_URL, { requestId: req.id, key, edge: REGION, hitMiss: 'HIT', edgeLatencyMs, originLatencyMs: 0 });
    return res.json({ key, version: entry.version, data: entry.data, contentType: entry.contentType, cachedAt: entry.cachedAt });
  }
  // MISS → origin-pull
  misses++;
  const tOrigin = Date.now();
  try {
    const r = await axios.get(`${ORIGIN_URL}/content/${encodeURIComponent(key)}`, { timeout: 5000 });
    const originLatencyMs = Date.now() - tOrigin;
    const { version, data, contentType } = r.data;
    cache.set(key, { data, contentType, version, expiresAt: Date.now() + TTL_MS, cachedAt: nowIso() });
    const edgeLatencyMs = Date.now() - t0;
    res.set({ 'X-Cache': 'MISS', 'X-Edge': REGION, 'X-Version': String(version), 'X-Edge-Latency-Ms': String(edgeLatencyMs), 'X-Origin-Latency-Ms': String(originLatencyMs) });
    emitAnalytics(ANALYTICS_URL, { requestId: req.id, key, edge: REGION, hitMiss: 'MISS', edgeLatencyMs, originLatencyMs });
    return res.json({ key, version, data, contentType });
  } catch (e) {
    const status = e.response?.status || 502;
    if (status === 404) {
      return res.status(404).json({ error: 'not_found', key, hint: 'Key does not exist at origin. Create it first with PUT /c/:key (gateway) or PUT /content/:key (origin).' });
    }
    return res.status(status).json({ error: 'origin_fetch_failed', key, detail: e.message });
  }
});

app.listen(PORT, () => console.log(`[edge-${REGION}] listening on :${PORT} origin=${ORIGIN_URL} ttl=${TTL_MS}ms max=${cache.max}`));
