// The time view (plan item obs-time-and-rework): where one session's wall-clock time went. Time is working while a
// turn, a tool call, a hook or a subagent is in progress; every other stretch is waiting, labelled by the wake that ended it
// (on the person, on CI, on another wake), or rebuild for the start-up between a new SessionStart and that wake, or
// unknown when no wake with a reason ends it. A gap is never counted as working. It reads rows and writes nothing.
// docs/journal.md, "Derived views", says what each part reads.

/** Which waiting kind a wake reason means. A reason not listed here is a `wake`; a wake with no reason is unknown. */
export const WAIT_KINDS = Object.freeze({
  mention: 'person',
  'decision-chosen': 'person',
  prompt: 'person',
  'external-event': 'ci',
});

const ms = (iso) => Date.parse(iso);
const iso = (t) => new Date(t).toISOString();

/**
 * The time view over `rows` (any order, any mix of sessions and kinds). Returns { sessions, totals }: sessions maps
 * each session id to { from, to, wallMs, workingMs, waitingMs: { person, ci, wake, rebuild }, unknownMs, gaps }, and
 * totals sums them. Each gap is { from, to, ms, label, reason, inputs }, inputs naming the row ids it was labelled
 * from. For every session, workingMs + each waitingMs + unknownMs equals wallMs.
 */
export function time(rows, { waitKinds = WAIT_KINDS } = {}) {
  const seen = new Set();
  const bySession = new Map();
  for (const r of rows) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    if (!bySession.has(r.session)) bySession.set(r.session, []);
    bySession.get(r.session).push(r);
  }
  const sessions = {};
  for (const [id, list] of bySession) sessions[id] = sessionTime(list.sort((a, b) => a.at.localeCompare(b.at)), waitKinds);
  const totals = { wallMs: 0, workingMs: 0, waitingMs: { person: 0, ci: 0, wake: 0, rebuild: 0 }, unknownMs: 0 };
  for (const s of Object.values(sessions)) {
    totals.wallMs += s.wallMs;
    totals.workingMs += s.workingMs;
    totals.unknownMs += s.unknownMs;
    for (const k of Object.keys(totals.waitingMs)) totals.waitingMs[k] += s.waitingMs[k];
  }
  return { sessions, totals };
}

function sessionTime(rows, waitKinds) {
  const from = ms(rows[0].at);
  const to = ms(rows.at(-1).at);
  const busy = [];
  const clip = (a, b) => [Math.max(from, a), Math.min(to, b)];

  // Turns: a main-session wake to the Stop row after it. A turn with no Stop before the next wake ends at its last row.
  const main = rows.filter((r) => !r.agent);
  const unclosed = [];
  for (let i = 0; i < main.length; i++) {
    if (main[i].kind !== 'wake') continue;
    let last = main[i];
    let closed = false;
    for (let j = i + 1; j < main.length && main[j].kind !== 'wake'; j++) {
      last = main[j];
      if (main[j].kind === 'turn.usage') { closed = true; break; }
    }
    busy.push(clip(ms(main[i].at), ms(last.at)));
    if (!closed) unclosed.push(ms(last.at));
  }
  // Tool calls and hook runs: their own duration, ending at the row.
  for (const r of rows) {
    if ((r.kind === 'tool.call' || r.kind === 'hook.run') && Number.isFinite(r.payload?.ms)) busy.push(clip(ms(r.at) - r.payload.ms, ms(r.at)));
  }
  // Subagents: spawn to finish, or to the agent's last row when no finish was seen.
  const spawns = new Map();
  for (const r of rows) {
    const agentId = r.payload?.agentId ?? r.agent;
    if (r.kind === 'agent.spawn') spawns.set(agentId, { start: ms(r.at), end: ms(r.at) });
    else if (agentId && spawns.has(agentId)) spawns.get(agentId).end = ms(r.at);
  }
  for (const { start, end } of spawns.values()) busy.push(clip(start, end));

  const merged = [];
  for (const [a, b] of busy.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const lastSpan = merged.at(-1);
    if (lastSpan && a <= lastSpan[1]) lastSpan[1] = Math.max(lastSpan[1], b);
    else merged.push([a, b]);
  }
  const workingMs = merged.reduce((sum, [a, b]) => sum + b - a, 0);

  const gaps = [];
  let cursor = from;
  for (const [a, b] of [...merged, [to, to]]) {
    if (a > cursor) gaps.push(...labelGap(cursor, a, b, rows, main, unclosed, waitKinds));
    cursor = Math.max(cursor, b);
  }
  const waitingMs = { person: 0, ci: 0, wake: 0, rebuild: 0 };
  let unknownMs = 0;
  for (const g of gaps) {
    if (g.label === 'unknown') unknownMs += g.ms;
    else waitingMs[g.label] += g.ms;
  }
  return { from: iso(from), to: iso(to), wallMs: to - from, workingMs, waitingMs, unknownMs, gaps };
}

// A gap ends where the next busy span starts. If a main-session wake with a reason is in that span (the capture
// hook that writes the wake row starts just before it), the gap waited on it;
// a SessionStart inside the gap splits off its tail as rebuild. A gap after a turn that never closed, or one no
// wake ends, is unknown.
function labelGap(a, b, spanEnd, rows, main, unclosed, waitKinds) {
  const gap = (from, to, label, reason, inputs) => ({ from: iso(from), to: iso(to), ms: to - from, label, reason, inputs });
  const wake = main.find((r) => r.kind === 'wake' && ms(r.at) >= b && ms(r.at) <= spanEnd);
  if (!wake) return [gap(a, b, 'unknown', 'no wake ends this gap', [])];
  if (unclosed.includes(a)) return [gap(a, b, 'unknown', 'the turn before it never closed', [wake.id])];
  const reason = wake.payload?.reason;
  if (!reason) return [gap(a, b, 'unknown', 'the wake has no reason', [wake.id])];
  const label = waitKinds[reason] ?? 'wake';
  const start = rows.filter((r) => r.kind === 'session.fingerprint' && ms(r.at) >= a && ms(r.at) < b).at(-1);
  if (!start) return [gap(a, b, label, reason, [wake.id])];
  return [
    gap(a, ms(start.at), label, reason, [wake.id]),
    gap(ms(start.at), b, 'rebuild', start.payload?.start ?? null, [start.id, wake.id]),
  ].filter((g) => g.ms > 0);
}
