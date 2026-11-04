// C-older-writer-refused (plan/cases/work-item.md): a journal last written by release N; a session on release N-1 that
// tries to write is refused, naming both versions. The item is started by bin/host.js on 0.3.0, then a hook on 0.2.0
// hands the owner's host a wake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { A, ISSUE, checkWake, fresh, gitRepo, hostCli, offer, open, rows } from './world.js';

const hook = (session, prompt) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: session, prompt });

test('C-older-writer-refused: a host on an older release is refused writing to the item, naming both releases, and writes nothing', async () => {
  const root = fresh();
  const started = await hostCli(root, ['start', '--session', 'owner', '--input', JSON.stringify({ issue: ISSUE }), '--repo', gitRepo(), '--worktrees', join(root, 'wt')], { release: '0.3.0' });
  assert.equal(started.status, 0, started.stderr);
  const before = rows(root).length;

  const older = await hostCli(root, ['wake'], { release: '0.2.0', input: hook('owner', checkWake({ head: A })) });
  assert.equal(older.status, 2);
  assert.match(older.stderr, /release 0\.2\.0 is older than release 0\.3\.0/);
  assert.equal(rows(root).length, before, 'no row was added');

  // In process too: the journal's append refuses the older host's first row.
  const host = open(root, { release: '0.2.0' });
  await assert.rejects(offer(host, [{ event: { type: 'pr.pushed', headSha: A }, source: { system: 'github', ref: 'p1' } }], {}),
    (error) => error.name === 'OlderWriterError' && error.writer === '0.2.0' && error.newest === '0.3.0');
  assert.equal(rows(root).length, before);
});

test('C-older-writer-refused: the same or a newer release writes (the control)', async () => {
  const root = fresh();
  await hostCli(root, ['start', '--session', 'owner', '--input', JSON.stringify({ issue: ISSUE }), '--repo', gitRepo(), '--worktrees', join(root, 'wt')], { release: '0.3.0' });
  const before = rows(root).length;
  for (const [release, ref] of [['0.3.0', 'p1'], ['0.3.1', 'p2']]) {
    await offer(open(root, { release }), [{ event: { type: 'pr.pushed', headSha: A }, source: { system: 'github', ref } }], {});
  }
  assert.deepEqual(rows(root).slice(before).map((r) => r.release), ['0.3.0', '0.3.1']);
});
