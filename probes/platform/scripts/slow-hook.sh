#!/bin/bash
# Settings hook that measures its own budget. Sleeps PROBE_SLOW_<EVENT> seconds (default 0) and logs start and
# end; a start line with no end line means the hook was killed at its budget.
ev="$1"; log="${PROBE_LOG:-$(dirname "$0")/../out/probe-log.jsonl}"; mkdir -p "$(dirname "$log")"
cat >/dev/null
var="PROBE_SLOW_${ev}"; secs="${!var:-0}"
[ "$secs" = 0 ] && exit 0
echo "{\"at\":\"$(date -u +%FT%T.%3NZ)\",\"probe\":\"hook-budget\",\"hook\":\"$ev\",\"phase\":\"start\",\"sleep\":$secs}" >> "$log"
for i in $(seq 1 "$secs"); do sleep 1; echo "{\"at\":\"$(date -u +%FT%T.%3NZ)\",\"probe\":\"hook-budget\",\"hook\":\"$ev\",\"phase\":\"tick\",\"s\":$i}" >> "$log"; done
echo "{\"at\":\"$(date -u +%FT%T.%3NZ)\",\"probe\":\"hook-budget\",\"hook\":\"$ev\",\"phase\":\"end\"}" >> "$log"
