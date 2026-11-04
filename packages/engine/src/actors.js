// Invoked actors (plan item engine-actors): the agents a workflow starts, and the one way their results come back.
// When a state invokes brief, build or verify, the host's run handler writes the actor's brief into its own run
// folder, makes it a git worktree named by item and run, and journals the brief's hash. The session then starts the
// agent with the Agent tool and the prompt `ccp-run <run>`; the harness's PreToolUse hook swaps in the brief, so
// the prompt the agent receives is the brief exactly, and its SubagentStart hook binds the agent's id to the run.
// A result counts only through the return tool, whose PreToolUse hook calls accept(): the caller must be the run's
// agent, the result must match the actor's schema, and a claimed PR must be on GitHub at the claimed head. Why it is
// built this way: plan/decisions/2026-10-30-engine-actors.md.
//
// Nothing here imports XState: the harness hook loads this file in a session that may not have it. Handing an
// accepted result to the item (deliver) imports the host only when it is called.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { append } from '../../journal/src/index.js';
import { check } from './schema.js';
import { prRef } from './effects/merge.js';

/** The actors that are agents. Others (merge, ask, post) are host effects (effects/index.js). */
export const AGENTS = Object.freeze(['brief', 'build', 'verify']);

/** The prompt the session gives the Agent tool to start a run; the hook replaces it with the run's brief. */
export const MARKER = /^\s*ccp-run\s+(\S+)\s*$/;
export const spawnPrompt = (run) => `ccp-run ${run}`;

/** True for the return tool under any plugin prefix: mcp__harness__return, mcp__plugin_ccp-harness_harness__return. */
export const isReturnTool = (name) => /^mcp__(?:plugin_[\w.-]+_)?harness__return$/.test(String(name));

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** A run's id is its effect id, `<item>:<seq>.<invoke>`; its name inside the item is `<seq>.<invoke>`. */
export function runOf(run) {
  const m = String(run ?? '').match(/^(.+):(\d+\.[\w-]+)$/);
  return m ? { item: m[1], name: m[2] } : null;
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
/** The run's folder: brief, context, binding and result, under the item's own folder in the journal root. */
export const runDir = (root, run) => {
  const r = runOf(run);
  return r && join(root, 'items', safe(r.item), 'runs', safe(r.name));
};
const agentFile = (root, agentId) => join(root, 'actors', 'agents', `${safe(agentId)}.json`);
const spawnFile = (root, toolUseId) => join(root, 'actors', 'spawns', `${safe(toolUseId)}.json`);
const itemFile = (root, item) => join(root, 'items', `${item}.jsonl`);

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};
// Written whole or not at all: a reader never sees half a file.
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.${process.pid}`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.${process.pid}`, path);
};
// Made once: the second writer is refused, so two hooks can't both bind or both accept.
const writeOnce = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
};
const storeBlob = (root, text) => {
  const hash = sha256(text);
  const path = join(root, 'blobs', hash);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return { hash, bytes: Buffer.byteLength(text) };
};

/** The run's record (run.json), or null. */
export const loadRun = (root, run) => {
  const dir = runDir(root, run);
  return dir && readJson(join(dir, 'run.json'));
};

// One journal row about a run, in the item's own file.
function journal(root, run, row) {
  const file = itemFile(root, run.item);
  mkdirSync(dirname(file), { recursive: true });
  return append(file, { session: run.session, release: run.release, item: run.item, state: run.state, agent: null, ...row });
}

// ---- The run handler: the host calls it when a state invokes an agent actor

// What the agent is told besides its brief: its run, its worktree and how to return. It reaches the agent as the
// SubagentStart hook's added context, so the prompt stays the brief alone and hashes to what was fixed before.
function contextOf(run) {
  const { brief, ...input } = run.input ?? {};
  return [
    `ccp-harness run ${run.run} (item ${run.item}, actor ${run.actor}).`,
    `Your worktree is ${run.worktree}, on branch ${run.branch}. Work only there: the harness refuses file tools outside it and runs your shell commands from it.`,
    `When you are done, call the harness return tool (its name ends in harness__return; load it with ToolSearch if it is deferred) with`,
    `{ "run": "${run.run}", "result": <your result> }. The result must match this JSON Schema: ${JSON.stringify(run.schema)}${Object.keys(run.defs).length ? ` (with $ref into ${JSON.stringify(run.defs)})` : ''}.`,
    `Only the agent this run started may return its result, and a claimed PR must be on GitHub at the claimed head.`,
    Object.keys(input).length ? `Your input: ${JSON.stringify(input)}` : ''
  ].filter(Boolean).join('\n');
}

