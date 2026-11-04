#!/usr/bin/env bash
# The toy run (plan item engine-toy-run): a toy issue in the scratch repo, taken from filed to merged by the quick-fix
# workflow on the engine, with real actors. Repeatable: every `run` files a fresh issue under a fresh item id.
#
#   scripts/toy-run.sh run [item]          file the issue, start a driver session that files the item and starts each
#                                          actor's agent, and stop at the merge card (printed as JSON)
#   scripts/toy-run.sh run <item> --issue <url> --expect <file>
#                                          the same from an existing issue (a real one), whose Expect lines are the
#                                          JSON array of strings in <file>; nothing is filed
#   scripts/toy-run.sh card <item> <id>    record the card a thread put up for the item's ask run (bin/host.js card)
#   scripts/toy-run.sh tap <item> <file>   resume the item's driver session with the tap wake in <file> as its prompt;
#                                          the session's host hook reads it, and the merge runs at the verdict's sha
#   scripts/toy-run.sh answer <item> <choice> <session>
#                                          a stand-in session's answer to the open ask, under $TOY_DIR/harness/grants.json
#                                          (bin/host.js answer, plan item engine-cards-standin); the merge runs as on a tap
#   scripts/toy-run.sh check <item>        the journal check against the sessions' logs and GitHub, and every
#                                          engine.transition row's source
#
# Who does what. The driver is a headless `claude -p` session with the harness plugin from this repo, so its calls
# and its agents' calls are captured. It files the item (the start's source is its own session, as engine-host
# decided) and calls the Agent tool with `ccp-run <run>` for each run the harness says is waiting; the actor hooks do
# the rest (plan item engine-actors). Its UserPromptSubmit and ReadNotifications hooks run `bin/host.js wake` for the
# item, added with --settings, so a wake reaches the host without the agent. A headless session can't reach the
# thread, so the card is put up by the thread that runs this script (request_decision), which records its id with
# `card`, and the person's tap reaches the driver as the prompt of `tap`: the wake text exactly as the platform
# delivered it to the thread. Nothing an agent says moves the item: every step is a completion the return hook
# checked, a wake, or a timer.
#
# Env: TOY_DIR (journal and records, default /mnt/project-files/toy-run), TOY_WORK (clones and worktrees, default
# $HOME/toy-run), TOY_REPO (default suredesigntshirts/ccp_xstate_scratch), TOY_MODEL (driver model, default sonnet).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TOY_DIR=${TOY_DIR:-/mnt/project-files/toy-run}
TOY_WORK=${TOY_WORK:-$HOME/toy-run}
TOY_REPO=${TOY_REPO:-suredesigntshirts/ccp_xstate_scratch}
TOY_MODEL=${TOY_MODEL:-sonnet}
HARNESS="$TOY_DIR/harness"
JOURNAL="$HARNESS/journal"
HOST="$ROOT/packages/engine/bin/host.js"

die() { echo "toy-run: $*" >&2; exit 2; }
record() { echo "$TOY_DIR/runs/$1.json"; }
field() { node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(r[process.argv[2]])' "$(record "$1")" "$2"; }

# The session's own environment, minus the cloud session's id: capture names a session by that id when it is set,
# and the driver must be journalled as itself.
driver() {
  env -u CLAUDE_CODE_REMOTE_SESSION_ID CCP_HARNESS_DIR="$HARNESS" CCP_JOURNAL_DIR="$JOURNAL" CCP_REPO="$ROOT" \
    claude -p --model "$TOY_MODEL" --plugin-dir "$ROOT/plugins/harness" --permission-mode auto \
    --settings "$(settings "$1")" "${@:2}"
}

# The host hook for one item: a wake (the prompt) or a ReadNotifications result goes to bin/host.js wake.
settings() {
  local item=$1 clone="$TOY_WORK/$1/repo" trees="$TOY_WORK/$1/worktrees"
  local cmd="node \"$HOST\" wake --item $item --workflow quick-fix --root \"$JOURNAL\" --repo \"$clone\" --worktrees \"$trees\""
  node -e '
    const cmd = process.argv[1];
    const hook = [{ type: "command", command: cmd, timeout: 120 }];
    console.log(JSON.stringify({ hooks: {
      UserPromptSubmit: [{ hooks: hook }],
      PostToolUse: [{ matcher: "ReadNotifications", hooks: hook }]
    } }));' "$cmd"
}

cmd_run() {
  local item=${1:-toy-$(date -u +%m%d%H%M%S)} issue_url="" expect_file=""
  shift || true
  while [ $# -gt 0 ]; do
    case "$1" in
      --issue) issue_url=$2; shift 2 ;;
      --expect) expect_file=$2; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  [ -n "$issue_url" ] && [ -z "$expect_file" ] && die "--issue needs --expect <file>"
  [ -n "$issue_url" ] && { [ -s "$expect_file" ] || die "no Expect lines in $expect_file"; }
  [ -e "$(record "$item")" ] && die "$item has run already; pick another id"
  # sessions/ as the install makes it: capture appends to a session's file there and creates no folder.
  mkdir -p "$JOURNAL/sessions" "$TOY_DIR/runs" "$TOY_WORK/$item"
  # The harness's install marker for this journal, so the plugin's hooks run (plugins/harness/scripts/host.mjs gate).
  [ -e "$HARNESS/install.json" ] || node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({ installed_at: new Date().toISOString(), session: "toy-run.sh", journal: process.argv[2] }, null, 2) + "\n");' \
    "$HARNESS/install.json" "$JOURNAL"

  local clone="$TOY_WORK/$item/repo"
  git clone -q "https://github.com/$TOY_REPO.git" "$clone"
  git -C "$clone" config user.name "ccp toy run"
  git -C "$clone" config user.email "toy-run@ccp.invalid"

  # The toy issue: one small function and its test. Each run asks for its own name, so runs don't collide.
  local fn
  fn="sub_$(echo "$item" | tr -c 'A-Za-z0-9\n' '_' | tr 'A-Z' 'a-z')"
  local body
  body="Add \`$fn(a, b)\` to \`src.js\`: it returns \`a - b\`. Add \`test/$fn.test.js\` with node:test cases for it, and keep \`npm test\` green.

