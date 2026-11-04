// The parity listing (plan item parity-cases): every case in plan/cases/ has a test here named by its id, or an entry
// in gaps.json naming the live plan item that will meet it, and never both. A case added to plan/cases/ fails this
// until it has one or the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = new URL('../../../../', import.meta.url).pathname;
const here = new URL('./', import.meta.url).pathname;
const LIVE = (status) => !['split', 'merged', 'dropped', 'parked', 'done'].includes(status);

/** The case ids in plan/cases/, as plan/check.mjs reads them: headings starting C-. */
export const caseIds = (root = repo) => readdirSync(join(root, 'plan', 'cases'))
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .flatMap((f) => [...readFileSync(join(root, 'plan', 'cases', f), 'utf8').matchAll(/^#+ (C-[a-z0-9-]+)/gm)].map((m) => m[1]));

/** The plan item's head, or null. */
const itemHead = (root, id) => {
  try {
    return JSON.parse(readFileSync(join(root, 'plan', 'items', `${id}.md`), 'utf8').match(/^```json\n([\s\S]*?)\n```/)[1]);
  } catch {
    return null;
  }
};

/** What is wrong with the parity folder `dir` against the plan at `root`: a list of problems, empty when it holds. */
export function problems({ root = repo, dir = here } = {}) {
  const ids = caseIds(root);
  const tests = new Set(readdirSync(dir).filter((f) => /^C-.*\.test\.js$/.test(f)).map((f) => f.replace(/\.test\.js$/, '')));
  const gaps = JSON.parse(readFileSync(join(dir, 'gaps.json'), 'utf8')).gaps;
  const gapIds = new Set(gaps.map((g) => g.case));
  const out = [];
  for (const id of ids) {
    if (tests.has(id) && gapIds.has(id)) out.push(`${id} has a test and a gaps.json entry; remove the entry`);
    if (!tests.has(id) && !gapIds.has(id)) out.push(`${id} has neither a test nor a gaps.json entry`);
  }
  for (const id of tests) if (!ids.includes(id)) out.push(`${id}.test.js names no case in plan/cases/`);
  for (const { case: id, item } of gaps) {
    if (!ids.includes(id)) out.push(`gaps.json names ${id}, which is no case in plan/cases/`);
    const head = itemHead(root, item);
    if (!head) out.push(`gaps.json gives ${id} to ${item}, which is no plan item`);
    else if (!LIVE(head.status)) out.push(`gaps.json gives ${id} to ${item}, which is ${head.status}, not open`);
    else if (!(head.cases ?? []).includes(id)) out.push(`gaps.json gives ${id} to ${item}, whose cases don't list it`);
  }
  if (gaps.length !== gapIds.size) out.push('gaps.json names a case twice');
  return out;
}

test('parity: every case in plan/cases/ has a parity test or a gaps.json entry naming an open fix item, never both', () => {
  assert.ok(caseIds().length >= 17, 'the cases are read');
  assert.deepEqual(problems(), []);
});

test('parity: a case with neither, both, or a gap given to a missing item is caught', async () => {
  const { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const copy = () => {
    const root = mkdtempSync(join(tmpdir(), 'parity-list-'));
    cpSync(join(repo, 'plan'), join(root, 'plan'), { recursive: true });
    const dir = join(root, 'parity');
    mkdirSync(dir);
    for (const f of readdirSync(here)) cpSync(join(here, f), join(dir, f));
    return { root, dir };
  };
  const gapsOf = (dir) => JSON.parse(readFileSync(join(dir, 'gaps.json'), 'utf8'));

  let { root, dir } = copy();
  rmSync(join(dir, 'C-push-after-pass.test.js'));
  assert.deepEqual(problems({ root, dir }), ['C-push-after-pass has neither a test nor a gaps.json entry']);

  ({ root, dir } = copy());
  const g = gapsOf(dir);
  g.gaps = g.gaps.filter((x) => x.case !== 'C-waiting-does-not-stall');
  writeFileSync(join(dir, 'gaps.json'), JSON.stringify(g));
  assert.deepEqual(problems({ root, dir }), ['C-waiting-does-not-stall has neither a test nor a gaps.json entry']);

  ({ root, dir } = copy());
  writeFileSync(join(dir, 'C-waiting-does-not-stall.test.js'), '');
  assert.deepEqual(problems({ root, dir }), ['C-waiting-does-not-stall has a test and a gaps.json entry; remove the entry']);

  ({ root, dir } = copy());
  const h = gapsOf(dir);
  h.gaps[0].item = 'no-such-item';
  writeFileSync(join(dir, 'gaps.json'), JSON.stringify(h));
  assert.match(problems({ root, dir }).join('\n'), /which is no plan item/);

  ({ root, dir } = copy());
  writeFileSync(join(root, 'plan', 'cases', 'more.md'), '### C-a-new-case\n');
  assert.deepEqual(problems({ root, dir }), ['C-a-new-case has neither a test nor a gaps.json entry']);
});