// The brief an actor with no brief in its input gets (quick-fix's brief actor): written from its input alone.
const writtenBrief = (actor, input) =>
  `You are the ${actor} actor of a ccp_xstate work item. Your input is ${JSON.stringify(input ?? null)}. Do what the ${actor} step asks and return your result through the harness return tool.`;

/**
 * Run handlers for the agent actors, for effects/index.js handlers({ actors }). `host` is the item's host (its root,
 * item, session, release, spec and state); `repo` is the git clone each actor's worktree is added from (its HEAD),
 * `worktrees` the folder they go in. start() prepares the run and returns its outcome: { ref: the run, briefHash,
 * folder, worktree, branch, spawn: { tool, prompt } }. The run stays open until accept() hands back its result.
 */
export function actors({ host, repo = process.cwd(), worktrees = join(dirname(resolve(repo)), 'ccp-actors'), names = AGENTS }) {
  const handler = {
    start: (effect) => prepare({ host, effect, repo, worktrees }),
    // A host that stopped after the start row asks the run folder: prepared means it happened.
    find: (effect) => {
      const run = loadRun(host.root, effect.id);
      return run ? outcomeOf(run) : null;
    }
  };
  return Object.fromEntries(names.map((name) => [name, handler]));
}

const outcomeOf = (run) => ({
  ref: run.run,
  briefHash: run.briefHash,
  folder: runDir(run.root, run.run),
  worktree: run.worktree,
  branch: run.branch,
  spawn: { tool: 'Agent', prompt: spawnPrompt(run.run) }
});

