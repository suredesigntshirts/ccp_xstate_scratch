// Capture's handlers (plan item obs-live-capture): one Claude Code hook input in, the journal rows and blobs it
// makes out. They write nothing themselves; capture.mjs appends what they return, and the tests replay a recorded
// session through them. Rows carry hashes and sizes of what a tool was given, never the input itself; the only
// text kept is a subagent's brief and final answer, stored as blobs by content hash. docs/journal.md, "Capture
// rows", "Refusal rows" and "Person rows", says what each row holds; refusals are plan item obs-refusal-log. The
// person rows (plan item obs-person-attention) come from two paths: what the person did arrives as a hearth wake, and
// what the session put in front of them is its own hearthbot tool call.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** The hook events capture listens to. hooks/hooks.json registers capture.mjs on each. */
export const EVENTS = Object.freeze(['PostToolUse', 'PostToolUseFailure', 'PermissionDenied', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit', 'Stop']);

// A transcript can be large; capture never reads more than this much of one.
export const READ_CAP = 8 * 1024 * 1024;

/**
 * { text, start }: up to `cap` bytes of a file from offset `from`, or its last `cap` bytes when `from` is null, and
 * the offset they start at. Null when the file can't be read.
 */
export function read(path, { from = null, cap }) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const start = from === null ? Math.max(0, size - cap) : Math.min(from, size);
    const length = Math.min(cap, size - start);
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    return { text: buf.toString('utf8'), start };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const bytes = (text) => Buffer.byteLength(text);

/** A blob for `text`, stored once at blobs/<sha256>, and the hash and size its rows link it by. */
const blob = (text) => ({ hash: sha256(text), bytes: bytes(text), text });

/**
 * The hash two calls share when they are the same tool with the same input: how a retry is recognised. A top-level
 * `description` (Bash's, the Agent tool's) is the model's label for the call, reworded freely, so it is left out
 * (seen live 2026-10-30: the same command retried under a new description).
 */
export function actionHash(tool, input) {
  const plain = input !== null && typeof input === 'object' && !Array.isArray(input);
  const { description, ...rest } = plain ? input : {};
  return sha256(JSON.stringify([String(tool), plain ? rest : input ?? null]));
}

/**
 * The rows and blobs for one hook input. `read` is read() above, or a stand-in for tests; `state` is this session's
 * capture state ({ transcriptAt, thread }: how far the last Stop read the transcript, which the Stop handler advances,
 * and the thread of the last hearth wake, which UserPromptSubmit sets).
 * `refused` maps the actionHash of each action this session already had refused to that refusal row's id; `newId`
 * makes a refusal row's id, so a later row can link to it. `actor(agentId)` says whether a subagent is an invoked
 * actor's agent (plan item engine-actors), whose tool calls also keep their paths. Returns { rows, blobs, state }; each row has kind,
 * source, agent, payload and maybe placeholder, id and at.
 */
export function capture(input, { read, state = {}, refused = {}, newId = randomUUID, actor = () => false } = {}) {
  const handler = HANDLERS[input?.hook_event_name];
  if (!handler) return { rows: [], blobs: [], state };
  return { blobs: [], state, ...handler(input, { read, state, refused: { ...refused }, newId, actor }) };
}

const HANDLERS = {
  PostToolUse: (input, ctx) => {
    const brief = briefOf(input);
    return { rows: [toolCall(input, true, ctx), ...brief.rows, ...mergeOf(input), ...posted(input, ctx.state)], blobs: brief.blobs };
  },
  PostToolUseFailure: (input, ctx) => ({ rows: [toolCall(input, false, ctx)] }),
  PermissionDenied: (input, ctx) => ({ rows: [classifierRefusal(input, ctx)] }),
  SubagentStart: spawn,
  SubagentStop: finish,
  UserPromptSubmit: (input, { state }) => {
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    const person = personOf(prompt);
    // A thread's session is bound to its thread; the card and post rows of later tool calls take it from here.
    const next = person.thread && person.thread !== state.thread ? { ...state, thread: person.thread } : state;
    return { rows: [wake(input), ...person.rows], state: next };
  },
  Stop: usage,
};

function toolCall(input, ok, { refused, actor = () => false }) {
  const given = JSON.stringify(input.tool_input ?? null);
  const retryOf = refused[actionHash(input.tool_name, input.tool_input)];
  return {
    kind: 'tool.call',
    source: { system: 'claude-code', ref: input.tool_use_id ?? `${input.hook_event_name} ${input.tool_name}` },
    agent: input.agent_id ?? null,
    payload: {
      tool: String(input.tool_name),
      inputHash: sha256(given),
      inputBytes: bytes(given),
      ms: Number.isFinite(input.duration_ms) ? input.duration_ms : null,
      ok,
      ...(input.agent_id && actor(input.agent_id) ? { paths: pathsOf(input.tool_name, input.tool_input, input.cwd) } : {}),
      ...(retryOf ? { retryOf } : {}),
    },
  };
}

const FILE_TOOLS = { Read: 'file_path', Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const SEARCH_TOOLS = { Glob: 'path', Grep: 'path', LS: 'path' };
// A shell command an invoked actor runs is wrapped to start in its worktree (packages/engine/src/actors.js, confine).
const CONFINED = /^\( cd '((?:[^']|'\\'')*)' \|\| exit 1\n/;

/**
 * The paths a tool call names (plan item engine-actors): a file tool's path, a search's folder (the session's when it
 * names none), and the folder a shell command ran from. Kept only on an invoked actor's tool.call rows, the one part
 * of a tool's input a row keeps, so the journal shows where each actor worked.
 */
export function pathsOf(tool, input, cwd = null) {
  if (FILE_TOOLS[tool]) return typeof input?.[FILE_TOOLS[tool]] === 'string' ? [input[FILE_TOOLS[tool]]] : [];
  if (SEARCH_TOOLS[tool]) return [typeof input?.[SEARCH_TOOLS[tool]] === 'string' && input[SEARCH_TOOLS[tool]] ? input[SEARCH_TOOLS[tool]] : cwd].filter(Boolean);
  if (tool === 'Bash' && typeof input?.command === 'string') {
    const m = input.command.match(CONFINED);
    return [m ? m[1].replace(/'\\''/g, "'") : cwd].filter(Boolean);
  }
  return [];
}

// A refusal row. `refused` is updated, so a second refusal of the same action in one batch links to the first.
function refusal({ source, rule, text, tool, input, ref, agent, at }, { refused, newId }) {
  const hash = actionHash(tool, input);
  const id = newId();
  const row = {
    id,
    ...(at ? { at } : {}),
    kind: 'refusal',
    source: { system: source === 'hook' ? 'hook' : 'claude-code', ref },
    agent,
    payload: { source, rule, textHash: text ? sha256(text) : null, actionHash: hash, tool: String(tool), retryOf: refused[hash] ?? null, outcome: 'denied' },
  };
  refused[hash] = id;
  return row;
}

// PermissionDenied fires only for an auto mode classifier refusal (checked in Claude Code 2.1.314). Its `reason` is
// the rule, such as "[Self-Modification]"; the full text the model saw doesn't reach the hook.
const classifierRefusal = (input, ctx) => refusal({
  source: 'classifier',
  rule: typeof input.reason === 'string' ? input.reason : null,
  text: null,
  tool: input.tool_name,
  input: input.tool_input,
  ref: input.tool_use_id ?? `PermissionDenied ${input.tool_name}`,
  agent: input.agent_id ?? null,
}, ctx);

// A hook's or a permission rule's denial fires no hook at all: the call never runs, so neither PostToolUse,
// PostToolUseFailure nor PermissionDenied sees it (probed 2026-10-30, Claude Code 2.1.314). The model gets an error
// tool_result whose text says which, so Stop and SubagentStop find them in the transcript. A classifier refusal is
// left to PermissionDenied. Rows keep the rule's name and a hash of the text, never the text: a permission denial's
// text holds the command, and a hook's may.
const HOOK_DENIAL = /^(\w+):(\S+) hook error: (?:\[[^\]\n]*\]: )?([\s\S]*)$/;
const PERMISSION_DENIAL = /^Permission to (?:use|read|edit) [\s\S]* has been denied\.$/;
const PERSON_DECLINED = /^The user doesn't want to proceed with this tool use/;

/** { source, rule } for a tool_result's error text that is a hook or permission denial, else null. */
export function denialOf(text) {
  const hook = text.match(HOOK_DENIAL);
  if (hook) {
    // Our hooks name their rule first, "<rule>: why"; a reason with no such name keeps only the hook event.
    const name = hook[3].match(/^\s*([\w.@/[\]-]{1,80}):\s/)?.[1];
    return { source: 'hook', rule: name ?? `${hook[1]} hook` };
  }
  if (PERMISSION_DENIAL.test(text)) return { source: 'permission', rule: 'deny rule' };
  if (PERSON_DECLINED.test(text)) return { source: 'permission', rule: 'person declined' };
  return null;
}

// The hook and permission refusals in transcript entries, in order, each matched to the tool_use it refused.
function refusalsIn(entries, agent, ctx) {
  const uses = new Map();
  const rows = [];
  for (const e of entries) {
    for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (e.type === 'assistant' && c.type === 'tool_use') uses.set(c.id, c);
      if (e.type !== 'user' || c.type !== 'tool_result' || !c.is_error) continue;
      const text = textOf(c.content).trim();
      const denial = denialOf(text);
      const use = uses.get(c.tool_use_id);
      if (!denial || !use) continue;
      rows.push(refusal({ ...denial, text, tool: use.name, input: use.input, ref: c.tool_use_id, agent, at: e.timestamp }, ctx));
    }
  }
  return rows;
}

// A subagent's own files sit beside its parent's transcript: <transcript without .jsonl>/subagents/agent-<id>.*
const agentFile = (input, ext) =>
  input.transcript_path ? `${input.transcript_path.replace(/\.jsonl$/, '')}/subagents/agent-${input.agent_id}${ext}` : null;

function meta(input, read) {
  const path = agentFile(input, '.meta.json');
  const got = path && read(path, { from: 0, cap: 64 * 1024 });
  try {
    return got ? JSON.parse(got.text) : {};
  } catch {
    return {};
  }
}

const textOf = (content) =>
  typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : '';

const lines = (text) => text.split('\n').flatMap((l) => {
  try {
    return l.trim() ? [JSON.parse(l)] : [];
  } catch {
    return []; // a torn last line, or the partial first line of a tail read
  }
});

// SubagentStart: the brief is the first line of the agent's transcript, which a foreground agent has written by now.
// A background agent may not have, so the spawn row's briefHash can be null; brief.stored comes from the Agent call.
function spawn(input, { read }) {
  const agentId = input.agent_id;
  const m = meta(input, read);
  const path = agentFile(input, '.jsonl');
  const first = path && read(path, { from: 0, cap: 1024 * 1024 });
  const opening = first ? lines(first.text.split('\n')[0])[0] : null;
  const brief = opening?.type === 'user' ? textOf(opening.message?.content) : '';
  return {
    rows: [{
      kind: 'agent.spawn',
      source: { system: 'claude-code', ref: m.toolUseId ?? `SubagentStart ${agentId}` },
      agent: agentId,
      payload: { agentId, type: input.agent_type ?? m.agentType ?? null, model: m.model ?? null, briefHash: brief ? sha256(brief) : null, depth: m.spawnDepth ?? null },
      ...(brief ? {} : { placeholder: 'the brief was not yet in the subagent transcript at SubagentStart; brief.stored has it' }),
    }],
  };
}

// The Agent call's own record of the brief, with the id of the agent it started: returned at once for a background
// agent, at its end for a foreground one.
function briefOf(input) {
  const agentId = input.tool_response?.agentId;
  const text = input.tool_input?.prompt;
  if (typeof agentId !== 'string' || typeof text !== 'string' || !text) return { rows: [], blobs: [] };
  const b = blob(text);
  return {
    rows: [{ kind: 'brief.stored', source: { system: 'journal', ref: `blobs/${b.hash}` }, agent: agentId, payload: { agentId, hash: b.hash, bytes: b.bytes } }],
    blobs: [b],
  };
}

// A merge done with the GitHub MCP merge tool, as its own response reports it, so the journal check can tell it
// from a merge done any other way (obs-journal-vs-world). Only the PR's identifiers and GitHub's sha are kept.
export const MERGE_TOOL = /^mcp__.*github.*__merge_pull_request$/;

function mergeOf(input) {
  const { owner, repo, pullNumber } = input.tool_input ?? {};
  if (!MERGE_TOOL.test(String(input.tool_name)) || !owner || !repo || !Number.isInteger(Number(pullNumber))) return [];
  const said = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response ?? null);
  const merged = /\\?"merged\\?"\s*:\s*true/.test(said);
  const sha = said.match(/\\?"sha\\?"\s*:\s*\\?"([0-9a-f]{40})/)?.[1] ?? null;
  if (!merged && !sha) return [];
  const number = Number(pullNumber);
  return [{
    kind: 'pr.merge',
    source: { system: 'github', ref: `${owner}/${repo}#${number}` },
    agent: input.agent_id ?? null,
    payload: { repo: `${owner}/${repo}`, number, sha, tool: String(input.tool_name), toolUseId: input.tool_use_id ?? null },
  }];
}

// Token counts summed over assistant messages, each message once (a transcript writes one line per content block).
function tokens(entries) {
  const seen = new Set();
  const sum = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const models = new Set();
  for (const e of entries) {
    if (e.type !== 'assistant' || !e.message?.usage) continue;
    const id = e.message.id ?? e.requestId ?? e.uuid;
    if (seen.has(id)) continue;
    seen.add(id);
    const u = e.message.usage;
    sum.input += u.input_tokens ?? 0;
    sum.output += u.output_tokens ?? 0;
    sum.cacheRead += u.cache_read_input_tokens ?? 0;
    sum.cacheCreation += u.cache_creation_input_tokens ?? 0;
    if (e.message.model) models.add(e.message.model);
  }
  return { tokens: sum, models: [...models], messages: seen.size };
}

// The subagent's final answer: its SubagentHandback message when it handed one back, else its last assistant text.
function answer(entries, input) {
  let handback = null;
  let last = '';
  for (const e of entries) {
    if (e.type !== 'assistant') continue;
    for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (c.type === 'tool_use' && c.name === 'SubagentHandback' && typeof c.input?.message === 'string') handback = c.input.message;
      if (c.type === 'text' && c.text) last = c.text;
    }
  }
  return handback ?? (typeof input.last_assistant_message === 'string' ? input.last_assistant_message : null) ?? last;
}

/**
 * True when a transcript's tail ends with the result of the agent's SubagentHandback call: the last line Claude Code
 * writes for an agent that handed back, so nothing more is coming. `text` is the file's tail; its first line may be cut.
 */
export function handedBack(text) {
  const entries = lines(text);
  const last = entries.at(-1);
  const result = last?.type === 'user' && Array.isArray(last.message?.content) ? last.message.content.find((c) => c.type === 'tool_result') : null;
  if (!result) return false;
  return entries.some((e) => e.type === 'assistant' && Array.isArray(e.message?.content) &&
    e.message.content.some((c) => c.type === 'tool_use' && c.name === 'SubagentHandback' && c.id === result.tool_use_id));
}

// SubagentStop: time, tokens and answer come from the agent's own transcript.
function finish(input, { read, refused, newId }) {
  const agentId = input.agent_id;
  const m = meta(input, read);
  const path = input.agent_transcript_path ?? agentFile(input, '.jsonl');
  const got = path && read(path, { from: null, cap: READ_CAP });
  const entries = got ? lines(got.text) : [];
  const times = entries.map((e) => Date.parse(e.timestamp)).filter(Number.isFinite);
  const { tokens: t, models } = tokens(entries);
  const text = answer(entries, input);
  const rows = [];
  const blobs = [];
  if (text) {
    const b = blob(text);
    blobs.push(b);
    rows.push({ kind: 'result.stored', source: { system: 'journal', ref: `blobs/${b.hash}` }, agent: agentId, payload: { agentId, hash: b.hash, bytes: b.bytes } });
  }
  rows.unshift({
    kind: 'agent.finish',
    source: { system: 'claude-code', ref: m.toolUseId ?? `SubagentStop ${agentId}` },
    agent: agentId,
    payload: {
      agentId,
      type: input.agent_type ?? m.agentType ?? null,
      model: models.at(-1) ?? null,
      ms: times.length ? Math.max(...times) - Math.min(...times) : null,
      tokens: t,
      resultHash: blobs[0]?.hash ?? null,
    },
    ...(got ? {} : { placeholder: 'the subagent transcript was not readable at SubagentStop' }),
  });
  rows.push(...refusalsIn(entries, agentId, { refused, newId }));
  return { rows, blobs };
}

// What woke the session, from the opening of the prompt text; the text itself is never kept.
export function wakeOf(prompt) {
  const reason = prompt.match(/<wake reason="([^"]+)"/)?.[1];
  if (reason) return { reason, source: 'hearth' };
  if (/^\s*<agent-message from=/.test(prompt)) return { reason: 'agent-message', source: 'subagent' };
  if (/<task-notification>/.test(prompt)) return { reason: 'task-notification', source: 'claude-code' };
  return { reason: 'prompt', source: 'user' };
}

function wake(input) {
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  return {
    kind: 'wake',
    source: { system: 'claude-code', ref: input.prompt_id ?? `UserPromptSubmit ${input.session_id}` },
    agent: null,
    payload: { ...wakeOf(prompt), hash: sha256(prompt), bytes: bytes(prompt) },
  };
}

// Stop: the tokens of the turn are the main transcript's assistant messages since the last Stop. Cost and the
// 5-hour and 7-day usage windows reach no hook, so they stay null and the row says so.
function usage(input, { read, state, refused, newId }) {
  const from = Number.isInteger(state.transcriptAt) ? state.transcriptAt : null;
  const got = input.transcript_path && read(input.transcript_path, { from, cap: READ_CAP });
  // Only whole lines count, so a line still being written is read at the next Stop.
  const whole = got ? got.text.slice(0, got.text.lastIndexOf('\n') + 1) : '';
  const entries = lines(whole).filter((e) => !e.isSidechain);
  const { tokens: t, models, messages } = tokens(entries);
  return {
    rows: [{
      kind: 'turn.usage',
      source: { system: 'claude-code', ref: input.prompt_id ?? `Stop ${input.session_id}` },
      agent: null,
      payload: { tokens: t, messages, models, cost: null, fiveHour: null, sevenDay: null },
      placeholder: got
        ? 'cost and the 5-hour and 7-day usage windows do not reach a hook'
        : 'the transcript was not readable at Stop, and cost and usage windows do not reach a hook',
    }, ...refusalsIn(entries, null, { refused, newId })],
    state: got ? { ...state, transcriptAt: got.start + bytes(whole) } : state,
  };
}

// Person rows. A hearth wake is XML-like text with entity-escaped attribute values and bodies.
const unescape = (text) => text.replace(/&(#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|apos);/gi, (all, _, dec, hex) =>
  dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16))
    : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[all.slice(1, -1).toLowerCase()]);

