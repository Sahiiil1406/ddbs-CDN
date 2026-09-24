#!/bin/bash
# Demo (a): cache HIT vs MISS latency. Requires stack running (docker compose up or run-local.sh).
set -e
GW=${GATEWAY_URL:-http://localhost:3000}
KEY=${1:-demo-page}
echo "== PUT $KEY =="
curl -s -X PUT "$GW/c/$KEY" -H 'Content-Type: application/json' -d '{"data":"<html><h1>CDN demo page v1</h1></html>"}' | head -c 300; echo
echo "== wait for eventual replication (3s) =="; sleep 3
echo "== cold one edge to force a MISS (push replication warms all edges) =="
curl -s -X DELETE "http://localhost:3004/cache/$KEY"; echo
echo "== GET 1 (expect MISS with origin fetch) =="
curl -s -D - "$GW/c/$KEY" -H 'X-Client-Region: asia' -o /tmp/cdn_body | grep -iE '^X-(CACHE|EDGE|VERSION|.*LATENCY|ROUTE|EDGE-TARGET)|HTTP/'
echo "== GET 2 (expect HIT) =="
curl -s -D - "$GW/c/$KEY" -H 'X-Client-Region: asia' -o /tmp/cdn_body | grep -iE '^X-(CACHE|EDGE|VERSION|.*LATENCY|ROUTE|EDGE-TARGET)|HTTP/'
echo "== analytics summary =="
curl -s http://localhost:3007/metrics/summary; echo
