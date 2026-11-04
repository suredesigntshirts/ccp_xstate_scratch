// The observe page's data layer (plan item obs-page): for a day, a thread or a session, where the tokens went, where
// the time went, what was refused and why, and what was asked of the person, from journal rows. It reads rows and
// writes nothing but the page.refresh row it hands back. The page bundles this file with the derived views it uses
// (build.mjs), so the page and the tests run the same code. docs/journal.md, "The observe page", says what it shows.
import { time } from '../../../../packages/journal/src/derive/time.js';
import { attention } from '../../../../packages/journal/src/derive/attention.js';

const DAY = 10; // 'YYYY-MM-DD'

/** The rows of one journal file's text, and every line it couldn't use with its line number and reason. */
export function parseJournal(text, file = null) {
  const rows = [];
  const bad = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const row = JSON.parse(line);
      if (!row || typeof row.id !== 'string' || typeof row.at !== 'string' || typeof row.kind !== 'string') throw new Error('not a row');
      rows.push(row);
    } catch (err) {
      bad.push({ file, line: i + 1, reason: err.message });
    }
  });
  return { rows, bad };
}

// A session's thread is the thread its person, card and post rows name. A session in no thread has none.
const threadsOf = (rows) => {
  const out = new Map();
  for (const r of rows) {
    const t = r.payload?.thread;
    if (t && ['person.message', 'person.tap', 'card.posted', 'post.sent'].includes(r.kind)) {
      if (!out.has(r.session)) out.set(r.session, new Set());
      out.get(r.session).add(t);
    }
  }
  return out;
};

/** What the page can be scoped to: the UTC days, threads, sessions and items the rows hold, newest first. */
export function scopes(rows) {
  const days = new Set();
  const sessions = new Set();
  for (const r of rows) {
    days.add(r.at.slice(0, DAY));
    sessions.add(r.session);
  }
  const threads = new Set([...threadsOf(rows).values()].flatMap((s) => [...s]));
  const desc = (set) => [...set].sort().reverse();
  return { days: desc(days), threads: desc(threads), sessions: desc(sessions), items: items(rows) };
}

/**
 * The rows in `scope`: { day } keeps rows written that UTC day; { thread } keeps every row of the sessions working that
 * thread; { session } keeps one session's rows; { item } keeps an item's rows, its agents' rows and the main-session rows
 * of the sessions that applied its events; {} keeps all. A row read twice (the same id) is kept once.
 */
export function inScope(rows, scope = {}) {
  const seen = new Set();
  const unique = rows.filter((r) => r && !seen.has(r.id) && seen.add(r.id));
  if (scope.day) return unique.filter((r) => r.at.slice(0, DAY) === scope.day);
  if (scope.thread) {
    const map = threadsOf(unique);
    return unique.filter((r) => map.get(r.session)?.has(scope.thread));
  }
  if (scope.session) return unique.filter((r) => r.session === scope.session);
  if (scope.item) {
    // The item's own rows, its agents' rows and the rows of the sessions that applied its events.
    const own = unique.filter((r) => r.item === scope.item);
    const agents = new Set(own.filter((r) => r.kind === 'agent.spawn').map((r) => r.payload?.agentId ?? r.agent));
    const sessions = new Set(own.filter((r) => r.kind === 'engine.transition').map((r) => r.session));
    return unique.filter((r) => r.item === scope.item || (r.agent && agents.has(r.agent)) || (!r.item && sessions.has(r.session) && !r.agent));
  }
  return unique;
}

const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheCreation'];
const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 });
const add = (into, t) => {
  for (const f of TOKEN_FIELDS) into[f] += t?.[f] ?? 0;
  into.total = TOKEN_FIELDS.reduce((s, f) => s + into[f], 0);
  return into;
};

/**
 * The token rows: every `turn.usage`, and each subagent's last `agent.finish` (by time), whose tokens are cumulative.
 */
export function lastFinishes(rows) {
  const last = new Map();
  for (const r of rows) {
    if (r?.kind !== 'agent.finish') continue;
    const key = `${r.session} ${r.payload?.agentId ?? r.agent ?? 'unknown'}`;
    if (!last.has(key) || r.at >= last.get(key).at) last.set(key, r);
  }
  const kept = new Set(last.values());
  return rows.filter((r) => r?.kind === 'turn.usage' || kept.has(r));
}

/**
 * Tokens by agent: the main session's turns (`turn.usage`, agent null) and each subagent (`agent.finish`), the same
 * rows overhead.js counts. Returns { total, agents: [{ session, agent, type, rows, ...tokens }] }, biggest first.
 * An agent's `agent.finish` tokens cover its whole transcript, so one that finished twice counts its last row, not
 * the sum (retro finding 3, plan item engine-item-views).
 */