This is a toy issue for the ccp_xstate engine's toy run (plan item engine-toy-run), item \`$item\`. The fix is one PR on $TOY_REPO whose body says \`Closes #<this issue>\`. GraphQL is closed in this environment, so open the PR over REST: \`gh api repos/$TOY_REPO/pulls -f title=... -f head=<branch> -f base=main -f body=...\`."
  local issue
  if [ -n "$issue_url" ]; then
    issue=$issue_url
    echo "toy-run: existing issue $issue" >&2
  else
    # REST, not gh's issue command: GraphQL is closed to cloud sessions (ledger L-graphql-blocked).
    issue=$(gh api "repos/$TOY_REPO/issues" -f title="Toy ($item): add $fn(a, b)" -f body="$body" --jq .html_url)
    echo "toy-run: filed $issue" >&2
  fi

  local session
  session=$(node -e 'console.log(require("crypto").randomUUID())')
  local input="$TOY_DIR/runs/$item.input.json"
  if [ -n "$issue_url" ]; then
    node -e '
      const [file, url, from] = process.argv.slice(1);
      const expect = JSON.parse(require("fs").readFileSync(from, "utf8"));
      if (!Array.isArray(expect) || !expect.length || !expect.every((e) => typeof e === "string" && e)) throw new Error(from + " is not a JSON array of Expect lines");
      require("fs").writeFileSync(file, JSON.stringify({ issue: { url, expect } }) + "\n");' "$input" "$issue" "$expect_file"
  else
  node -e '
    const [file, url, fn, repo] = process.argv.slice(1);
    const expect = [
      `src.js exports ${fn}(a, b), which returns a - b`,
      `test/${fn}.test.js tests ${fn} with node:test, and npm test passes`,
      `The change is one PR on ${repo} whose body says Closes ${url}, and its checks are green`
    ];
    require("fs").writeFileSync(file, JSON.stringify({ issue: { url, expect } }) + "\n");' "$input" "$issue" "$fn" "$TOY_REPO"
  fi
  node -e '
    const [file, item, session, issue, clone, input] = process.argv.slice(1);
    require("fs").writeFileSync(file, JSON.stringify({ item, session, issue, clone, input, started: new Date().toISOString() }, null, 2) + "\n");' \
    "$(record "$item")" "$item" "$session" "$issue" "$clone" "$input"

  local prompt="You drive a run of the ccp_xstate engine on $issue. Do only this:
1. Run this Bash command exactly, to file the work item:
node \"$HOST\" start --item $item --workflow quick-fix --session $session --root \"$JOURNAL\" --repo \"$clone\" --worktrees \"$TOY_WORK/$item/worktrees\" --input \"\$(cat '$input')\"
2. The output's \"waiting\" list, and the ccp-harness notes after each Agent call, name actor runs waiting for their agent. For each, call the Agent tool (subagent_type general-purpose, in the foreground) with the prompt given, exactly, and nothing else in the prompt. One at a time. Do not do the agents' work yourself and do not call the harness return tool yourself.
3. When no run is waiting, run: node \"$HOST\" show --item $item --workflow quick-fix --root \"$JOURNAL\"
and reply with its output. Stop there: the merge waits for a person's answer."
  echo "toy-run: driver session $session" >&2
  (cd "$clone" && driver "$item" --session-id "$session" "$prompt") | tee "$TOY_DIR/runs/$item.driver.txt" >&2
  node "$HOST" show --item "$item" --workflow quick-fix --root "$JOURNAL"
}

