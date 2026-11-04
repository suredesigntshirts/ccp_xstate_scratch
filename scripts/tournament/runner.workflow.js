export const meta = {
  name: 'tournament',
  description: 'Run a design tournament from a tournament folder: stages, roles, lanes and scoring all come from args',
  whenToUse: 'Pass the JSON that scripts/tournament/args.mjs prints for a tournaments/<id>/ folder as args',
  phases: [],
}

// The generic tournament runner (plan item tournament-kit). It knows nothing about the subject: every stage, role
// prompt, schema, lane and scoring rule arrives in `args`, built and checked by scripts/tournament/args.mjs. The
// Workflow tool gives scripts no file access, so prompts travel as text.
//
// args: { id, question, pack, scoring, vars, lanes: [{ id, alias, skip, given, brief }],
//         stages: [{ id, title, role, over: 'each' | 'all', pick?, brief? }], roles: { <role>: { prompt, schema } } }
// A run of consecutive `each` stages is one pipeline (no barrier); an `all` stage is one agent over every lane and is
// a barrier. A stage with `pick` runs only for lanes picked from an earlier `all` stage's ranking.

const T = args
if (!T || !Array.isArray(T.stages) || !Array.isArray(T.lanes) || !T.roles) {
  throw new Error('runner: args must come from scripts/tournament/args.mjs (stages, lanes, roles)')
}

const results = {} // results[laneId][stageId] = that lane's output for the stage
const stageOut = {} // stageOut[stageId] = the all-stage's output, or { laneId: output } for an each-stage
const stopped = new Set() // lanes whose agent returned nothing; they take no later stage
for (const l of T.lanes) results[l.id] = { ...(l.given || {}) }

const get = (scope, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), scope)
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v))
function render(text, scope, where) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, path) => {
    const v = get(scope, path)
    if (v === undefined) throw new Error(`runner: ${where} names {{${path}}}, which has no value`)
    return show(v)
  })
}

const nameOf = (l) => l.alias || l.id
const laneOf = (key) => T.lanes.find((l) => l.id === key || l.alias === key)
const lanesText = (ids) =>
  ids.map((id) => `Lane ${nameOf(laneOf(id))}: ${JSON.stringify(results[id])}`).join('\n\n')

function scopeFor(stage, lane) {
  const scope = {
    tournament: { id: T.id, question: T.question, pack: T.pack },
    question: T.question,
    pack: T.pack,
    scoring: T.scoring,
    vars: T.vars || {},
    stage: { id: stage.id, title: stage.title },
    stages: stageOut,
    lanes: lanesText(T.lanes.map((l) => l.id)),
  }
  if (lane) {
    scope.lane = { ...lane, name: nameOf(lane) }
    scope.prev = results[lane.id]
  }
  const briefs = [stage.brief, lane?.brief?.[stage.id]].filter(Boolean)
  scope.brief = briefs.map((b) => render(b, scope, `stage ${stage.id} brief`)).join('\n')
  return scope
}

function picked(stage) {
  const ranking = (stageOut[stage.pick.from]?.ranking || []).map((k) => laneOf(k)?.id).filter(Boolean)
  const exclude = new Set(stage.pick.exclude || [])
  const top = ranking.filter((id) => !exclude.has(id)).slice(0, stage.pick.top ?? ranking.length)
  const ids = [...new Set([...top, ...(stage.pick.plus || [])])].filter((id) => !stopped.has(id))
  const dropped = T.lanes.map((l) => l.id).filter((id) => !ids.includes(id))
  if (dropped.length) log(`${stage.id}: picked ${ids.join(', ') || 'none'}; not run for ${dropped.join(', ')}`)
  return ids
}

function call(stage, lane) {
  const role = T.roles[stage.role]
  const scope = scopeFor(stage, lane)
  const prompt = render(role.prompt, scope, `role ${stage.role}`)
  const label = lane ? `${stage.id}:${lane.id}` : stage.id
  return agent(prompt, { label, phase: stage.title || stage.id, ...(role.schema && { schema: role.schema }) })
}

// Group consecutive unpicked each-stages so a lane can move on without waiting for the others.
const groups = []
for (const s of T.stages) {
  const last = groups[groups.length - 1]
  if (s.over === 'each' && !s.pick && last && last.over === 'each' && !last.pick) last.stages.push(s)
  else groups.push({ over: s.over, pick: s.pick, stages: [s] })
}

for (const g of groups) {
  if (g.over === 'all') {
    const s = g.stages[0]
    phase(s.title || s.id)
    stageOut[s.id] = await call(s, null)
    if (stageOut[s.id] == null) log(`${s.id}: the agent returned nothing`)
    continue
  }
  for (const s of g.stages) stageOut[s.id] = {}
  const ids = g.pick ? picked(g.stages[0]) : T.lanes.map((l) => l.id)
  phase(g.stages[0].title || g.stages[0].id)
  const steps = g.stages.map((s) => async (_prev, id) => {
    const lane = laneOf(id)
    if (stopped.has(id)) return null
    if ((lane.skip || []).includes(s.id)) return results[id][s.id] ?? null
    const out = await call(s, lane)
    if (out == null) {
      log(`${s.id}:${id}: the agent returned nothing; the lane stops here`)
      stopped.add(id)
      return null
    }
    results[id][s.id] = out
    stageOut[s.id][id] = out
    return out
  })
  await pipeline(ids, ...steps)
}

const last = T.stages[T.stages.length - 1]
return { id: T.id, result: stageOut[last.id] ?? null, stages: stageOut, lanes: results, stopped: [...stopped] }
