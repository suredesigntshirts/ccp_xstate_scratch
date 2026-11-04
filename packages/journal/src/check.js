// The journal check (plan item obs-journal-vs-world): compares the journal with facts from outside it, a session's
// own event log and GitHub's merged PRs, and lists what doesn't match. It reads what it is given and writes nothing;
// bin/journal-check.js fetches, prints and records the check row. docs/journal.md, "The journal check", says how.

// A tool_result that Claude Code wrote without running the tool (a blocked or malformed call). No hook fires for
// these, so no capture can journal them (seen 2026-10-30, verify/obs-live-capture: "Blocked: standalone sleep").
const NOT_RUN = /^\s*<tool_use_error>/;

const textOf = (content) =>
  typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n') : '';

// The message inside one event, for both shapes: a Claude Code transcript line ({ type, message, timestamp }) and a
// list_events event ({ created_at, assistant|user: { internal_anthropic_catchall: { message, timestamp } } }).
function unwrap(event) {
  for (const role of ['assistant', 'user']) {
    const inner = event?.[role]?.internal_anthropic_catchall ?? event?.[role];
    if (inner?.message) return { message: inner.message, at: inner.timestamp ?? event.created_at ?? null, meta: inner };
  }
  if (event?.message) return { message: event.message, at: event.timestamp ?? null, meta: event };
  return null;
}

/**
 * The events in a text: JSONL of transcript lines or list_events events, or JSON of one list_events page
 * ({ data } or { ccr: { data } }), an array of pages, or an array of events. Unreadable lines are counted.
 */
export function parseEvents(text) {
  const out = { events: [], bad: 0 };
  const take = (value) => {
    if (Array.isArray(value)) return value.forEach(take);
    const page = value?.ccr ?? value;
    if (Array.isArray(page?.data)) return page.data.forEach(take);
    if (value && typeof value === 'object') out.events.push(value);
  };
  const trimmed = text.trim();
  if (!trimmed) return out;
  try {
    take(JSON.parse(trimmed));
    return out;
  } catch {
    // Not one JSON value: read it as JSONL.
  }
  for (const line of trimmed.split('\n')) {
    if (!line.trim()) continue;
    try {
      take(JSON.parse(line));
    } catch {
      out.bad++;
    }
  }
  return out;
}

/**
 * Every tool call an event log shows, keyed by tool use id: { id, tool, at, result } where result is 'ran' (a
 * tool_result came back from running it), 'not-run' (Claude Code answered without running it) or 'pending' (no
 * result yet, such as the call running this check).
 */
export function toolUses(events) {
  const calls = new Map();
  const results = new Map();
  for (const event of events) {
    const got = unwrap(event);
    const content = got?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && typeof block.id === 'string' && !calls.has(block.id)) {
        calls.set(block.id, { id: block.id, tool: block.name ?? null, at: got.at });
      } else if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        results.set(block.tool_use_id, NOT_RUN.test(textOf(block.content)) ? 'not-run' : 'ran');
      }
    }
  }
  for (const call of calls.values()) call.result = results.get(call.id) ?? 'pending';
  return calls;
}

const time = (at) => (at ? Date.parse(at) : NaN);

/**
 * The session diff. `rows` are the session's journal rows, `events` its event log. Returns the calls that ran with
 * no tool.call row (missing), the calls no hook could see (notRun) or that hadn't finished (pending), and the
 * tool.call rows inside the log's time span whose tool use id the log doesn't have (unfound). Rows outside the span
 * are counted, not judged: a paged log may not reach them.
 */
