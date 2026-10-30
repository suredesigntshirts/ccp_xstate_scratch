// Pure checks behind the PR gates in .github/workflows/verdict.yml. pr-gate.mjs feeds them from git and the PR
// event; the tests feed them directly. Each check returns a list of reasons, empty when it passes. See docs/gates.md.

const HEAD_RE = /^```json\n([\s\S]*?)\n```/;
const BRIEF_RE = /^## Verifier brief$/m;

// The JSON head of an item file, or null when it has none or it isn't JSON.
export function itemHead(text) {
  const m = text?.match(HEAD_RE);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// The frozen part of an item: its head without status (which moves as the build goes), and its Verifier brief.
export function contract(text) {
  if (text == null) return null;
  const { status, ...rest } = itemHead(text) ?? {};
  const brief = text.split(BRIEF_RE)[1]?.split(/^## /m)[0].trim() ?? '';
  return JSON.stringify({ head: rest, brief });
}

// Which item a PR names: an `Item: <id>` line in the body, else a branch named <anything>/<id>.
export function namedItem({ branch = '', body = '', ids }) {
  const fromBody = body.match(/^Item:\s*([a-z0-9-]+)\s*$/m)?.[1];
  const fromBranch = branch.split('/').pop();
  const reasons = [];
  if (fromBody && !ids.has(fromBody)) reasons.push(`the body names item ${fromBody}, which plan/items/ doesn't have`);
  if (fromBody && ids.has(fromBranch) && fromBranch !== fromBody)
    reasons.push(`the body names ${fromBody} but the branch names ${fromBranch}`);
  return { item: fromBody ?? (ids.has(fromBranch) ? fromBranch : null), reasons };
}

// Contract freeze: a PR may not change the head or Verifier brief of a frozen item (the one it names, or one whose
// status at base is doing or done), unless it is labelled replan and touches only plan/.
export function checkFreeze({ changed, frozen, labels }) {
  const touched = frozen.filter((f) => f.before !== null && contract(f.before) !== contract(f.after));
  if (!touched.length) return [];
  const outside = changed.filter((p) => !p.startsWith('plan/'));
  if (labels.includes('replan') && !outside.length) return [];
  return touched.map((f) => `changes the contract of ${f.id} (its head or Verifier brief)` +
    (labels.includes('replan') ? `; a replan PR touches only plan/, but this one touches ${outside.join(', ')}`
      : '; only a PR labelled replan that touches nothing but plan/ may'));
}

// Verdict gate: verdict.json marks every Expect id of the item head MET, with the command and an output excerpt,
// and names a mutation and the test it turned red for every builder line.
export function checkVerdict({ item, head, verdict }) {
  if (!verdict) return [`no verify/${item}/verdict.json at the head sha`];
  if (verdict.item !== item) return [`verdict.json is for item ${verdict.item}, not ${item}`];
  const reasons = [];
  const results = new Map((Array.isArray(verdict.results) ? verdict.results : []).map((r) => [r?.id, r]));
  const filled = (v) => typeof v === 'string' && v.trim() !== '';
  for (const e of head.expect ?? []) {
    const r = results.get(e.id);
    if (!r) { reasons.push(`verdict has no result for Expect ${e.id}`); continue; }
    if (r.status !== 'MET') reasons.push(`Expect ${e.id} is ${r.status ?? 'unmarked'}, not MET`);
    if (!filled(r.command)) reasons.push(`Expect ${e.id} names no command`);
    if (!filled(r.excerpt)) reasons.push(`Expect ${e.id} has no output excerpt`);
    if (e.proof === 'builder' && !(filled(r.mutation) && filled(r.red_test)))
      reasons.push(`Expect ${e.id} is builder-proven, so it needs a mutation and the test it turned red`);
  }
  for (const id of results.keys()) if (!(head.expect ?? []).some((e) => e.id === id))
    reasons.push(`verdict marks ${id}, which the item head doesn't have`);
  return reasons;
}

// The Claude-Session trailer of a commit message, or null.
export function sessionOf(message) {
  return message.match(/^Claude-Session:\s*(\S+)\s*$/m)?.[1] ?? null;
}

// Separate session: the commit that last wrote verdict.json has a Claude-Session trailer that no builder commit
// (one touching anything outside verify/) carries. Commits after the verified sha may touch only verify/.
export function checkSessions({ item, verdictCommit, builderCommits, afterVerified }) {
  const reasons = [];
  if (!verdictCommit) return [`no commit in this PR writes verify/${item}/verdict.json`];
  const own = sessionOf(verdictCommit.message);
  if (!own) reasons.push(`the verdict commit ${verdictCommit.sha.slice(0, 7)} has no Claude-Session trailer`);
  for (const c of builderCommits) if (own && sessionOf(c.message) === own)
    reasons.push(`the verdict commit carries the same Claude-Session as builder commit ${c.sha.slice(0, 7)}`);
  for (const c of afterVerified)
    reasons.push(`commit ${c.sha.slice(0, 7)} changes ${c.files.find((f) => !f.startsWith('verify/'))} after the verified sha`);
  return reasons;
}

// Stub ban: no TODO, FIXME, "not implemented" or skipped test under packages/ or plugins/.
const STUBS = [
  [/\bTODO\b/, 'TODO'],
  [/\bFIXME\b/, 'FIXME'],
  [/not implemented/i, '"not implemented"'],
  [/\b(?:test|it|describe|suite)\.(?:skip|todo)\b/, 'a skipped test'],
  [/\{[^}]*\b(?:skip|todo)\s*:\s*(?:true|['"`])/, 'a skipped test'],
  [/\bt\.(?:skip|todo)\s*\(/, 'a skipped test'],
];
export function findStubs(files) {
  const reasons = [];
  for (const { path, text } of files) {
    if (!/^(packages|plugins)\//.test(path)) continue;
    text.split('\n').forEach((line, i) => {
      for (const [re, what] of STUBS) if (re.test(line)) { reasons.push(`${path}:${i + 1} has ${what}`); break; }
    });
  }
  return reasons;
}