cmd_card() {
  local item=$1 ref=$2
  local effect
  effect=$(node "$HOST" show --item "$item" --workflow quick-fix --root "$JOURNAL" |
    node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));const r=s.pending.runs.find((r)=>r.actor==="ask");if(!r)process.exit(1);console.log(r.id)') ||
    die "$item has no open ask run"
  node "$HOST" card --item "$item" --workflow quick-fix --root "$JOURNAL" --effect "$effect" --ref "$ref"
}

cmd_tap() {
  local item=$1 file=$2
  [ -s "$file" ] || die "no wake text in $file"
  local session clone
  session=$(field "$item" session)
  clone=$(field "$item" clone)
  (cd "$clone" && driver "$item" --resume "$session" "$(cat "$file")") | tee -a "$TOY_DIR/runs/$item.driver.txt" >&2
  node "$HOST" show --item "$item" --workflow quick-fix --root "$JOURNAL"
}

cmd_answer() {
  local item=$1 choice=$2 by=$3
  local effect
  effect=$(node "$HOST" show --item "$item" --workflow quick-fix --root "$JOURNAL" |
    node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));const r=s.pending.runs.find((r)=>r.actor==="ask");if(!r)process.exit(1);console.log(r.id)') ||
    die "$item has no open ask run"
  local clone
  clone=$(field "$item" clone)
  node "$HOST" answer --item "$item" --workflow quick-fix --root "$JOURNAL" --effect "$effect" --choice "$choice" --by "$by" \
    --repo "$clone" --worktrees "$TOY_WORK/$item/worktrees"
}

cmd_check() {
  local item=$1
  local session
  session=$(field "$item" session)
  local transcript
  transcript=$(ls "$HOME"/.claude/projects/*/"$session".jsonl 2>/dev/null | head -1)
  [ -n "$transcript" ] || die "no transcript for session $session"
  local since
  since=$(field "$item" started)
  echo "== journal check: session $session, its agents, and merges on $TOY_REPO since $since" >&2
  node "$ROOT/packages/journal/bin/journal-check.js" --journal "$JOURNAL" --session "$JOURNAL/sessions/$session.jsonl" \
    --events "$transcript" --repo "$TOY_REPO" --since "$since" --host || status=$?
  echo "== engine.transition sources for $item" >&2
  node -e '
    const rows = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map(JSON.parse)
      .filter((r) => r.kind === "engine.transition");
    const kind = (r) => r.payload.event.type === "xstate.init" ? "start (the filing session)"
      : r.source.system === "harness" ? "completion (return hook)" : r.source.system === "engine" ? "completion (effect)"
      : r.source.system === "hearth" ? "wake (card tap)" : r.source.system === "standin" ? "stand-in answer (grant " + r.source.ref.split(" ")[0] + ")" : r.source.system === "github" ? "wake (GitHub)"
      : r.source.system === "timer" ? "timer" : r.source.system === "claude-code" ? "wake (task notification)" : "OTHER";
    let other = 0;
    for (const r of rows) {
      const k = kind(r);
      if (k === "OTHER") other++;
      console.log([r.payload.seq ?? "-", r.payload.outcome, r.payload.event.type, `${r.source.system} ${r.source.ref}`, k].join("\t"));
    }
    if (other) { console.error(`${other} transition(s) with another source`); process.exit(1); }' "$JOURNAL/items/$item.jsonl"
  return "${status:-0}"
}

case "${1:-}" in
  run) shift; cmd_run "$@" ;;
  answer) [ $# -eq 4 ] || die "usage: answer <item> <choice> <stand-in session>"; cmd_answer "$2" "$3" "$4" ;;
  card) [ $# -eq 3 ] || die "usage: card <item> <card id>"; cmd_card "$2" "$3" ;;
  tap) [ $# -eq 3 ] || die "usage: tap <item> <wake file>"; cmd_tap "$2" "$3" ;;
  check) [ $# -eq 2 ] || die "usage: check <item>"; cmd_check "$2" ;;
  *) sed -n '2,18p' "$0" >&2; exit 2 ;;
esac
