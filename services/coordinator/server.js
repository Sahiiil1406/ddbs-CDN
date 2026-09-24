'use strict';
/** Cache Invalidation / Consistency Coordinator (:3006). */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { requestIdMiddleware, nowIso } = require('../../packages/common/index.js');

const PORT = process.env.PORT || 3006;
const ORIGIN_URL = (process.env.ORIGIN_URL || 'http://localhost:3001').replace(/\/$/, '');
const EDGES = (process.env.EDGES || 'http://localhost:3002,http://localhost:3003,http://localhost:3004')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const EDGE_NAMES = ['us', 'eu', 'asia'];
const RABBITMQ_URL = process.env.RABBITMQ_URL || '';

const app = express();
app.use(cors());
app.use(requestIdMiddleware);
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'coordinator', time: nowIso() }));

app.post('/invalidate', async (req, res) => {
  const { key, regions } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key_required' });
  // Optional broadcast on RabbitMQ (best-effort; direct HTTP is authoritative).
  if (RABBITMQ_URL) {
    try {
      const amqp = require('amqplib');
      const conn = await amqp.connect(RABBITMQ_URL);
      const ch = await conn.createChannel();
      await ch.assertExchange('cdn.invalidate', 'fanout', { durable: false });
      ch.publish('cdn.invalidate', '', Buffer.from(JSON.stringify({ key, regions })));
      setTimeout(() => conn.close().catch(() => {}), 500);
    } catch (e) { console.error('[coordinator] mq publish failed:', e.message); }
  }
  const targets = EDGES.filter((_, i) => !regions || regions.includes(EDGE_NAMES[i]));
  const results = await Promise.all(targets.map(async (edge, i) => {
    const endpoint = key === '*'
      ? `${edge}/cache`
      : `${edge}/cache/${encodeURIComponent(key)}`;
    try {
      const r = await axios.delete(endpoint, { timeout: 5000 });
      return { edge: EDGE_NAMES[i] || edge, ok: true, status: r.status };
    } catch (e) { return { edge: EDGE_NAMES[i] || edge, ok: false, error: e.message }; }
  }));
  res.json({ key, regions: regions || EDGE_NAMES, results });
});

// Version matrix: origin vs each edge — powers the dashboard propagation view.
app.get('/consistency/state', async (_req, res) => {
  let originKeys = [];
  try {
    const r = await axios.get(`${ORIGIN_URL}/content`, { timeout: 5000 });
    originKeys = r.data.items || [];
  } catch (e) { return res.status(502).json({ error: 'origin_unreachable', detail: e.message }); }
  const dumps = await Promise.all(EDGES.map(async (edge) => {
    try { const r = await axios.get(`${edge}/cache/_dump`, { timeout: 5000 }); return r.data; }
    catch { return { region: edge, entries: [] }; }
  }));
  const byEdge = {};
  for (const d of dumps) {
    const m = {};
    for (const e of (d.entries || [])) m[e.key] = e.version;
    byEdge[d.region] = m;
  }
  const matrix = originKeys.map((o) => ({ key: o.key, origin: o.version, us: byEdge.us?.[o.key] ?? null, eu: byEdge.eu?.[o.key] ?? null, asia: byEdge.asia?.[o.key] ?? null }));
  res.json({ time: nowIso(), matrix });
});

app.listen(PORT, () => console.log(`[coordinator] listening on :${PORT}`));