const attrs = (text) => Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, unescape(v)]));

/**
 * What the person did, from one wake's text: { thread, rows }. Each message from="human" is a person.message, except
 * on a decision-chosen wake, where it is the platform's record of a tap and becomes one person.tap naming the card
 * (the decision_id note) and the option. Text the person wrote is kept as a hash and a size, never itself. Messages a
 * coordinator relays (<cited author="user">) are copies of messages recorded where they were written, so they make
 * no row here.
 */
export function personOf(prompt) {
  const open = prompt.match(/<wake ([^>]*)>/);
  if (!open) return { thread: null, rows: [] };
  const reason = attrs(open[1]).reason ?? null;
  const thread = prompt.match(/<thread ts="([^"]+)"/)?.[1] ?? null;
  const notes = Object.fromEntries([...prompt.matchAll(/<system-note>([\w-]+)=([^<\s]*)<\/system-note>/g)].map(([, k, v]) => [k, unescape(v)]));
  const rows = [];
  for (const [, head, body] of prompt.matchAll(/<message ([^>]*)>([\s\S]*?)<\/message>/g)) {
    const a = attrs(head);
    if (a.from !== 'human') continue;
    const sentAt = a['sent-at'] ?? null;
    const authorId = a['author-id'] ?? null;
    if (reason === 'decision-chosen' && notes.decision_id) {
      const index = Number.parseInt(notes.option_index, 10);
      rows.push({
        kind: 'person.tap',
        source: { system: 'hearth', ref: notes.decision_id },
        agent: null,
        payload: { thread, cardId: notes.decision_id, option: notes.option ?? null, optionIndex: Number.isInteger(index) ? index : null, sentAt, authorId },
      });
      continue;
    }
    const text = unescape(body);
    rows.push({
      kind: 'person.message',
      source: { system: 'hearth', ref: a.id ?? `${reason ?? 'wake'} ${sentAt ?? ''}`.trim() },
      agent: null,
      payload: { thread, messageId: a.id ?? null, reason, trigger: a.trigger === 'true', surface: a.surface ?? null, sentAt, authorId, hash: sha256(text), bytes: bytes(text) },
      ...(a.id ? {} : { placeholder: 'the wake gave this message no id' }),
    });
  }
  return { thread, rows };
}