export function checkSession({ rows, events, slackMs = 5000 }) {
  const calls = toolUses(events);
  const toolRows = rows.filter((r) => r.kind === 'tool.call');
  const journalled = new Set(toolRows.map((r) => r.source.ref));
  const times = [...calls.values()].map((c) => time(c.at)).filter(Number.isFinite);
  const from = times.length ? Math.min(...times) - slackMs : -Infinity;
  const to = times.length ? Math.max(...times) + slackMs : Infinity;
  const missing = [], notRun = [], pending = [];
  for (const call of calls.values()) {
    if (journalled.has(call.id)) continue;
    (call.result === 'ran' ? missing : call.result === 'not-run' ? notRun : pending).push(call);
  }
  const unfound = [];
  let outside = 0;
  for (const row of toolRows) {
    if (calls.has(row.source.ref)) continue;
    const at = time(row.at);
    if (at < from || at > to) outside++;
    else unfound.push({ id: row.id, ref: row.source.ref, tool: row.payload?.tool ?? null, at: row.at });
  }
  return { calls: calls.size, rows: toolRows.length, missing, notRun, pending, unfound, outside };
}

/** A PR as the check uses it, from a GitHub REST pull request object. */
export const prOf = (repo, pr) => ({
  repo,
  number: pr.number,
  title: pr.title ?? null,
  mergedAt: pr.merged_at ?? null,
  head: pr.head?.sha ?? null,
  sha: pr.merge_commit_sha ?? null,
  url: pr.html_url ?? null,
});

/** The pr.merge rows' key: owner/repo#number. */
export const mergeKey = (repo, number) => `${String(repo).toLowerCase()}#${number}`;

/**
 * The host's merge effects that ended done, as merge rows: { id, at, repo, number, sha }. These are the only merges
 * the host made (plan item engine-effects, packages/engine/src/effects/merge.js).
 */
export const hostMerges = (rows) =>
  rows
    .filter((r) => r.kind === 'engine.effect' && r.payload?.actor === 'merge' && r.payload?.phase === 'done' && r.payload?.outcome?.repo)
    .map((r) => ({ id: r.id, at: r.at, repo: r.payload.outcome.repo, number: r.payload.outcome.number, sha: r.payload.outcome.sha ?? null, item: r.item }));

/**
 * The merge diff. `prs` are the closed PRs GitHub returned for `repos`, as prOf() makes them; `rows` the journal
 * rows. A merge is explained by a pr.merge row or a host merge effect naming its repo and number. Returns the merges
 * since `since` with neither (unexplained), the merges the host's merge effect didn't make, whatever else journalled
 * them (outsideHost, case C-merge-outside-host-detected), and the rows since `since` for those repos that GitHub
 * doesn't show as merged, or shows merged at another sha (unfound).
 */
export function checkMerges({ rows, prs, repos, since = null }) {
  const after = (at) => !since || time(at) >= time(since);
  const watched = new Set(repos.map((r) => r.toLowerCase()));
  const mine = (repo) => watched.has(String(repo).toLowerCase());
  const mergeRows = rows
    .filter((r) => r.kind === 'pr.merge' && mine(r.payload?.repo))
    .map((r) => ({ id: r.id, at: r.at, repo: r.payload.repo, number: r.payload.number, sha: r.payload.sha ?? null }));
  const hostRows = hostMerges(rows).filter((r) => mine(r.repo));
  const keys = (list) => new Set(list.map((r) => mergeKey(r.repo, r.number)));
  const byHost = keys(hostRows);
  const byAny = new Set([...keys(mergeRows), ...byHost]);
  const merged = prs.filter((p) => p.mergedAt && after(p.mergedAt));
  const unexplained = merged.filter((p) => !byAny.has(mergeKey(p.repo, p.number)));
  const outsideHost = merged.filter((p) => !byHost.has(mergeKey(p.repo, p.number)));
  const onGitHub = new Map(prs.filter((p) => p.mergedAt).map((p) => [mergeKey(p.repo, p.number), p]));
  const unfound = [];
  for (const row of [...mergeRows, ...hostRows]) {
    if (!after(row.at)) continue;
    const pr = onGitHub.get(mergeKey(row.repo, row.number));
    const ref = `${row.repo}#${row.number}`;
    if (!pr) unfound.push({ id: row.id, ref, at: row.at, why: 'GitHub shows no merge of this PR' });
    else if (row.sha && pr.sha && row.sha !== pr.sha) {
      unfound.push({ id: row.id, ref, at: row.at, why: `GitHub merged it as ${pr.sha}, the row says ${row.sha}` });
    }
  }
  return { merges: merged.length, rows: mergeRows.length, hostRows: hostRows.length, unexplained, outsideHost, unfound };
}

