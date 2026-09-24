'use strict';
/** API Gateway / Edge Router (:3000). Routes to nearest simulated edge. */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { requestIdMiddleware, nowIso, pickEdge } = require('../../packages/common/index.js');

const PORT = process.env.PORT || 3000;
const EDGE_US = (process.env.EDGE_US_URL || 'http://localhost:3002').replace(/\/$/, '');
const EDGE_EU = (process.env.EDGE_EU_URL || 'http://localhost:3003').replace(/\/$/, '');
const EDGE_ASIA = (process.env.EDGE_ASIA_URL || 'http://localhost:3004').replace(/\/$/, '');
const ORIGIN_URL = (process.env.ORIGIN_URL || 'http://localhost:3001').replace(/\/$/, '');
const COORDINATOR_URL = (process.env.COORDINATOR_URL || 'http://localhost:3006').replace(/\/$/, '');
const DEFAULT_REGION = (process.env.DEFAULT_REGION || 'us').toLowerCase();

const app = express();
app.use(cors({
  // Dashboard (browser) needs to read these custom headers on GET /c/:key
  exposedHeaders: ['X-Cache', 'X-Edge', 'X-Version', 'X-Edge-Latency-Ms', 'X-Origin-Latency-Ms', 'X-Route-Reason', 'X-Edge-Target', 'X-Request-Id'],
}));
app.use(requestIdMiddleware);
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['text/*', 'application/octet-stream'], limit: '5mb' }));

const edgeMap = () => ({ us: EDGE_US, eu: EDGE_EU, asia: EDGE_ASIA });

function resolveRegion(req) {
  return (req.headers['x-client-region'] || req.query.region || DEFAULT_REGION).toLowerCase();
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'gateway', edges: edgeMap(), time: nowIso() }));
app.get('/edges', (_req, res) => res.json(edgeMap()));
app.get('/route', (req, res) => {
  const pick = pickEdge(resolveRegion(req), edgeMap(), DEFAULT_REGION);
  res.json({ clientRegion: resolveRegion(req), edge: pick.region, url: pick.url, reason: pick.reason });
});

// Client read path → nearest edge
app.get('/c/:key', async (req, res) => {
  const pick = pickEdge(resolveRegion(req), edgeMap(), DEFAULT_REGION);
  try {
    const r = await axios.get(`${pick.url}/cache/${encodeURIComponent(req.params.key)}`, {
      timeout: 8000, headers: { 'X-Request-Id': req.id },
      validateStatus: () => true,
    });
    for (const h of ['x-cache', 'x-edge', 'x-version', 'x-edge-latency-ms', 'x-origin-latency-ms']) {
      if (r.headers[h]) res.setHeader(h.toUpperCase().replace('X-', 'X-'), r.headers[h]);
    }
    res.setHeader('X-Route-Reason', pick.reason);
    res.setHeader('X-Edge-Target', pick.region);
    return res.status(r.status).json(r.data);
  } catch (e) {
    return res.status(502).json({ error: 'edge_unreachable', detail: e.message });
  }
});

// Client write path → origin (which triggers replication)
app.put('/c/:key', async (req, res) => {
  const payload = req.body && typeof req.body === 'object' && 'data' in req.body
    ? req.body
    : { data: typeof req.body === 'string' ? req.body : '', contentType: req.headers['content-type'] };
  try {
    const r = await axios.put(`${ORIGIN_URL}/content/${encodeURIComponent(req.params.key)}`, payload, { timeout: 20000, headers: { 'X-Request-Id': req.id } });
    return res.status(r.status).json(r.data);
  } catch (e) {
    return res.status(e.response?.status || 502).json({ error: 'origin_write_failed', detail: e.message });
  }
});

app.delete('/c/:key', async (req, res) => {
  try {
    await axios.delete(`${ORIGIN_URL}/content/${encodeURIComponent(req.params.key)}`, { timeout: 5000 }).catch(() => null);
    const r = await axios.post(`${COORDINATOR_URL}/invalidate`, { key: req.params.key }, { timeout: 8000 });
    return res.json({ key: req.params.key, invalidated: r.data });
  } catch (e) {
    return res.status(502).json({ error: 'invalidate_failed', detail: e.message });
  }
});

app.listen(PORT, () => console.log(`[gateway] listening on :${PORT} edges=${JSON.stringify(edgeMap())}`));