export function tokensByAgent(rows) {
  const agents = new Map();
  for (const r of lastFinishes(rows)) {
    const agent = r.kind === 'agent.finish' ? (r.payload?.agentId ?? r.agent ?? 'unknown') : null;
    const key = `${r.session} ${agent ?? 'main'}`;
    if (!agents.has(key)) agents.set(key, { session: r.session, agent, type: agent ? (r.payload?.type ?? null) : 'main', rows: 0, ...zero() });
    const a = agents.get(key);
    a.rows += 1;
    add(a, r.payload?.tokens);
  }
  const list = [...agents.values()].sort((a, b) => b.total - a.total);
  return { total: list.reduce((t, a) => add(t, a), zero()), agents: list };
}

/** Time by kind: the time view's totals (working, waiting on the person, CI, a wake, a rebuild, and unknown). */
export function timeByKind(rows) {
  const { totals } = time(rows);
  return { wallMs: totals.wallMs, workingMs: totals.workingMs, ...totals.waitingMs, unknownMs: totals.unknownMs };
}

/**
 * What was refused: each `refusal` row with its rule, and whether it was retried (a later refusal or tool.call names
 * it in `retryOf`), plus counts by rule. Newest first.
 */
export function refusals(rows) {
  const refusedAgain = new Set(rows.filter((r) => r.kind === 'refusal' && r.payload?.retryOf).map((r) => r.payload.retryOf));
  const ran = new Map(rows.filter((r) => r.kind === 'tool.call' && r.payload?.retryOf).map((r) => [r.payload.retryOf, r.payload.ok]));
  const list = rows.filter((r) => r.kind === 'refusal').map((r) => ({
    id: r.id, at: r.at, session: r.session, agent: r.agent ?? null,
    source: r.payload?.source ?? null, rule: r.payload?.rule ?? null, tool: r.payload?.tool ?? null,
    then: refusedAgain.has(r.id) ? 'refused again' : ran.has(r.id) ? (ran.get(r.id) ? 'retried, ran' : 'retried, failed') : 'not retried',
  })).sort((a, b) => b.at.localeCompare(a.at));
  const byRule = {};
  for (const r of list) byRule[r.rule ?? 'unknown'] = (byRule[r.rule ?? 'unknown'] ?? 0) + 1;
  return { count: list.length, byRule, list };
}

/**
 * What was asked of the person: the attention view's totals over the scope (their messages and taps, the cards and
 * posts put in front of them, open cards, card waits), each card, and the hours over the platform's caps.
 */
export function asks(rows) {
  const view = attention(rows);
  const totals = { messages: 0, taps: 0, cards: 0, posts: 0, open: 0, waits: { count: 0, totalMs: 0, maxMs: 0 } };
  for (const d of Object.values(view.days)) {
    for (const k of ['messages', 'taps', 'cards', 'posts', 'open']) totals[k] += d[k];
    totals.waits.count += d.waits.count;
    totals.waits.totalMs += d.waits.totalMs;
    totals.waits.maxMs = Math.max(totals.waits.maxMs, d.waits.maxMs);
  }
  return { ...totals, list: view.cards, flags: view.flags };
}

const parseState = (s) => {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s ?? null;
  } catch {
    return s;
  }
};
const lastOf = (list, f) => list.reduce((got, x) => f(x) ?? got, null);

/** The items the rows name (engine.transition rows of an item), newest first by their last row. */
export function items(rows) {
  const at = new Map();
  for (const r of rows) if (r?.item && r.kind === 'engine.transition' && !(at.get(r.item) > r.at)) at.set(r.item, r.at);
  return [...at.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([item]) => item);
}

/**
 * One item (plan item engine-item-views): its workflow and current state, the handles its events carried (issue, PR,
 * verdict, merge), its build rounds, its tokens and its person asks, from every journal file, not only the item's.
 * An item's work spans sessions: its actors' agents finish in the driver's session file, and its card is posted and
 * tapped in the thread that owns it (retro finding 2). So the agents are the ones its agent.spawn rows bound, wherever
 * their agent.finish rows are, each counted once at its last row (finding 3); the sessions that applied its events
 * add their turns; and each ask's card is joined by its id to the card.posted and person.tap rows of any session.
 * `now` ends an open card's wait.
 */
