#!/bin/bash
# ccp_xstate cloud setup. Run by paste-me.sh at each container build, before Claude Code starts. Plan item
# env-bootstrap holds the reasoning (ledger L-setup-script-stub, L-rules-before-session, L-no-self-modification).
# 1. Merges the repo's .claude/settings.json into ~/.claude/settings.json: objects merge, the repo wins on plain
#    values, and lists (such as autoMode.allow) are unioned. That is where the allow rules and the subagent depth
#    (env CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=3) come from. Settings live in the repo, never here.
# 2. Installs the ccp-harness plugin as a copy of the newest release harness-v<x.y.z> (a tag, or a branch
#    release/harness-v<x.y.z>, whichever is newer by version; scripts/release/release.mjs), or of the clone's HEAD
#    when there is no release yet, at ~/.claude/skills/ccp-harness, where Claude Code loads it as a plugin. It is
#    extracted from git, never linked to the working tree, so editing plugins/ changes nothing a session runs.
#    packages/journal is bundled at lib/journal, and release.json says what the copy was built from.
#    The copy's plugin.json carries the release's version (the ref names the version; plan item self-update-by-version).
#    Run from inside a Claude Code session with that session's HOME, it leaves the installed copy alone, because a
#    session must never edit the plugin it runs (ledger L-no-self-modification); the next container gets the update.
# 0. Before all that, fast-forwards the clone to origin/main when that is safe: tracked files clean, and HEAD is a
#    branch tracking origin/main or detached at an ancestor of it. Otherwise it leaves the clone and says why.
# 3. Logs the names of the environment variables, never their values.
# Running it again gives the same ~/.claude files. Log: $CCP_SETUP_LOG (default /tmp/ccp-xstate-setup.log).
# Tests only: CCP_SETUP_FETCH=0 skips fetching main and the release refs from origin, and CCP_SETUP_REF installs that ref
# instead of the newest release (the tests install HEAD, so they test the code they sit beside). Always exits 0.
log="${CCP_SETUP_LOG:-/tmp/ccp-xstate-setup.log}"
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
plugin=ccp-harness
dest="$HOME/.claude/skills/$plugin"
{
  echo "== setup start $(date -u +%Y-%m-%dT%H:%M:%SZ) repo $(git -C "$repo" log --oneline -1 2>&1)"
  mkdir -p "$HOME/.claude/skills"

  # 0. Fast-forward a clean clone.
  if [ "${CCP_SETUP_FETCH:-1}" != 0 ]; then
    g() { git -C "$repo" "$@"; }
    branch=$(g symbolic-ref -q --short HEAD)
    if [ -n "$(g status --porcelain --untracked-files=no)" ]; then
      echo "clone not fast-forwarded: it has uncommitted changes"
    elif [ -n "$branch" ] && [ "$(g rev-parse --abbrev-ref "$branch@{upstream}" 2>/dev/null)" != origin/main ]; then
      echo "clone not fast-forwarded: branch $branch does not track origin/main"
    elif ! timeout 20 git -C "$repo" fetch -q origin main 2>&1; then
      echo "clone not fast-forwarded: git fetch origin main failed"
    elif ! g merge-base --is-ancestor HEAD FETCH_HEAD; then
      echo "clone not fast-forwarded: HEAD is not an ancestor of origin/main"
    elif [ -n "$branch" ]; then
      g merge -q --ff-only FETCH_HEAD && echo "clone fast-forwarded: $branch at $(g rev-parse --short HEAD)"
    else
      g checkout -q --detach FETCH_HEAD && echo "clone fast-forwarded: detached at $(g rev-parse --short HEAD)"
    fi
  fi

  # 1. Settings.
  python3 - "$repo/.claude/settings.json" "$HOME/.claude/settings.json" <<'PY'
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
repo = json.load(open(src))
user = json.load(open(dst)) if os.path.exists(dst) else {}
def merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict): merge(a[k], v)
        elif isinstance(v, list) and isinstance(a.get(k), list): a[k] += [x for x in v if x not in a[k]]
        else: a[k] = v
    return a