/** The counts a journal.check row carries. */
export function counts({ session, merges }) {
  return {
    ...(session && {
      calls: session.calls,
      callRows: session.rows,
      missing: session.missing.length,
      notRun: session.notRun.length,
      pending: session.pending.length,
      unfoundCalls: session.unfound.length,
      outside: session.outside,
    }),
    ...(merges && {
      merges: merges.merges,
      mergeRows: merges.rows,
      hostMerges: merges.hostRows,
      unexplained: merges.unexplained.length,
      outsideHost: merges.outsideHost.length,
      unfoundMerges: merges.unfound.length,
    }),
  };
}

/**
 * True when the check found nothing missing or unexplained. Calls no hook could see don't count against it. With
 * host, a merge the host's merge effect didn't make counts against it too.
 */
export const clean = ({ session, merges, bad = [], host = false }) =>
  !bad.length && !session?.missing.length && !session?.unfound.length && !merges?.unexplained.length && !merges?.unfound.length &&
  !(host && merges?.outsideHost.length);

/** The report as plain lines. */
export function report({ session, merges, bad = [] }) {
  const out = [];
  if (session) {
    out.push(`Session: ${session.calls} tool calls in the event log, ${session.rows} tool.call rows in the journal.`);
    out.push(`  ${session.missing.length} missing from the journal${session.missing.length ? ':' : '.'}`);
    for (const c of session.missing) out.push(`    ${c.id}  ${c.tool}  ${c.at ?? ''}`);
    out.push(`  ${session.unfound.length} rows whose call the event log doesn't have${session.unfound.length ? ':' : '.'}`);
    for (const r of session.unfound) out.push(`    row ${r.id}  ${r.ref}  ${r.tool}  ${r.at}`);
    if (session.notRun.length) {
      out.push(`  ${session.notRun.length} calls Claude Code answered without running, which no hook sees (not counted):`);
      for (const c of session.notRun) out.push(`    ${c.id}  ${c.tool}`);
    }
    if (session.pending.length) out.push(`  ${session.pending.length} calls with no result yet (not counted): ${session.pending.map((c) => c.id).join(', ')}`);
    if (session.outside) out.push(`  ${session.outside} tool.call rows fall outside the event log's time span (not judged).`);
  }
  if (merges) {
    const line = (p) => `    ${p.repo}#${p.number}  merged ${p.mergedAt}  head ${p.head}  merge ${p.sha}  ${p.title ?? ''}`;
    out.push(`GitHub: ${merges.merges} merged PRs, ${merges.rows} pr.merge rows, ${merges.hostRows} host merge effects.`);
    out.push(`  ${merges.unexplained.length} merges with no journal row${merges.unexplained.length ? ':' : '.'}`);
    for (const p of merges.unexplained) out.push(line(p));
    out.push(`  ${merges.outsideHost.length} merges not made by the host's merge effect (unverified)${merges.outsideHost.length ? ':' : '.'}`);
    for (const p of merges.outsideHost) out.push(line(p));
    out.push(`  ${merges.unfound.length} pr.merge rows GitHub doesn't bear out${merges.unfound.length ? ':' : '.'}`);
    for (const r of merges.unfound) out.push(`    row ${r.id}  ${r.ref}  ${r.why}`);
  }
  if (bad.length) {
    out.push(`${bad.length} journal lines couldn't be read:`);
    for (const b of bad) out.push(`    ${b.path}:${b.line}  ${b.reason}`);
  }
  return out;
}
