'use strict';
/**
 * Replication Service (:3005) — origin → edges fanout.
 * Modes: strong (sync, quorum write) vs eventual (async via RabbitMQ or delayed HTTP).
 * Works WITHOUT RabbitMQ (falls back to setTimeout push) so local dev needs no broker.
 */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { requestIdMiddleware, nowIso, sleep } = require('../../packages/common/index.js');

const PORT = process.env.PORT || 3005;
const ORIGIN_URL = (process.env.ORIGIN_URL || 'http://localhost:3001').replace(/\/$/, '');
const EDGES = (process.env.EDGES || 'http://localhost:3002,http://localhost:3003,http://localhost:3004')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const RABBITMQ_URL = process.env.RABBITMQ_URL || '';

let mode = process.env.REPLICATION_MODE || 'eventual'; // strong | eventual
let lagMs = Number(process.env.REPLICATION_LAG_MS || 2000);
let pending = 0;
const history = [];

let mqChannel = null;
async function initMq() {
  if (!RABBITMQ_URL) return;
  try {
    const amqp = require('amqplib');
    const conn = await amqp.connect(RABBITMQ_URL);
    mqChannel = await conn.createChannel();
    await mqChannel.assertExchange('cdn.replication', 'fanout', { durable: false });
    await mqChannel.assertExchange('cdn.invalidate', 'fanout', { durable: false });
    const q = await mqChannel.assertQueue('cdn.replication.q', { durable: true });
    await mqChannel.bindQueue(q.queue, 'cdn.replication', '');
    mqChannel.consume(q.queue, async (msg) => {
      if (!msg) return;
      try {
        const evt = JSON.parse(msg.content.toString());
        await sleep(lagMs); // simulate propagation delay
        await pushToEdges(evt);
      } catch (e) { console.error('[replication] consume error', e.message); }
      finally { pending = Math.max(0, pending - 1); mqChannel.ack(msg); }
    });
    console.log('[replication] RabbitMQ consumer ready');
  } catch (e) {
    console.error('[replication] RabbitMQ unavailable, using HTTP fallback:', e.message);
    mqChannel = null;
  }
}

async function pushToEdges({ key, version, op }) {
  let content = { data: null, contentType: 'text/plain', version };
  if (op !== 'delete') {
    const r = await axios.get(`${ORIGIN_URL}/content/${encodeURIComponent(key)}`, { timeout: 5000 });
    content = { data: r.data.data, contentType: r.data.contentType, version: r.data.version };
  }
  const results = await Promise.all(EDGES.map(async (edge) => {
    try {
      const r = await axios.post(`${edge}/internal/replicate`, { key, version: content.version, data: content.data, contentType: content.contentType, op: op || 'upsert' }, { timeout: 5000 });
      return { edge, ok: true, status: r.status };
    } catch (e) { return { edge, ok: false, error: e.message }; }
  }));
  history.unshift({ time: nowIso(), key, version, op, results });
  if (history.length > 50) history.pop();
  return results;
}

const app = express();
app.use(cors());
app.use(requestIdMiddleware);
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'replication', mode, lagMs, pending, mq: !!mqChannel, time: nowIso() }));
app.get('/replication/status', (_req, res) => res.json({ mode, lagMs, pending, mq: !!mqChannel, recent: history.slice(0, 10) }));
app.post('/replication/mode', (req, res) => {
  if (req.body.mode) mode = req.body.mode === 'strong' ? 'strong' : 'eventual';
  if (req.body.lagMs != null) lagMs = Number(req.body.lagMs);
  res.json({ mode, lagMs });
});

// Called by Origin after each write.
app.post('/internal/notify', async (req, res) => {
  const { key, version, op } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key_required' });
  if (mode === 'strong') {
    const t0 = Date.now();
    try {
      const results = await pushToEdges({ key, version, op });
      const failed = results.filter((r) => !r.ok);
      return res.json({ mode, key, version, writeLatencyMs: Date.now() - t0, results, quorum: failed.length === 0 ? 'ok' : 'degraded' });
    } catch (e) {
      return res.status(502).json({ mode, error: 'strong_replication_failed', detail: e.message });
    }
  }
  // eventual: ack fast, propagate after lag
  pending++;
  if (mqChannel) {
    mqChannel.publish('cdn.replication', '', Buffer.from(JSON.stringify({ key, version, op })));
    return res.json({ mode, key, version, queued: true, lagMs });
  }
  // fallback: delayed direct push
  setTimeout(async () => {
    try { await pushToEdges({ key, version, op }); }
    catch (e) { console.error('[replication] delayed push failed', e.message); }
    finally { pending = Math.max(0, pending - 1); }
  }, lagMs);
  return res.json({ mode, key, version, queued: true, lagMs, transport: 'delayed-http' });
});

app.listen(PORT, async () => { console.log(`[replication] listening on :${PORT} mode=${mode} lag=${lagMs}ms`); await initMq(); });
