#!/bin/bash
# Demo (c): invalidation.
set -e
GW=${GATEWAY_URL:-http://localhost:3000}
COORD=http://localhost:3006
KEY=${1:-demo-page}
echo "-- warm cache --"
curl -s "$GW/c/$KEY" -H 'X-Client-Region: us' > /dev/null
curl -s http://localhost:3002/cache/_stats; echo
echo "-- invalidate $KEY --"
curl -s -X POST "$COORD/invalidate" -H 'Content-Type: application/json' -d '{"key":"'"$KEY"'"}'; echo
echo "-- next GET is MISS + origin refetch --"
curl -s -D - "$GW/c/$KEY" -H 'X-Client-Region: us' -o /tmp/cdn_body2 | grep -iE '^X-(CACHE|EDGE|VERSION)|HTTP/'
