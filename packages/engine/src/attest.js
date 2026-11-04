// Attestations (design C, provenance): agent output reaches the machine only after the host stamps it with what it
// measured itself: attested = { run, digest, subject, prs, sources }. A worker never writes `attested`, and specs read
// facts from attested.* only. Lanes: a run may push only to the branch the host names for it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prRef } from './effects/merge.js';

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const readFileOrNull = (path) => {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
};
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const stripTags = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ');
const refused = (rule, reason) => ({ refused: { rule, reason } });

export const lanePart = (v) => (v && typeof v === 'object') ? Object.entries(v).map(([k, x]) => `${k}-${x}`).join('-') : String(v);
export const laneBranch = (item, lane) => `ccp/${safe(item)}/${lanePart(lane)}`;
export const intoBranch = (item, into, defaultBranch = 'main') => (into == null ? defaultBranch : laneBranch(item, into));

// Every { url, headSha } object in a result: a claim of a PR at a head, anywhere in it.
export function claimedPrs(value, path = 'result') {
  if (!value || typeof value !== 'object') return [];
  const here = typeof value.url === 'string' && typeof value.headSha === 'string' ? [{ path, pr: value }] : [];
  return [...here, ...Object.entries(value).flatMap(([k, v]) => claimedPrs(v, `${path}.${k}`))];
}

/**
 * run: { run, actor, item, input, worktree, branch, into }; observe: { head(worktree), pull(ref), files(ref), fetch(url) };
 * store(text) -> sha256 of the blob it wrote. Returns { output } (the result with attested) or { refused: { rule, reason } }.
 */
export async function attest({ run, result, observe, protectedPaths = ['.github/'], store }) {
  if (result && typeof result === 'object' && 'attested' in result) return refused('attested-reserved', 'the host writes attested');
  const text = JSON.stringify(result);
  const digest = store(text);
  const s = run.input?.subject;
  const subject = /^[0-9a-f]{40}$/.test(s ?? '') ? await observe.head(run.worktree)
    : /^[0-9a-f]{64}$/.test(s ?? '') ? (() => { const b = readFileOrNull(join(run.worktree, '.ccp/subject')); return b ? sha256(b) : null; })()
      : null;
  const prs = [];
  for (const { path, pr } of claimedPrs(result)) {
    const ref = prRef(pr.url);
    if (!ref) return refused('github-fact', `${path}.url ${JSON.stringify(pr.url)} is not a GitHub PR URL`);
    let now;
    try {
      now = await observe.pull(ref);
    } catch (error) {
      const why = error.status === 404 ? 'GitHub shows no such PR' : `GitHub could not be read (${error.message})`;
      return refused('github-fact', `${path}: ${pr.url}: ${why}`);
    }
    if (now?.head?.sha !== pr.headSha) return refused('github-fact', `${path}: GitHub shows head ${now?.head?.sha ?? 'none'}, not the claimed ${pr.headSha}`);
    if (now.head.ref !== run.branch) return refused('lane', `PR is on ${now.head.ref}, this run's lane is ${run.branch}`);
    if (now.base?.ref !== run.into) return refused('lane', `PR is into ${now.base?.ref}, this run may only open into ${run.into}`);
    const changed = (await observe.files(ref)).map((f) => f.filename);
    const hit = changed.filter((p) => protectedPaths.some((pre) => p.startsWith(pre)));
    prs.push({ ref: `${ref.owner}/${ref.repo}#${ref.pullNumber}`, url: pr.url, head: now.head.sha, base: now.base.ref,
      branch: now.head.ref, protected: hit.length ? hit : null });
  }
  const sources = [];
  for (const src of Array.isArray(result?.sources) ? result.sources : []) {
    let page;
    try {
      page = await observe.fetch(src.url);
    } catch (error) {
      return refused('source', `${src.url} could not be fetched (${error.message})`);
    }
    if (!page || page.status < 200 || page.status > 299) return refused('source', `${src.url} answered ${page?.status}`);
    if (!norm(stripTags(page.body)).includes(norm(src.quote))) return refused('source', `quote not found at ${src.url}`);
    sources.push({ url: src.url, quote: src.quote, digest: store(page.body) });
  }
  return { output: { ...result, attested: { run: run.run, digest, subject, prs, sources } } };
}
