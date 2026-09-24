'use strict';
// Shared helpers for all CDN microservices (pure JS, no extra deps).
const crypto = require('crypto');

function requestId(req, _res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  if (typeof next === 'function') next();
  return req.id;
}

function requestIdMiddleware(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

function nowIso() {
  return new Date().toISOString();
}

// Fire-and-forget analytics emitter (never throws).
async function emitAnalytics(baseUrl, event) {
  if (!baseUrl) return;
  try {
    // Lazy require so `common` stays dependency-free for tests.
    const axios = require('axios');
    await axios.post(
      `${baseUrl.replace(/\/$/, '')}/events`,
      { ...event, ts: event.ts || nowIso() },
      { timeout: 1500 }
    );
  } catch (_e) {
    // best-effort only
  }
}

function pickEdge(clientRegion, edgeMap, fallback = 'us') {
  const r = String(clientRegion || fallback).toLowerCase();
  if (edgeMap[r]) return { region: r, url: edgeMap[r], reason: `client-region=${r}` };
  return { region: fallback, url: edgeMap[fallback], reason: `unknown-region->default(${fallback})` };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { requestIdMiddleware, nowIso, emitAnalytics, pickEdge, sleep };
