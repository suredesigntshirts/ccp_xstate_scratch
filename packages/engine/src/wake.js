// Wakes into events. A wake is the text the platform delivered: a hook's prompt (UserPromptSubmit) or a
// ReadNotifications result (PostToolUse). Everything an event's source says is read from that envelope or from
// the host's own record of what it started, never from a tool, an argument or a file an agent writes (ledger
// L-agents-self-report, L-facts-from-source). The fixtures in test/fixtures/wakes/ are real wakes.
import { createHash } from 'node:crypto';

const unescape = (text) =>
  text.replace(/&(#\d+|#x[0-9a-f]+|quot|apos|amp|lt|gt);/gi, (_, code) =>
    code[0] === '#'
      ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
      : { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' }[code.toLowerCase()]);

const attrs = (text) =>
  Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, unescape(value)]));

const sha16 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * The wakes in a text, each { reason, currentTime, github, notes, tasks }: github lists the events GitHub sent
 * ({ kind, data }), notes are the system notes' key=value pairs (a tap's decision_id, option, option_index), and
 * tasks are task notifications ({ id, status }).
 */
export function wakesIn(text) {
  const wakes = [];
  // Only a wake that starts a line counts. The platform writes its envelopes at column zero; text an agent wrote that
  // reaches a prompt (a subagent's report) is indented by the harness, so a wake-shaped line inside it is not read.
  for (const [, head, body] of String(text).matchAll(/(?:^|\n)<wake ([^>]*)>([\s\S]*?)<\/wake>/g)) {
    const { reason = null, 'current-time': currentTime = null } = attrs(head);
    const github = [...body.matchAll(/<event ([^>]*)>([\s\S]*?)<\/event>/g)]
      .map(([, eventHead, eventBody]) => ({ ...attrs(eventHead), json: eventBody.replace(/<!--[\s\S]*?-->/g, '').trim() }))
      .filter((e) => e.source === 'github')
      .map(({ kind, json }) => {
        try {
          return { kind, json, data: JSON.parse(json) };
        } catch {
          return { kind, json, data: null };
        }
      });
    const notes = Object.fromEntries(
      [...body.matchAll(/<system-note>([\w-]+)=([^<]*)<\/system-note>/g)].map(([, key, value]) => [key, unescape(value.trim())])
    );
    wakes.push({ reason, currentTime, github, notes, tasks: tasksIn(body) });
  }
  // A task notification can arrive outside any <wake> (a subagent's report), so it is read from the whole text.
  if (!wakes.length && /(?:^|\n)<task-notification>/.test(text)) wakes.push({ reason: 'task-notification', currentTime: null, github: [], notes: {}, tasks: tasksIn(text) });
  return wakes;
}

const tasksIn = (text) =>
  [...String(text).matchAll(/(?:^|\n)\s{0,2}<task-notification>([\s\S]*?)<\/task-notification>/g)].map(([, body]) => ({
    id: body.match(/<task-id>([^<]*)<\/task-id>/)?.[1]?.trim() ?? null,
    status: body.match(/<status>([^<]*)<\/status>/)?.[1]?.trim() ?? null
  }));

/**
 * The events a wake offers this item, as inputs for applyEvent ({ event, source, run?, at }):
 *
 * - each GitHub event: { type: 'github.<kind>', ...its JSON }, source github and a hash of kind and JSON, so the
 *   same GitHub event delivered twice has one source;
 * - a card tap on a card one of the item's runs posted: that run's completion, { choice, by }, source hearth and the
 *   card id;
 * - a task notification that a run's worker failed or was stopped: that run's error, source claude-code and the
 *   task id (a worker's output arrives through its return tool, engine-actors);
 * - each timer the host set that is due by the wake's current-time: the timer's event, source timer and its id.
 *
 * A run is found by the ref its run effect's outcome recorded (the card id, the task id). A tap or task that matches
 * no run of this item offers nothing.
 */
export function inputsOfWake(host, text, { now = new Date().toISOString() } = {}) {
  const inputs = [];
  for (const wake of wakesIn(text)) {
    // A wake's time never runs ahead of this host's clock, so no envelope can make a timer due early.
    const stated = Date.parse(wake.currentTime);
    const at = new Date(Number.isNaN(stated) ? Date.parse(now) : Math.min(stated, Date.parse(now))).toISOString();
    for (const { kind, json, data } of wake.github) {
      if (!kind || !data || typeof data !== 'object') continue;
      inputs.push({ event: { ...data, type: `github.${kind}` }, source: { system: 'github', ref: `${kind} ${sha16(`${kind}\n${json}`)}` }, at });
    }
    if (wake.reason === 'decision-chosen' && wake.notes.decision_id) {
      const run = runByRef(host, wake.notes.decision_id);
      if (run) {
        const index = Number(wake.notes.option_index);
        const choices = host.effects.get(run.id)?.outcome?.choices;
        const choice = Array.isArray(choices) && choices[index] != null ? choices[index] : wake.notes.option;
        inputs.push({
          event: { type: `xstate.done.actor.${run.invoke}`, output: { choice, by: wake.notes.actor_account_id ?? 'person' } },
          run: run.id,
          source: { system: 'hearth', ref: wake.notes.decision_id },
          at
        });
      }
    }
    for (const task of wake.tasks) {
      if (!task.id || !['failed', 'killed', 'stopped'].includes(task.status)) continue;
      const run = runByRef(host, task.id);
      if (run) {
        inputs.push({
          event: { type: `xstate.error.actor.${run.invoke}`, error: `the worker ${task.status}` },
          run: run.id,
          source: { system: 'claude-code', ref: task.id },
          at
        });
      }
    }
    for (const timer of dueTimers(host, at)) inputs.push({ ...timer, at });
  }
  return inputs;
}

/** The timers the host set that are due at the given time, as inputs, earliest first. */
export const dueTimers = (host, at) =>
  [...host.timers.values()]
    .filter((timer) => Date.parse(timer.due) <= Date.parse(at))
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
    .map((timer) => ({ event: timer.event, source: { system: 'timer', ref: timer.id } }));

const runByRef = (host, ref) =>
  [...host.runs.values()].find((run) => host.effects.get(run.id)?.outcome?.ref === ref) ?? null;