export function itemView(rows, item, { now = null } = {}) {
  const seen = new Set();
  const all = rows.filter((r) => r && !seen.has(r.id) && seen.add(r.id));
  const own = all.filter((r) => r.item === item).sort((a, b) => a.at.localeCompare(b.at));
  const transitions = own.filter((r) => r.kind === 'engine.transition' && r.payload?.outcome === 'applied')
    .sort((a, b) => (a.payload.seq ?? 0) - (b.payload.seq ?? 0));
  if (!own.length) return null;
  const events = transitions.map((t) => t.payload.event ?? {});
  const outputs = (type) => events.filter((e) => e.type === type).map((e) => e.output);
  const handles = {
    issue: events.find((e) => e.type === 'xstate.init')?.input?.issue?.url ?? null,
    pr: lastOf(outputs('xstate.done.actor.build'), (o) => o?.pr?.url ? { url: o.pr.url, headSha: o.pr.headSha ?? null } : null),
    verdict: lastOf(outputs('xstate.done.actor.verify'), (o) => o?.result ? { result: o.result, sha: o.sha ?? null } : null),
    merge: lastOf(outputs('xstate.done.actor.merge'), (o) => o?.sha ? { sha: o.sha } : null),
  };

  // Tokens: the item's agents (from its agent.spawn rows) at their last finish, and the turns of its sessions.
  const agentIds = new Set(own.filter((r) => r.kind === 'agent.spawn').map((r) => r.payload?.agentId ?? r.agent).filter(Boolean));
  const sessions = new Set(transitions.map((t) => t.session));
  const finishes = lastFinishes(all.filter((r) => r.kind === 'agent.finish' && agentIds.has(r.payload?.agentId ?? r.agent)));
  const turns = all.filter((r) => r.kind === 'turn.usage' && sessions.has(r.session));
  const tokens = { total: zero(), agents: zero(), sessions: zero(), agentCount: agentIds.size, finished: finishes.length, sessionIds: [...sessions] };
  for (const r of finishes) add(tokens.agents, r.payload?.tokens);
  for (const r of turns) add(tokens.sessions, r.payload?.tokens);
  add(add(tokens.total, tokens.agents), tokens.sessions);

  // Asks: each ask run's card, posted and answered wherever that happened.
  const cards = new Map(attention(all).cards.map((c) => [c.cardId, c]));
  const answers = new Map(transitions.filter((t) => t.payload.run && /^xstate\.done\.actor\./.test(t.payload.event?.type ?? '')).map((t) => [t.payload.run, t]));
  const end = now ?? all.reduce((m, r) => (r.at > m ? r.at : m), '');
  // An ask run starts when its state is entered; its card's id is on the run's done row once the host has seen the
  // card recorded. Until then the wait counts from the run's start.
  const askRows = own.filter((r) => r.kind === 'engine.effect' && r.payload?.actor === 'ask' && r.payload?.type === 'run');
  const asks = [...new Set(askRows.map((r) => r.payload.effect))]
    .map((effect) => {
      const mine = askRows.filter((r) => r.payload.effect === effect);
      const cardId = lastOf(mine, (r) => r.payload.outcome?.ref ?? null);
      const card = cardId ? cards.get(cardId) : null;
      const answer = answers.get(effect);
      const postedAt = card?.postedAt ?? (cardId ? mine.find((r) => r.payload.outcome?.ref)?.at : mine[0].at);
      const answeredAt = answer?.at ?? card?.tappedAt ?? null;
      return {
        effect, cardId, thread: card?.thread ?? null, postedAt, answeredAt,
        by: answer?.source?.system ?? (card?.tappedAt ? 'hearth' : null), choice: answer?.payload?.event?.output?.choice ?? card?.option ?? null,
        waitMs: Date.parse(answeredAt ?? end) - Date.parse(postedAt), open: !answeredAt,
      };
    });
  const last = transitions.at(-1);
  return {
    item,
    workflow: transitions[0]?.payload?.workflow ?? null,
    state: last ? parseState(last.state) : null,
    since: last?.at ?? null,
    firstAt: own[0].at,
    lastAt: own.at(-1).at,
    transitions: transitions.length,
    rounds: transitions.filter((t) => parseState(t.state) === 'building').length,
    handles,
    tokens,
    asks,
    personWaitMs: asks.reduce((s, a) => s + (Number.isFinite(a.waitMs) ? a.waitMs : 0), 0),
    refusals: own.filter((r) => r.kind === 'refusal').length,
  };
}

/** The newest row's time, and the releases that wrote the rows, newest first. */
export function freshness(rows) {
  const newestAt = rows.reduce((m, r) => (r.at > m ? r.at : m), '') || null;
  const byVersion = (a, b) => b.split('.').map(Number).reduce((d, n, i) => d || n - Number(a.split('.')[i]), 0);
  const releases = [...new Set(rows.map((r) => r.release).filter(Boolean))].sort(byVersion);
  return { newestAt, release: releases[0] ?? null, releases };
}

/** Everything the page shows for `scope`: { scope, rows, freshness, tokens, time, refusals, asks, item }. */
export function observe(rows, scope = {}) {
  const scoped = inScope(rows, scope);
  return {
    scope,
    rows: scoped.length,
    freshness: freshness(scoped),
    tokens: tokensByAgent(scoped),
    time: timeByKind(scoped),
    refusals: refusals(scoped),
    asks: asks(scoped),
    item: scope.item ? itemView(rows, scope.item) : null,
  };
}

/**
 * The page.refresh journal row for one refresh: `url` is the page, `ms` how long reading and deriving took, `rows`,
 * `files` and `bad` what it read, `newestAt` the newest row time, `release` the page's own build release, `scope` what
 * the page showed and `viewer` the viewer's opaque id. The row's session is `page-observe`: the page is its own writer.
 */
export function refreshRow({ id, at, url, ms, rows, files, bad, newestAt, release, scope = {}, viewer = null }) {
  return {
    v: 1, id, at, kind: 'page.refresh', session: 'page-observe', agent: null, item: 'obs-page', state: null,
    release, source: { system: 'artifact', ref: url ?? 'unpublished' },
    payload: { page: 'observe', ms, rows, files, bad, newestAt, scope, viewer },
  };
}
