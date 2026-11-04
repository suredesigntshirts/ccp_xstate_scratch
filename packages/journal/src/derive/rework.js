// The rework view (plan item obs-time-and-rework): per PR, how many pushes CI judged, how many were red, how many
// rounds that made, and how many replans its item had; and the tripwire rows for a PR past its round limit.
// Before the engine exists, rounds are counted per PR, not per item. It reads rows and writes nothing.
// docs/journal.md, "Derived views", defines each count.

/** A check run with one of these conclusions is red. Cancelled, skipped and neutral runs are neither red nor green. */
export const RED = Object.freeze(['failure', 'timed_out', 'action_required', 'startup_failure']);

/** The round limit when the PR's item sets none (plan item head `step_back.max_rounds`). */
export const DEFAULT_LIMIT = 2;

/**
 * `ci.result` rows from one PR's GitHub facts, as `prFacts` in bin/rework.js reads them from REST: one row per
 * completed check run on any of the PR's commits. `envelope` gives each row's session and release.
 */
export function ciRows(facts, envelope) {
  const rows = [];
  for (const c of facts.commits) {
    for (const run of c.checkRuns) {
      if (run.status !== 'completed') continue;
      rows.push({
        ...envelope,
        id: `github-check-run-${run.id}`,
        at: new Date(Date.parse(run.completedAt)).toISOString(),
        kind: 'ci.result',
        source: { system: 'github', ref: String(run.id) },
        payload: {
          workflow: run.name, repo: facts.repo, pr: facts.number, sha: c.sha, merge: c.parents > 1,
          result: run.conclusion, startedAt: run.startedAt, completedAt: run.completedAt,
          item: facts.item ?? null, labels: facts.labels ?? [],
        },
      });
    }
  }
  return rows;
}

const prKey = (p) => `${p.repo}#${p.pr}`;

/**
 * The rework view over `rows`. Returns { prs }: one entry per PR that has `ci.result` rows with a `pr`, holding
 * pushes (distinct commits CI ran on, in order of their first run), redPushes, redRuns, rounds and replans, and
 * inputs (the row ids read). A round starts at the PR's first push and again at each push after a red one, except a
 * merge commit, which stays in its round. `checks` limits which check names count; all count by default.
 */
export function rework(rows, { checks = null } = {}) {
  const seen = new Set();
  const runs = rows.filter((r) => r?.kind === 'ci.result' && r.payload?.pr != null && !seen.has(r.id) && seen.add(r.id))
    .filter((r) => !checks || checks.includes(r.payload.workflow))
    .sort((a, b) => (a.payload.startedAt ?? a.at).localeCompare(b.payload.startedAt ?? b.at) || a.at.localeCompare(b.at));
  const prs = new Map();
  for (const r of runs) {
    const key = prKey(r.payload);
    if (!prs.has(key)) prs.set(key, { repo: r.payload.repo, pr: r.payload.pr, item: r.payload.item ?? null, labels: r.payload.labels ?? [], shas: new Map(), inputs: [] });
    const pr = prs.get(key);
    pr.inputs.push(r.id);
    if (!pr.shas.has(r.payload.sha)) pr.shas.set(r.payload.sha, { sha: r.payload.sha, merge: !!r.payload.merge, runs: 0, red: 0 });
    const push = pr.shas.get(r.payload.sha);
    push.runs += 1;
    if (RED.includes(r.payload.result)) push.red += 1;
  }
  const out = [];
  for (const pr of prs.values()) {
    const pushes = [...pr.shas.values()];
    let rounds = 0;
    let afterRed = true;
    for (const p of pushes) {
      if (afterRed && !(p.merge && rounds > 0)) rounds += 1;
      afterRed = p.red > 0;
    }
    out.push({
      repo: pr.repo, pr: pr.pr, item: pr.item, labels: pr.labels,
      pushes: pushes.length, redPushes: pushes.filter((p) => p.red > 0).length,
      redRuns: pushes.reduce((n, p) => n + p.red, 0), rounds, replans: 0, inputs: pr.inputs,
      shas: pushes.map(({ sha, merge, runs, red }) => ({ sha, merge, runs, red })),
    });
  }
  // A replan of an item is a PR labelled replan that names that item; it counts against every other PR of the item.
  for (const pr of out) {
    if (!pr.item) continue;
    pr.replans = out.filter((o) => o !== pr && o.item === pr.item && o.labels.includes('replan')).length;
  }
  return { prs: out.sort((a, b) => a.repo.localeCompare(b.repo) || a.pr - b.pr) };
}

/**
 * The tripwire rows to append: one { pr, rounds, limit } for each PR whose rounds exceed its limit, unless `rows`
 * already hold a tripwire for that PR and limit. `limitOf(pr)` gives a PR's limit (its item's), else DEFAULT_LIMIT.
 * `envelope` gives each new row's session, release and source.
 */
export function tripwires(view, rows, envelope, { limitOf = () => DEFAULT_LIMIT } = {}) {
  const fired = new Set(rows.filter((r) => r?.kind === 'tripwire').map((r) => `${r.payload.repo}#${r.payload.pr} ${r.payload.limit}`));
  const out = [];
  for (const pr of view.prs) {
    const limit = limitOf(pr) ?? DEFAULT_LIMIT;
    const key = `${pr.repo}#${pr.pr} ${limit}`;
    if (pr.rounds <= limit || fired.has(key)) continue;
    fired.add(key);
    out.push({
      ...envelope,
      kind: 'tripwire',
      item: pr.item,
      source: { system: 'github', ref: `${pr.repo}#${pr.pr}` },
      payload: { repo: pr.repo, pr: pr.pr, rounds: pr.rounds, limit, item: pr.item, inputs: pr.inputs },
    });
  }
  return out;
}
