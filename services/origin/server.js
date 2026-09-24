'use strict';
/**
 * Origin Content Service (:3001) — authoritative store.
 * SQLite (node:sqlite, stdlib) for metadata + local filesystem for blobs.
 * After every write it notifies the Replication service (fire-and-wait with timeout).
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { DatabaseSync } = require('node:sqlite');
const { requestIdMiddleware, nowIso } = require('../../packages/common/index.js');

const PORT = process.env.PORT || 3001;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_DIR = process.env.STORE_DIR || path.join(__dirname, 'store');
const REPLICATION_URL = process.env.REPLICATION_URL || 'http://localhost:3005';
const REPLICATION_TIMEOUT_MS = Number(process.env.REPLICATION_TIMEOUT_MS || 15000);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STORE_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'origin.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS contents(
    key TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    content_type TEXT NOT NULL DEFAULT 'text/plain',
    updated_at TEXT NOT NULL
  );
`);

function safeFile(key) {
  return path.join(STORE_DIR, encodeURIComponent(key) + '.blob');
}

function rowToMeta(row, includeData) {
  if (!row) return null;
  const meta = { key: row.key, version: row.version, contentType: row.content_type, updatedAt: row.updated_at };
  if (includeData) {
    try {
      meta.data = fs.readFileSync(safeFile(row.key), 'utf8');
    } catch {
      meta.data = null;
    }
  }
  return meta;
}

const app = express();
app.use(cors());
app.use(requestIdMiddleware);
// Accept JSON {data, contentType} OR raw text/binary-as-text for demo simplicity.
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['text/*', 'application/octet-stream'], limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'origin', time: nowIso() }));

app.get('/content', (_req, res) => {
  const rows = db.prepare('SELECT * FROM contents ORDER BY key').all();
  res.json({ items: rows.map((r) => rowToMeta(r, false)) });
});

app.get('/content/:key', (req, res) => {
  const row = db.prepare('SELECT * FROM contents WHERE key = ?').get(req.params.key);
  if (!row) return res.status(404).json({ error: 'not_found', key: req.params.key });
  res.setHeader('X-Version', String(row.version));
  res.json(rowToMeta(row, true));
});

async function notifyReplication(key, version, op) {
  const url = `${REPLICATION_URL.replace(/\/$/, '')}/internal/notify`;
  try {
    const r = await axios.post(url, { key, version, op: op || 'upsert' }, { timeout: REPLICATION_TIMEOUT_MS });
    return { replicated: true, detail: r.data };
  } catch (e) {
    // Replication service down or strong-sync timeout: origin write still succeeds
    // (AP choice) but we surface a warning so the demo can show the trade-off.
    return { replicated: false, warning: e.message };
  }
}

app.put('/content/:key', async (req, res) => {
  const key = req.params.key;
  let data = null;
  let contentType = 'text/plain';
  if (req.body && typeof req.body === 'object' && ('data' in req.body)) {
    data = String(req.body.data ?? '');
    contentType = req.body.contentType || 'text/plain';
  } else if (typeof req.body === 'string') {
    data = req.body;
    contentType = req.headers['content-type'] || 'text/plain';
  } else {
    data = '';
  }
  const existing = db.prepare('SELECT * FROM contents WHERE key = ?').get(key);
  const version = existing ? existing.version + 1 : 1;
  const updatedAt = nowIso();
  fs.writeFileSync(safeFile(key), data, 'utf8');
  db.prepare(
    `INSERT INTO contents(key, version, content_type, updated_at) VALUES(?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET version=excluded.version, content_type=excluded.content_type, updated_at=excluded.updated_at`
  ).run(key, version, contentType, updatedAt);

  const rep = await notifyReplication(key, version, 'upsert');
  res.setHeader('X-Version', String(version));
  res.json({ key, version, updatedAt, contentType, replication: rep });
});

app.delete('/content/:key', async (req, res) => {
  const key = req.params.key;
  db.prepare('DELETE FROM contents WHERE key = ?').run(key);
  try { fs.unlinkSync(safeFile(key)); } catch {}
  const rep = await notifyReplication(key, 0, 'delete');
  res.json({ key, deleted: true, replication: rep });
});

app.listen(PORT, () => console.log(`[origin] listening on :${PORT} store=${STORE_DIR}`));
