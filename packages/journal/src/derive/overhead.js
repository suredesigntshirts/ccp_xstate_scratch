// The overhead view (plan item obs-time-and-rework): tokens spent on harness work against product work. A session's
// tokens (its turn.usage and agent.finish rows) are split by the PRs it wrote commits on: by the share of changed
// lines in paths the config lists as harness. A session with no PR is unattributed. It reads rows and writes nothing.
// docs/journal.md, "Derived views", says where the PR facts come from.

/** A glob over `<owner>/<repo>/<path>`: `**` matches across folders, `*` within one. */
export function globRegex(glob) {
  const body = glob.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${body}$`);
}

/** Whether `path` (`<owner>/<repo>/<file>`) is harness under `config` ({ harness: [glob, ...] }). */
export function isHarness(path, config) {
  return (config.harness ?? []).some((g) => globRegex(g).test(path));
}

const tokensOf = (t) => (t ? (t.input ?? 0) + (t.output ?? 0) + (t.cacheRead ?? 0) + (t.cacheCreation ?? 0) : 0);

/**
 * The overhead view over `rows` and `prs` (PR facts: { repo, number, sessions, files: [{ path, changes }] }, as
 * bin/rework.js reads them). Returns { harness, product, unattributed, sessions }: token totals, and per session its
 * tokens, the harness share it was split by, and inputs (the row ids and PRs read). Tokens count input, output and
 * cache reads and writes alike.
 */
export function overhead(rows, prs, config) {
  const seen = new Set();
  const sessions = {};
  // An agent.finish row's tokens cover the agent's whole transcript, so an agent that finished twice counts once: its
  // last row (retro finding 3, plan item engine-item-views).
  const last = new Map();
  for (const r of rows) {
    if (r?.kind !== 'agent.finish') continue;
    const key = `${r.session} ${r.payload?.agentId ?? r.agent}`;
    if (!last.has(key) || r.at >= last.get(key).at) last.set(key, r);
  }
  const lastIds = new Set([...last.values()].map((r) => r.id));
  for (const r of rows) {
    if (!r || seen.has(r.id) || (r.kind !== 'turn.usage' && r.kind !== 'agent.finish')) continue;
    if (r.kind === 'agent.finish' && !lastIds.has(r.id)) continue;
    seen.add(r.id);
    sessions[r.session] ??= { tokens: 0, harnessLines: 0, productLines: 0, prs: [], rows: [] };
    sessions[r.session].tokens += tokensOf(r.payload?.tokens);
    sessions[r.session].rows.push(r.id);
  }
  for (const pr of prs) {
    for (const s of pr.sessions ?? []) {
      if (!sessions[s]) continue;
      sessions[s].prs.push(`${pr.repo}#${pr.number}`);
      for (const f of pr.files) {
        const lines = Math.max(1, f.changes ?? 0);
        if (isHarness(`${pr.repo}/${f.path}`, config)) sessions[s].harnessLines += lines;
        else sessions[s].productLines += lines;
      }
    }
  }
  const out = { harness: 0, product: 0, unattributed: 0, sessions: {} };
  for (const [id, s] of Object.entries(sessions)) {
    const lines = s.harnessLines + s.productLines;
    const share = lines ? s.harnessLines / lines : null;
    const harness = share === null ? 0 : Math.round(s.tokens * share);
    const product = share === null ? 0 : s.tokens - harness;
    if (share === null) out.unattributed += s.tokens;
    out.harness += harness;
    out.product += product;
    out.sessions[id] = { tokens: s.tokens, harnessShare: share, harness, product, inputs: { rows: s.rows, prs: s.prs } };
  }
  return out;
}