merged = merge(user, repo)
with open(dst, 'w') as f:
    json.dump(merged, f, indent=2)
    f.write('\n')
print('settings merged; keys:', ' '.join(sorted(repo)), '; env keys:', ' '.join(sorted(merged.get('env', {}))),
      '; autoMode.allow rules:', len(merged.get('autoMode', {}).get('allow', [])))
PY

  # 2. The plugin, as a copy of a release.
  if [ "${CCP_SETUP_FETCH:-1}" != 0 ]; then
    timeout 20 git -C "$repo" fetch -q origin 'refs/tags/harness-v*:refs/tags/harness-v*' \
      '+refs/heads/release/harness-v*:refs/remotes/origin/release/harness-v*' 2>&1 \
      || echo "release refs not fetched; using the ones the clone has"
  fi
  # Each release ref as "<x.y.z> <ref>", newest version first; a tag and a branch of one version are the same release.
  newest=$(git -C "$repo" for-each-ref --format='%(refname)' 'refs/tags/harness-v*' 'refs/remotes/origin/release/harness-v*' \
    | sed -nE 's#^(.*/harness-v([0-9]+\.[0-9]+\.[0-9]+))$#\2 \1#p' | sort -t. -k1,1nr -k2,2nr -k3,3nr | head -1)
  tag=""; ref=HEAD
  if [ -n "$newest" ]; then tag="harness-v${newest%% *}"; ref="${newest#* }"; fi
  if [ -n "$CCP_SETUP_REF" ]; then
    ref="$CCP_SETUP_REF"; tag=""
    case "$ref" in harness-v*|*/harness-v*) tag="harness-v${ref##*harness-v}" ;; esac
  fi
  commit=$(git -C "$repo" rev-parse "$ref^{commit}" 2>/dev/null)
  work=$(mktemp -d)
  if [ -n "$commit" ] && git -C "$repo" archive "$commit" plugins/harness packages/journal \
      ':(exclude)plugins/harness/test' ':(exclude)packages/journal/test' | tar -x -C "$work"; then
    mkdir -p "$work/out/lib"
    cp -a "$work/plugins/harness/." "$work/out/"
    cp -a "$work/packages/journal" "$work/out/lib/journal"
    python3 - "$work/out" "$tag" "$commit" <<'PY'
import json, os, sys
root, tag, commit = sys.argv[1], sys.argv[2] or None, sys.argv[3]
files = sorted(os.path.relpath(os.path.join(d, f), root) for d, _, fs in os.walk(root) for f in fs)
path = os.path.join(root, '.claude-plugin', 'plugin.json')
manifest = json.load(open(path))
if tag:
    manifest['version'] = tag[len('harness-v'):]
    with open(path, 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
with open(os.path.join(root, 'release.json'), 'w') as f:
    json.dump({'name': manifest['name'], 'version': manifest['version'], 'tag': tag, 'commit': commit, 'files': files}, f, indent=2)
    f.write('\n')
print('plugin', manifest['name'], manifest['version'], 'from', tag or 'HEAD (no release yet)', commit[:12], '-', len(files), 'files')
PY
    running=""
    if [ -n "$CLAUDE_PID" ] && [ -r "/proc/$CLAUDE_PID/environ" ]; then
      running=$(tr '\0' '\n' < "/proc/$CLAUDE_PID/environ" | sed -n 's/^HOME=//p' | head -1)
    fi
    if [ -n "$running" ] && [ "$running" = "$HOME" ] && [ -e "$dest" ]; then
      echo "plugin not replaced: Claude Code (pid $CLAUDE_PID) is running from this HOME and may run $dest; the next container installs it"
    else
      rm -rf "$dest.old"
      [ -e "$dest" ] || [ -L "$dest" ] && mv "$dest" "$dest.old"
      mv "$work/out" "$dest" && rm -rf "$dest.old" && echo "installed $dest"
    fi
  else
    echo "plugin not installed: could not extract plugins/harness at ${ref}"
  fi
  rm -rf "$work"

  # 3. Environment variable names only.
  echo "env names: $(compgen -e | sort | tr '\n' ' ')"
  echo "== setup end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >> "$log" 2>&1
exit 0
