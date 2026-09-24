#!/bin/bash
# Demo (b): consistency trade-off — eventual staleness window vs strong latency.
set -e
GW=${GATEWAY_URL:-http://localhost:3000}
REPL=http://localhost:3005
COORD=http://localhost:3006
KEY=${1:-consistency-demo}
echo "== eventual mode, lag 3000ms =="
curl -s -X POST "$REPL/replication/mode" -H 'Content-Type: application/json' -d '{"mode":"eventual","lagMs":3000}'; echo
curl -s -X PUT "$GW/c/$KEY" -H 'Content-Type: application/json' -d '{"data":"v1 @'$(date +%T)'"}'; echo
sleep 4
echo "-- immediate PUT v2 --"
time curl -s -X PUT "$GW/c/$KEY" -H 'Content-Type: application/json' -d '{"data":"v2 @'$(date +%T)'"}'; echo
echo "-- immediate GET (expect STALE v1 under eventual) --"
curl -s "$GW/c/$KEY" -H 'X-Client-Region: eu'; echo
echo "-- consistency matrix (stale) --"
curl -s "$COORD/consistency/state"; echo
echo "-- after lag window, GET (expect v2) --"
sleep 4; curl -s "$GW/c/$KEY" -H 'X-Client-Region: eu'; echo
echo "== strong mode =="
curl -s -X POST "$REPL/replication/mode" -H 'Content-Type: application/json' -d '{"mode":"strong"}'; echo
echo "-- PUT v3 (slower, synchronous fanout) --"
time curl -s -X PUT "$GW/c/$KEY" -H 'Content-Type: application/json' -d '{"data":"v3 @'$(date +%T)'"}'; echo
echo "-- immediate GET (expect fresh v3) --"
curl -s "$GW/c/$KEY" -H 'X-Client-Region: eu'; echo