/** Write the run's folder, brief and worktree, and journal the brief. Returns the run effect's outcome. */
export function prepare({ host, effect, repo, worktrees }) {
  const { root, item, spec } = host;
  const r = runOf(effect.id);
  if (!r || r.item !== item) throw new Error(`run ${effect.id} is not a run of ${item}`);
  const dir = runDir(root, effect.id);
  const existing = readJson(join(dir, 'run.json'));
  if (existing) return outcomeOf(existing);

  const brief = typeof effect.input?.brief === 'string' && effect.input.brief ? effect.input.brief : writtenBrief(effect.actor, effect.input);
  const branch = `run/${safe(item)}/${safe(r.name)}`;
  const worktree = join(resolve(worktrees), `${safe(item)}--${safe(r.name)}`);
  if (!existsSync(worktree)) {
    mkdirSync(dirname(worktree), { recursive: true });
    execFileSync('git', ['-C', resolve(repo), 'worktree', 'add', '-q', '-B', branch, worktree, 'HEAD'], { stdio: ['ignore', 'ignore', 'pipe'] });
  }
  const run = {
    run: effect.id,
    item,
    name: r.name,
    invoke: effect.invoke,
    actor: effect.actor,
    workflow: spec.id,
    root,
    session: host.session,
    release: host.release,
    state: host.snapshot ? JSON.stringify(host.snapshot.value) : null,
    input: effect.input ?? null,
    schema: spec.meta.actors?.[effect.actor] ?? {},
    defs: spec.meta.schemas ?? {},
    repo: resolve(repo),
    worktrees: resolve(worktrees),
    worktree,
    branch,
    briefHash: sha256(brief)
  };
  run.context = contextOf(run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brief.md'), brief);
  writeFileSync(join(dir, 'context.md'), run.context);
  const { hash, bytes } = storeBlob(root, brief);
  journal(root, run, {
    kind: 'brief.stored',
    source: { system: 'journal', ref: `blobs/${hash}` },
    payload: { run: run.run, actor: run.actor, role: run.actor, hash, bytes, contextHash: sha256(run.context), worktree }
  });
  writeJson(join(dir, 'run.json'), run);
  return outcomeOf(run);
}

// ---- What the harness hooks call

/**
 * PreToolUse of the Agent tool. A prompt that is not `ccp-run <run>` is not ours: null. Otherwise { allow, prompt }
 * with the brief to start the agent with, or { deny } when the run is unknown or already has its agent.
 */
export function spawn({ root, prompt, toolUseId, session = null }) {
  const m = String(prompt ?? '').match(MARKER);
  if (!m) return null;
  const run = loadRun(root, m[1]);
  if (!run) return { deny: `unknown-run: no prepared run ${m[1]}` };
  const dir = runDir(root, run.run);
  if (existsSync(join(dir, 'agent.json'))) return { deny: `already-started: run ${run.run} already has its agent` };
  if (!writeOnce(join(dir, 'spawn.json'), { toolUseId, session, at: new Date().toISOString() })) {
    return { deny: `already-started: run ${run.run} was already started by another Agent call` };
  }
  writeJson(spawnFile(root, toolUseId), { run: run.run, session });
  return { allow: true, prompt: readFileSync(join(dir, 'brief.md'), 'utf8'), run };
}

/**
 * The Agent call a new agent came from, at SubagentStart. That hook runs before the agent's transcript and meta.json
 * exist (seen on Claude Code 2.1.314), so it can't read the call's id; this finds the session's one started run
 * that has no agent yet. With none, or several (parallel Agent calls), it returns null and the agent is bound at its
 * first tool call instead, from meta.json (bindLate).
 */
export function startedRun({ root, session }) {
  let names = [];
  try {
    names = readdirSync(join(root, 'actors', 'spawns'));
  } catch {
    return null;
  }
  const open = names
    .map((name) => ({ toolUseId: name.replace(/\.json$/, ''), pointer: readJson(join(root, 'actors', 'spawns', name)) }))
    .filter(({ pointer }) => pointer && pointer.session === session && pointer.run)
    .filter(({ pointer }) => !existsSync(join(runDir(root, pointer.run), 'agent.json')));
  return open.length === 1 ? open[0].toolUseId : null;
}

/**
 * Bind an agent to the run its Agent call (toolUseId) started. Journals agent.spawn and returns { run, context }
 * (what the agent is told besides its brief), or null when that call started no run or the run has its agent.
 * `via` says how the call was found: `start` (startedRun) or `meta` (the agent's meta.json, exact).
 */
export function bind({ root, agentId, toolUseId, agentType = null, session = null, via = 'meta' }) {
  if (!agentId || !toolUseId) return null;
  const pointer = readJson(spawnFile(root, toolUseId));
  const run = pointer && loadRun(root, pointer.run);
  if (!run) return null;
  const dir = runDir(root, run.run);
  if (!writeOnce(join(dir, 'agent.json'), { agentId, toolUseId, via, at: new Date().toISOString() })) return null;
  // item and state: what capture tags the agent's own rows with (plan item engine-item-views).
  writeJson(agentFile(root, agentId), { run: run.run, item: run.item, state: run.state, worktree: run.worktree, toolUseId, verified: via === 'meta' });
  journal(root, run, {
    kind: 'agent.spawn',
    source: { system: 'claude-code', ref: toolUseId },
    agent: agentId,
    payload: { agentId, type: agentType, run: run.run, actor: run.actor, briefHash: run.briefHash, worktree: run.worktree, via, hookSession: session }
  });
  return { run, context: run.context };
}

/**
 * At a subagent's tool call, once its meta.json names the Agent call that started it (`metaToolUseId`): an agent
 * bound at SubagentStart is checked against it, and an agent that should have been bound and wasn't is bound now.
 * Returns null (nothing to do), { bound: { run, context } } (bound just now: tell it its run) or { deny } when the
 * agent was bound to another call's run.
 */
export function bindLate({ root, agentId, metaToolUseId, agentType = null, session = null }) {
  if (!agentId || !metaToolUseId) return null;
  const known = readJson(agentFile(root, agentId));
  if (known) {
    if (known.verified) return null;
    if (known.toolUseId !== metaToolUseId) {
      return { deny: `bind-mismatch: agent ${agentId} came from Agent call ${metaToolUseId}, but was bound to run ${known.run} of call ${known.toolUseId}` };
    }
    writeJson(agentFile(root, agentId), { ...known, verified: true });
    return null;
  }
  const got = bind({ root, agentId, toolUseId: metaToolUseId, agentType, session, via: 'meta' });
  return got ? { bound: got } : null;
}

/** The run an agent was bound to, or null: { run, item, state, worktree }. */
export const boundRun = (root, agentId) => (agentId ? readJson(agentFile(root, agentId)) : null);

const FILE_TOOLS = { Read: 'file_path', Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const SEARCH_TOOLS = { Glob: 'path', Grep: 'path', LS: 'path' };
const inside = (dir, path) => {
  const rel = relative(dir, resolve(dir, path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * PreToolUse of a bound agent's tool: keep it in its worktree. Returns null (leave the call alone), { input } (run it
 * with this input instead) or { deny }. Shell commands run in a subshell that starts in the worktree; file tools
 * outside it are refused; a search with no path searches the worktree.
 */
export function confine({ worktree, tool, input }) {
  if (tool === 'Bash' && typeof input?.command === 'string') {
    const prefix = `( cd ${quote(worktree)} || exit 1\n`;
    if (input.command.startsWith(prefix)) return null;
    return { input: { ...input, command: `${prefix}${input.command}\n)` } };
  }
  if (FILE_TOOLS[tool]) {
    const path = input?.[FILE_TOOLS[tool]];
    if (typeof path === 'string' && !inside(worktree, path)) return { deny: `own-folder: ${tool} ${path} is outside this actor's worktree ${worktree}` };
    return null;
  }
  if (SEARCH_TOOLS[tool]) {
    const path = input?.[SEARCH_TOOLS[tool]];
    if (path == null || path === '') return { input: { ...input, [SEARCH_TOOLS[tool]]: worktree } };
    if (!inside(worktree, path)) return { deny: `own-folder: ${tool} ${path} is outside this actor's worktree ${worktree}` };
  }
  return null;
}

/**
 * The checks a result passes before it counts, in order: the run exists, the caller is the agent the run started,
 * the run hasn't returned yet, the result matches the actor's schema, and every PR it claims is on GitHub at the
 * claimed head. `github` is a client from effects/github.js ({ pull }). Returns { accepted: { run, hash } } or
 * { refused: { rule, reason } }; both are journalled in the item's file.
 */
export async function accept({ root, caller, run: runId, result, toolUseId, github, session = null }) {
  const run = loadRun(root, runId);
  if (!run) return { refused: { rule: 'unknown-run', reason: `no prepared run ${JSON.stringify(runId ?? null)}` } };
  const refuse = (rule, reason) => {
    journal(root, run, {
      kind: 'refusal',
      source: { system: 'hook', ref: toolUseId ?? `return ${run.run}` },
      agent: caller ?? null,
      payload: { source: 'hook', rule, reason, run: run.run, actor: run.actor, caller: caller ?? null, tool: 'harness return', textHash: sha256(`${rule}: ${reason}`), outcome: 'denied', hookSession: session }
    });
    return { refused: { rule, reason } };
  };

  const dir = runDir(root, run.run);
  const bound = readJson(join(dir, 'agent.json'));
  if (!bound) return refuse('wrong-caller', `run ${run.run} has no agent bound; only the agent its Agent call started may return`);
  if (!caller) return refuse('wrong-caller', `the main session is not run ${run.run}'s actor (${bound.agentId})`);
  if (caller !== bound.agentId) return refuse('wrong-caller', `agent ${caller} is not run ${run.run}'s actor (${bound.agentId})`);
  if (existsSync(join(dir, 'result.json'))) return refuse('already-returned', `run ${run.run} already returned its result`);
  if (existsSync(join(dir, 'failed.json'))) return refuse('already-failed', `run ${run.run} failed: its actor stopped without returning`);

  const problems = check(run.schema, result, run.defs);
  if (problems.length) return refuse('schema', `${run.actor} result: ${problems.join('; ').replaceAll('$', 'result')}`);

  for (const { path, pr } of claimedPrs(result)) {
    const ref = prRef(pr.url);
    if (!ref) return refuse('github-fact', `${path}.url ${JSON.stringify(pr.url)} is not a GitHub PR URL`);
    let now;
    try {
      now = await github.pull(ref);
    } catch (error) {
      const why = error.status === 404 ? 'GitHub shows no such PR' : `GitHub could not be read (${error.message})`;
      return refuse('github-fact', `${path}: ${pr.url}: ${why}`);
    }
    if (now?.head?.sha !== pr.headSha) return refuse('github-fact', `${path}: GitHub shows ${pr.url} at head ${now?.head?.sha ?? 'none'}, not the claimed ${pr.headSha}`);
    if (pr.branch && now?.head?.ref !== pr.branch) return refuse('github-fact', `${path}: GitHub shows ${pr.url} on branch ${now?.head?.ref}, not the claimed ${pr.branch}`);
  }

  const text = JSON.stringify(result);
  const { hash, bytes } = storeBlob(root, text);
  if (!writeOnce(join(dir, 'result.json'), { result, hash, caller, toolUseId, at: new Date().toISOString() })) {
    return refuse('already-returned', `run ${run.run} already returned its result`);
  }
  journal(root, run, {
    kind: 'result.stored',
    source: { system: 'journal', ref: `blobs/${hash}` },
    agent: caller,
    payload: { run: run.run, actor: run.actor, agentId: caller, hash, bytes, toolUseId: toolUseId ?? null }
  });
  // A brief actor's briefs are fixed here, before any build starts: the verifier later gets this text exactly.
  if (run.actor === 'brief') {
    for (const [role, brief] of Object.entries(result)) {
      if (typeof brief !== 'string') continue;
      const b = storeBlob(root, brief);
      journal(root, run, { kind: 'brief.stored', source: { system: 'journal', ref: `blobs/${b.hash}` }, payload: { run: run.run, actor: run.actor, role, hash: b.hash, bytes: b.bytes } });
    }
  }
  return { accepted: { run: run.run, hash } };
}

// Every { url, headSha } object in a result: a claim of a PR at a head, `pr` at the top (quick-fix's build) or anywhere
// below. A url that isn't a GitHub PR's is still a claim, and is refused for it, so no shape of url skips GitHub.
function claimedPrs(value, path = 'result') {
  if (!value || typeof value !== 'object') return [];
  const here = typeof value.url === 'string' && typeof value.headSha === 'string' ? [{ path, pr: value }] : [];
  return [...here, ...Object.entries(value).flatMap(([k, v]) => claimedPrs(v, `${path}.${k}`))];
}

// An agent ending with its run still open (plan item engine-actor-returns) is sent back once to call the return tool;
// the next time it ends, its run fails, so the item gets the actor's error instead of waiting forever. An agent ends
// in two ways, and both are watched: the SubagentHandback tool (PreToolUse, handback()) and a plain stop (SubagentStop,
// stopped()). A block at SubagentStop does not re-prompt an agent that already handed back (seen in the verifier's
// scratch run ar2, 2026-10-31), so such a stop fails the run at once.
const sentBackFile = (dir) => join(dir, 'sent-back.json');
const returnInstruction = (run) => `You are the invoked ${run.actor} actor for run ${run.run}, and you are ending without returning your result, so the item can't move. Call the harness return tool now (its name ends in harness__return; load it with ToolSearch if it is deferred) with { "run": "${run.run}", "result": <your result> }. Don't redo your work unless the tool refuses the result.`;

// The bound agent's open run and its folder, or null when the agent is no actor or its run returned or failed.
function openRunOf(root, agentId) {
  const bound = boundRun(root, agentId);
  const run = bound && loadRun(root, bound.run);
  if (!run) return null;
  const dir = runDir(root, run.run);
  if (existsSync(join(dir, 'result.json')) || existsSync(join(dir, 'failed.json'))) return null;
  return { run, dir };
}

// Sends the run's agent back the first time it ends; true when it had already been sent back.
function sentBackBefore(dir, agentId, how) {
  return !writeOnce(sentBackFile(dir), { agentId, how, at: new Date().toISOString() });
}

function fail(root, { run, dir }, agentId, how, session) {
  const why = `the actor ended (${how}) without returning its result${how === 'SubagentStop, after a handback' ? '' : ', after being sent back once'}`;
  if (!writeOnce(join(dir, 'failed.json'), { agentId, why, at: new Date().toISOString() })) return null;
  journal(root, run, {
    kind: 'refusal',
    source: { system: 'hook', ref: `stop ${agentId}` },
    agent: agentId,
    payload: { source: 'hook', rule: 'no-return', reason: why, run: run.run, actor: run.actor, caller: agentId, tool: how.startsWith('SubagentStop') ? 'SubagentStop' : 'SubagentHandback', textHash: sha256(`no-return: ${why}`), outcome: 'denied', hookSession: session }
  });
  return { failed: run.run };
}

/**
 * PreToolUse of SubagentHandback by an agent: null (no actor, or its result is in), { deny: reason } the first time
 * its run is open, or { failed: run } the next time; the handback then goes through.
 */
export function handback({ root, agentId, session = null }) {
  const open = openRunOf(root, agentId);
  if (!open) return null;
  if (!sentBackBefore(open.dir, agentId, 'SubagentHandback')) return { deny: `no-return: ${returnInstruction(open.run)} Hand back after the return tool accepts it.` };
  return fail(root, open, agentId, 'SubagentHandback', session);
}

/**
 * SubagentStop of an agent: null (no actor, or its run returned or failed), { block: reason } the first time its run
 * is open, or { failed: run }. `again` is the hook input's stop_hook_active; `handedBack` is true when the agent's
 * transcript ends in its SubagentHandback result, when a block would not bring it back.
 */
export function stopped({ root, agentId, again = false, handedBack = false, session = null }) {
  const open = openRunOf(root, agentId);
  if (!open) return null;
  if (handedBack) return fail(root, open, agentId, 'SubagentStop, after a handback', session);
  if (!again && !sentBackBefore(open.dir, agentId, 'SubagentStop')) return { block: returnInstruction(open.run) };
  return fail(root, open, agentId, 'SubagentStop', session);
}

/**
 * The accepted results of an item's open runs, as host inputs: the actor's done event with the result as output.
 * The source is the return call that the checks accepted. A run whose actor stopped without returning (stopped())
 * gives the actor's error event instead, its source the agent's stop. A host offers these on any wake; deliver()
 * offers them at once.
 */
export function resultsOf(host) {
  const inputs = [];
  for (const run of host.runs.values()) {
    if (!AGENTS.includes(run.actor)) continue;
    const got = readJson(join(runDir(host.root, run.id), 'result.json'));
    const failed = !got && readJson(join(runDir(host.root, run.id), 'failed.json'));
    if (failed) {
      inputs.push({ event: { type: `xstate.error.actor.${run.invoke}`, error: failed.why }, run: run.id, source: { system: 'harness', ref: `stop ${failed.agentId}` } });
      continue;
    }
    if (!got) continue;
    inputs.push({
      event: { type: `xstate.done.actor.${run.invoke}`, output: got.result },
      run: run.id,
      source: { system: 'harness', ref: `return ${got.toolUseId ?? got.hash}` }
    });
  }
  return inputs;
}

/**
 * Hand an accepted result to its item: restore the item as its owner, offer the results, and prepare the runs the
 * next state invokes. Imports the host (and XState) only here. Returns the offer's results and the runs now waiting
 * for their agent, or { error } when the host can't be loaded or the item refuses.
 */
export async function deliver({ root, run: runId, github = null, workflow = null }) {
  const run = loadRun(root, runId);
  if (!run) return { error: `no prepared run ${runId}` };
  const { repo, worktrees } = run;
  try {
    const [{ restore, offer }, { handlers }, { loadWorkflow }] = await Promise.all([import('./host.js'), import('./effects/index.js'), import('./index.js')]);
    const spec = workflow ?? loadWorkflow(run.workflow);
    const host = restore({ root, item: run.item, spec, session: run.session, release: run.release });
    host.session = host.owner ?? run.session;
    const results = await offer(host, resultsOf(host), handlers({ github, actors: actors({ host, repo, worktrees }) }));
    return { results: results.map(({ outcome, row }) => ({ outcome, reason: row.payload.reason })), state: host.snapshot?.value ?? null, waiting: waiting(root, run.item) };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

/** The runs of an item prepared and not yet started: { run, prompt } for the session's Agent call. */
export function waiting(root, item) {
  const dir = join(root, 'items', safe(item), 'runs');
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => join(dir, name))
    .filter((d) => existsSync(join(d, 'run.json')) && !existsSync(join(d, 'spawn.json')))
    .map((d) => readJson(join(d, 'run.json')))
    .filter(Boolean)
    .map((run) => ({ run: run.run, actor: run.actor, prompt: spawnPrompt(run.run) }));
}
