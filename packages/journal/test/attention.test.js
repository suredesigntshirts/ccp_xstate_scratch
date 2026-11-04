// The attention view (plan item obs-person-attention): counts, card waits and the hourly caps, from rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { append } from '../src/index.js';
import { CAPS, attention, attentionOf } from '../src/derive/attention.js';

let n = 0;
const row = (kind, at, payload) => ({ v: 1, id: `r${++n}`, at, kind, source: { system: 'hearth', ref: payload.cardId ?? payload.messageId ?? `x${n}` }, session: 's', release: '0.1.3', payload });
const card = (at, cardId, thread = 't1') => row('card.posted', at, { thread, cardId, card: 'decision' });
const tap = (sentAt, cardId, thread = 't1') => row('person.tap', '2026-10-30T23:59:59.000Z', { thread, cardId, option: 'A', optionIndex: 0, sentAt });
const post = (at, thread = 't1') => row('post.sent', at, { thread, messageId: `m${n}` });
const message = (sentAt, messageId, thread = 't1') => row('person.message', sentAt, { thread, messageId, sentAt });

test('wait: a card waits from its post to its tap', () => {
  const view = attention([card('2026-10-30T16:29:24.000Z', 'c1'), tap('2026-10-30T16:54:27Z', 'c1')]);
  assert.equal(view.cards[0].waitMs, (25 * 60 + 3) * 1000);
  assert.deepEqual(view.threads.t1.waits, { count: 1, totalMs: 1503000, maxMs: 1503000 });
  assert.deepEqual(view.days['2026-10-30'].waits, { count: 1, totalMs: 1503000, maxMs: 1503000 });
});

test('wait: an untapped card is open with no wait, and a tap on an unseen card is listed with no post time', () => {
  const view = attention([card('2026-10-30T10:00:00.000Z', 'c1'), tap('2026-10-30T11:00:00Z', 'c2')]);
  const byId = Object.fromEntries(view.cards.map((c) => [c.cardId, c]));
  assert.equal(byId.c1.waitMs, null);
  assert.equal(byId.c2.postedAt, null);
  assert.equal(view.threads.t1.open, 1);
  assert.equal(view.threads.t1.waits.count, 0);
});

test('caps: an hour with more than 20 posts in one thread is flagged, 20 is not', () => {
  const at = (i) => `2026-10-30T12:${String(i).padStart(2, '0')}:00.000Z`;
  const twenty = Array.from({ length: CAPS.thread }, (_, i) => post(at(i)));
  assert.deepEqual(attention(twenty).flags, []);
  const view = attention([...twenty, card(at(40), 'c9')]);
  assert.deepEqual(view.flags, [{ scope: 'thread', thread: 't1', hour: '2026-10-30T12', posts: 21, cap: 20 }]);
  // The next hour starts again from zero.
  assert.deepEqual(attention([...twenty, post('2026-10-30T13:00:00.000Z')]).flags, []);
});

test('caps: more than 60 posts across threads in an hour flags the project, not any one thread', () => {
  const rows = Array.from({ length: 61 }, (_, i) => post(`2026-10-30T09:${String(i % 60).padStart(2, '0')}:00.000Z`, `t${i % 4}`));
  assert.deepEqual(attention(rows).flags, [{ scope: 'project', hour: '2026-10-30T09', posts: 61, cap: 60 }]);
});

test('counts: per day and per thread, and a message seen on two wakes counts once', () => {
  const rows = [message('2026-10-30T08:00:00Z', 'm1'), message('2026-10-30T08:00:00Z', 'm1'), message('2026-10-31T01:00:00Z', 'm2', 't2'),
    post('2026-10-30T08:01:00.000Z'), card('2026-10-30T08:02:00.000Z', 'c1'), tap('2026-10-31T00:30:00Z', 'c1')];
  const view = attention([...rows, rows[0]]);
  assert.deepEqual(view.threads.t1, { messages: 1, taps: 1, cards: 1, posts: 1, open: 0, waits: { count: 1, totalMs: 59280000, maxMs: 59280000 } });
  assert.equal(view.days['2026-10-30'].messages, 1);
  assert.equal(view.days['2026-10-31'].messages, 1);
  assert.equal(view.days['2026-10-31'].taps, 1);
});

test('attentionOf reads every journal file under a root', () => {
  const root = mkdtempSync(join(tmpdir(), 'attention-'));
  mkdirSync(join(root, 'sessions'));
  const { v, id, ...first } = card('2026-10-30T16:29:24.000Z', 'c1');
  append(join(root, 'sessions', 'a.jsonl'), first);
  const { v: v2, id: id2, ...second } = tap('2026-10-30T16:54:27Z', 'c1');
  append(join(root, 'sessions', 'b.jsonl'), second);
  const view = attentionOf(root);
  assert.equal(view.bad, 0);
  assert.equal(view.cards[0].waitMs, 1503000);
});
