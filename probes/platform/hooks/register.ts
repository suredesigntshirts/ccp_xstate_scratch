// platform-probe: a throwaway mod for plan item probe-platform-baseline. Not part of any plugin.
// Every action is triggered by a marker in a turn's prompt text, so the same mod works on a live thread's wake
// (the wake text carries the marker) and under `claude -p`. Every result is one JSON line in out/probe-log.jsonl.
//
// Markers (anywhere in the turn's text):
//   PROBE:spawn            $.agent.spawn a subagent that runs `pwd` and answers
//   PROBE:cwd=<dir>        same, with cwd set to <dir>
//   PROBE:mcp              $.mcp.call hearthbot read_thread, and claude-code-remote list_triggers
//   PROBE:budget=<s>       busy-wait <s> seconds of the hook's own time inside turn.start
//   PROBE:timer-spawn=<s>  after <s> seconds, from a timer (no turn), $.agent.spawn
import type { Register } from 'claude-code'

const pending: Record<string, string> = {}
let mcpProbed = false

async function log($: any, rec: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...rec })
  await $.process.run([
    'sh', '-c', 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"', '_', line,
    `${$.plugin.root}/out/probe-log.jsonl`,
  ])
}

async function spawn($: any, label: string, cwd?: string) {
  const args: any = {
    description: `platform probe ${label}`,
    prompt: 'Platform probe. Run the shell command `pwd` once and reply with only its output on one line, then the word ok.',
  }
  if (cwd) args.cwd = cwd
  let res: any
  try { res = await $.agent.spawn(args) } catch (err) { res = { threw: String(err) } }
  if (res?.agentId) pending[res.agentId] = label
  await log($, { probe: 'spawn', label, cwd: cwd ?? null, result: res })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
  const v = await $.session.version()
  await log($, { probe: 'session', event: 'session.start', version: v, cwd: await $.session.cwd() })
  return next(e)
  })

  on('turn.start', async ($, e, next) => {
  if (e.agentId !== undefined) return next(e)
  const text = e.text ?? ''
  await log($, { probe: 'turn', event: 'turn.start', turnId: e.turnId, text: text.slice(0, 4000) })
  // A GitHub PR event reaches a live thread as a queued-notifications turn; and so does a send_later wake; treat both like PROBE:spawn.
  const isPrWake = text.includes('<task-type>queued-remote-notifications</task-type>')
  if (!text.includes('PROBE:') && !isPrWake) return next(e)
  if (isPrWake) await spawn($, 'queued-wake')

  const budget = /PROBE:budget=(\d+)/.exec(text)
  if (budget) {
    const secs = Number(budget[1])
    await log($, { probe: 'mod-budget', phase: 'start', secs, budgetMs: next.budget })
    const t0 = Date.now()
    let lastTick = 0
    while (Date.now() - t0 < secs * 1000) {
      const s = Math.floor((Date.now() - t0) / 1000)
      if (s !== lastTick) {
        lastTick = s
        await log($, { probe: 'mod-budget', phase: 'tick', s, aborted: next.signal?.aborted ?? null })
      }
    }
    await log($, { probe: 'mod-budget', phase: 'end', secs })
  }
  if (text.includes('PROBE:spawn')) await spawn($, 'turn')
  const cwd = /PROBE:cwd=(\S+)/.exec(text)
  if (cwd) await spawn($, 'cwd', cwd[1])
  // A wake's own text never reaches turn.start (it sits behind ReadNotifications), so the first queued wake after a
  // load runs the MCP probe too.
  if (text.includes('PROBE:mcp') || (isPrWake && !mcpProbed)) {
    mcpProbed = true
    for (const [server, tool, args] of [
      ['hearthbot', 'read_thread', { limit: 1 }],
      ['hearthbot', 'request_decision', {
        question: 'Probe card: ignore this, the probe thread closes it',
        options: [{ label: 'Close', consequence: 'Nothing happens.' }, { label: 'Keep', consequence: 'Nothing happens.' }],
        recommended: 0,
      }],
      ['claude-code-remote', 'send_later', { delay_minutes: 1, name: 'Probe: mod-scheduled wake', message: 'PROBE wake scheduled by the platform-probe mod through $.mcp.call send_later. Log it; nothing else to do.' }],
    ] as const) {
      let res: any
      try { res = await $.mcp.call(server, tool, args as any) } catch (err) { res = { threw: String(err) } }
      await log($, { probe: 'mcp', server, tool, result: JSON.stringify(res).slice(0, 2000) })
    }
  }
  const timer = /PROBE:timer-spawn=(\d+)/.exec(text)
  if (timer) {
    await log($, { probe: 'timer-spawn', phase: 'armed', secs: Number(timer[1]) })
    $.clock.after(Number(timer[1]) * 1000, async () => { await spawn($, 'timer') })
  }
  return next(e)
  }).catch(async ($, e, next) => {
  await log($, { probe: 'mod-budget', phase: 'failed', error: next.error })
  return next(e)
  })

  on('turn.complete', async ($, e, next) => {
  if (e.agentId !== undefined) {
    await log($, {
      probe: 'spawn-answer', label: pending[e.agentId] ?? null, agentId: e.agentId, reason: e.reason,
      answer: (e.answer ?? '').slice(0, 1000), refusal: (e as any).refusal ?? null,
    })
  } else if (e.reason === 'refusal') {
    await log($, { probe: 'refusal', event: 'turn.complete', refusal: (e as any).refusal })
  }
  return next(e)
  })

  on('tool.call', async ($, e, next) => {
  const r: any = await next(e)
  if (r?.deny !== undefined || r?.isError) {
    await log($, { probe: 'tool-refusal', event: 'tool.call', agentId: e.agentId ?? null, input: JSON.stringify(e).slice(0, 1500), deny: r.deny ?? null, isError: r.isError ?? null, text: r.text ?? null })
  }
  return r
  })
}
