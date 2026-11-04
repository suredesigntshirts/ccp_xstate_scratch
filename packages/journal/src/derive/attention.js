// The attention view (plan item obs-person-attention): what the harness asked of the person, from journal rows.
// Per UTC day and per thread it counts the person's messages and taps, the cards and posts put in front of them,
// and how long each card waited for its tap; and it flags any hour in which posts went over the platform's caps
// (ledger L-message-caps: about 20 per thread and 60 per project). It reads rows and writes nothing.
// docs/journal.md, "Person rows", says what each row holds.
import { readAll } from '../index.js';

/** The platform's hourly message caps (ledger L-message-caps). */
export const CAPS = Object.freeze({ thread: 20, project: 60 });

const HOUR = 13; // 'YYYY-MM-DDTHH'
const DAY = 10; // 'YYYY-MM-DD'

// When the person acted is the platform's sent-at on the wake; the row's own time is when the session read it.
const when = (row) => row.payload?.sentAt ?? row.at;

const empty = () => ({ messages: 0, taps: 0, cards: 0, posts: 0, open: 0, waits: { count: 0, totalMs: 0, maxMs: 0 } });

/**
 * The attention view over `rows` (any order, any mix of kinds and sessions). Returns
 * { days, threads, cards, hours, flags }: days and threads map a key to counts, cards lists each card with its post
 * time, tap and wait, hours lists posts per thread-hour and project-hour, and flags lists the hours over a cap.
 * A row read twice (the same id) counts once, and so does a message the journal saw on two wakes (the same id).
 */
export function attention(rows, { caps = CAPS } = {}) {
  const seen = new Set();
  const unique = rows.filter((r) => r && !seen.has(r.id) && seen.add(r.id));
  const days = {};
  const threads = {};
  const bump = (key, thread, field, by = 1) => {
    for (const [map, k] of [[days, key.slice(0, DAY)], [threads, thread ?? 'unknown']]) {
      map[k] ??= empty();
      map[k][field] += by;
    }
  };

  const messages = new Set();
  for (const r of unique.filter((r) => r.kind === 'person.message')) {
    const key = r.payload.messageId ? `${r.payload.thread} ${r.payload.messageId}` : r.id;
    if (messages.has(key)) continue;
    messages.add(key);
    bump(when(r), r.payload.thread, 'messages');
  }

  // Cards by id, then each tap joined to its card. A card the tap names that the journal never saw posted is listed
  // with postedAt null, so a gap in capture shows instead of vanishing.
  const cards = new Map();
  for (const r of unique.filter((r) => r.kind === 'card.posted').sort((a, b) => a.at.localeCompare(b.at))) {
    const id = r.payload.cardId ?? r.id;
    if (cards.has(id)) continue;
    cards.set(id, { cardId: id, thread: r.payload.thread ?? null, card: r.payload.card ?? null, postedAt: r.at, tappedAt: null, option: null, optionIndex: null, waitMs: null });
  }
  for (const r of unique.filter((r) => r.kind === 'person.tap').sort((a, b) => when(a).localeCompare(when(b)))) {
    const id = r.payload.cardId;
    const card = cards.get(id) ?? { cardId: id, thread: null, card: null, postedAt: null, tappedAt: null, option: null, optionIndex: null, waitMs: null };
    cards.set(id, card);
    if (card.tappedAt) continue; // a card closes on its first tap
    card.thread ??= r.payload.thread ?? null;
    card.tappedAt = when(r);
    card.option = r.payload.option ?? null;
    card.optionIndex = r.payload.optionIndex ?? null;
    if (card.postedAt) card.waitMs = Date.parse(card.tappedAt) - Date.parse(card.postedAt);
    bump(card.tappedAt, card.thread, 'taps');
  }
  for (const card of cards.values()) {
    if (!card.postedAt) continue;
    bump(card.postedAt, card.thread, 'cards');
    if (!card.tappedAt) bump(card.postedAt, card.thread, 'open');
    if (card.waitMs === null) continue;
    for (const map of [days[card.tappedAt.slice(0, DAY)], threads[card.thread ?? 'unknown']]) {
      map.waits.count += 1;
      map.waits.totalMs += card.waitMs;
      map.waits.maxMs = Math.max(map.waits.maxMs, card.waitMs);
    }
  }

  // Everything the session posted counts against the caps: plain posts and cards alike.
  const perThread = {};
  const perProject = {};
  const out = unique.filter((r) => r.kind === 'post.sent' || r.kind === 'card.posted');
  for (const r of out) {
    if (r.kind === 'post.sent') bump(r.at, r.payload.thread, 'posts');
    const hour = r.at.slice(0, HOUR);
    const thread = r.payload.thread ?? cards.get(r.payload.cardId)?.thread ?? 'unknown';
    perThread[`${thread} ${hour}`] = (perThread[`${thread} ${hour}`] ?? 0) + 1;
    perProject[hour] = (perProject[hour] ?? 0) + 1;
  }
  const hours = {
    thread: Object.entries(perThread).map(([k, posts]) => {
      const [thread, hour] = k.split(' ');
      return { thread, hour, posts, over: posts > caps.thread };
    }).sort((a, b) => a.hour.localeCompare(b.hour) || a.thread.localeCompare(b.thread)),
    project: Object.entries(perProject).map(([hour, posts]) => ({ hour, posts, over: posts > caps.project }))
      .sort((a, b) => a.hour.localeCompare(b.hour)),
  };
  const flags = [
    ...hours.thread.filter((h) => h.over).map((h) => ({ scope: 'thread', thread: h.thread, hour: h.hour, posts: h.posts, cap: caps.thread })),
    ...hours.project.filter((h) => h.over).map((h) => ({ scope: 'project', hour: h.hour, posts: h.posts, cap: caps.project })),
  ];
  const listed = [...cards.values()].sort((a, b) => (a.postedAt ?? a.tappedAt).localeCompare(b.postedAt ?? b.tappedAt));
  return { days, threads, cards: listed, hours, flags };
}

/** The attention view over every journal file under `root`. It lists folders, so it is for offline tools only. */
export function attentionOf(root, options) {
  const { rows, bad } = readAll(root);
  return { ...attention(rows, options), bad: bad.length };
}