// The hearthbot tools that put something in front of the person: a decision or draft card, or a post that notifies.
// Claude Code names an MCP tool mcp__<server>__<tool>; a plugin's copy of the server adds its own prefix.
const HEARTH_TOOL = /^mcp__(?:.*[_-])?hearthbot__(request_decision|post_widget|post_message)$/;

// An MCP tool's result reaches PostToolUse as its content blocks (seen 2026-10-30 on Claude Code 2.1.314); hearthbot
// answers with one text block of JSON such as {"message_id":"cmsg_…","thread_id":"cmsg_…"}.
function resultOf(response) {
  const blocks = Array.isArray(response) ? response : Array.isArray(response?.content) ? response.content : null;
  const text = blocks ? textOf(blocks) : typeof response === 'string' ? response : null;
  if (text === null) return response && typeof response === 'object' ? response : {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** card.posted or post.sent for one successful hearthbot call, with the thread the session was last woken in. */
export function posted(input, state = {}) {
  const tool = String(input.tool_name ?? '').match(HEARTH_TOOL)?.[1];
  if (!tool) return [];
  const result = resultOf(input.tool_response);
  const id = typeof result.message_id === 'string' ? result.message_id : null;
  const thread = (typeof result.thread_id === 'string' ? result.thread_id : null) ?? state.thread ?? null;
  const given = JSON.stringify(input.tool_input ?? null);
  const base = {
    source: { system: 'hearth', ref: id ?? input.tool_use_id ?? `PostToolUse ${input.tool_name}` },
    agent: input.agent_id ?? null,
    ...(id ? {} : { placeholder: `the ${tool} result named no message id` }),
  };
  if (tool === 'post_message') {
    const text = typeof input.tool_input?.text === 'string' ? input.tool_input.text : '';
    const attached = Array.isArray(input.tool_input?.attached_outputs) ? input.tool_input.attached_outputs.length : 0;
    return [{ ...base, kind: 'post.sent', payload: { thread, messageId: id, hash: sha256(text), bytes: bytes(text), attached } }];
  }
  const options = Array.isArray(input.tool_input?.options) ? input.tool_input.options.length : null;
  return [{
    ...base,
    kind: 'card.posted',
    payload: { thread, cardId: id, card: tool === 'request_decision' ? 'decision' : 'widget', options, recommended: Number.isInteger(input.tool_input?.recommended) ? input.tool_input.recommended : null, inputHash: sha256(given), inputBytes: bytes(given) },
  }];
}
