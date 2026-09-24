const GW = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:3000';
const ORIGIN = import.meta.env.VITE_ORIGIN_URL || 'http://localhost:3001';
const ANALYTICS = import.meta.env.VITE_ANALYTICS_URL || 'http://localhost:3007';
const REPL = import.meta.env.VITE_REPLICATION_URL || 'http://localhost:3005';
const COORD = import.meta.env.VITE_COORDINATOR_URL || 'http://localhost:3006';
const EDGE_URLS = {
  us: import.meta.env.VITE_EDGE_US_URL || 'http://localhost:3002',
  eu: import.meta.env.VITE_EDGE_EU_URL || 'http://localhost:3003',
  asia: import.meta.env.VITE_EDGE_ASIA_URL || 'http://localhost:3004',
};

async function j(res) {
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(
      res.status === 404
        ? `key not found at origin — PUT it first, then GET`
        : `HTTP ${res.status}: ${text.slice(0, 200)}`
    );
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

function metaFrom(res) {
  const g = (h) => res.headers.get(h);
  return {
    cache: g('x-cache'),
    edge: g('x-edge'),
    version: g('x-version'),
    edgeLatencyMs: g('x-edge-latency-ms'),
    originLatencyMs: g('x-origin-latency-ms'),
    routeReason: g('x-route-reason'),
    edgeTarget: g('x-edge-target'),
  };
}

async function optional(promise) {
  try { return await promise; } catch { return null; }
}

export const api = {
  gatewayGet: async (key, region) => {
    const res = await fetch(`${GW}/c/${encodeURIComponent(key)}`, { headers: { 'X-Client-Region': region } });
    const meta = metaFrom(res);
    const data = await j(res);
    return { ...data, _meta: meta };
  },
  gatewayPut: (key, data) => fetch(`${GW}/c/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }).then(j),
  summary: () => fetch(`${ANALYTICS}/metrics/summary`).then(j),
  byEdge: () => fetch(`${ANALYTICS}/metrics/by-edge`).then(j),
  timeseries: () => fetch(`${ANALYTICS}/metrics/timeseries?windowSec=120&bucketSec=5`).then(j),
  resetMetrics: () => fetch(`${ANALYTICS}/metrics/reset`, { method: 'DELETE' }).then(j),
  replStatus: () => fetch(`${REPL}/replication/status`).then(j),
  replMode: (mode, lagMs) => fetch(`${REPL}/replication/mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, lagMs }) }).then(j),
  consistency: () => fetch(`${COORD}/consistency/state`).then(j),
  invalidate: (key) => fetch(`${COORD}/invalidate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).then(j),
  healthAll: async () => {
    const check = (url) => optional(fetch(`${url}/health`).then((r) => (r.ok ? 'up' : 'down')).catch(() => 'down'));
    const [gateway, origin, us, eu, asia, repl, coord, analytics] = await Promise.all([
      check(GW), check(ORIGIN), check(EDGE_URLS.us), check(EDGE_URLS.eu),
      check(EDGE_URLS.asia), check(REPL), check(COORD), check(ANALYTICS),
    ]);
    return { gateway, origin, us, eu, asia, repl, coord, analytics };
  },
  edgeStatsAll: async () => {
    const one = (region) => optional(fetch(`${EDGE_URLS[region]}/cache/_stats`).then(j));
    const [us, eu, asia] = await Promise.all([one('us'), one('eu'), one('asia')]);
    return { us, eu, asia };
  },
};
