#!/bin/bash
# Settings hook that records its whole stdin input, to see how a refusal reaches settings hooks.
ev="$1"; log="${PROBE_LOG:-$(dirname "$0")/../out/probe-log.jsonl}"; mkdir -p "$(dirname "$log")"
in=$(cat)
python3 -c 'import json,sys,datetime; print(json.dumps({"at":datetime.datetime.utcnow().isoformat()+"Z","probe":"settings-hook","hook":sys.argv[1],"input":json.loads(sys.argv[2] or "null")}))' "$ev" "$in" >> "$log"
exit 0
