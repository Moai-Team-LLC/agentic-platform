/**
 * Agentic Platform — console BFF.
 *
 * One backend-for-frontend that aggregates the live ecosystem into a single pane:
 *   health (all services) · traces + evals (AgenticPerformance) · cost + routes
 *   (AgenticGateway evidence) · security findings (AgenticAssurance) · knowledge
 *   & memory (AgenticMind). Read-only; degrades gracefully when a service is down.
 *
 * Configured entirely by env (the `agentic` CLI wires these):
 *   MIND_URL, MIND_PG_PORT, APL_PG_PORT, GATEWAY_DIR, ASSURANCE_DIR, CONSOLE_PORT
 */
import { SQL } from "bun"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const PORT = Number(process.env.CONSOLE_PORT ?? 4600)
const MIND_URL = process.env.MIND_URL ?? "http://localhost:3000"
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:8787"
const BIFROST_URL = process.env.BIFROST_URL ?? "http://localhost:8080"
const APL_URL = process.env.APL_URL ?? "http://localhost:4319"
const MIND_PG = process.env.MIND_PG_PORT ?? "5435"
const APL_PG = process.env.APL_PG_PORT ?? "5439"
const GATEWAY_DIR = process.env.GATEWAY_DIR ?? ""
const ASSURANCE_DIR = process.env.ASSURANCE_DIR ?? ""
const MANIFEST_SARIF = process.env.MANIFEST_SARIF ?? ""

const aplSql = new SQL(`postgresql://postgres:postgres@localhost:${APL_PG}/postgres`)
const mindSql = new SQL(`postgresql://postgres:mysecretpassword@localhost:${MIND_PG}/postgres`)

const up = async (url: string): Promise<boolean> => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

const health = async () => {
  const [gateway, bifrost, mind, apl] = await Promise.all([
    up(`${GATEWAY_URL}/health`),
    up(`${BIFROST_URL}/health`),
    up(`${MIND_URL}/health`),
    up(`${APL_URL}/health`),
  ])
  return {
    // layer → { role, up } — the run→remember→measure→heal→assure loop
    gateway: { role: "model plane", up: gateway },
    bifrost: { role: "data plane", up: bifrost },
    mind: { role: "knowledge & memory", up: mind },
    performance: { role: "evals & observability", up: apl },
    console: { role: "control plane", up: true },
  }
}

const traces = async () => {
  try {
    const rows = await aplSql`
      select coalesce(agent_id,'—') as agent, operation, name,
             coalesce((attributes->>'gen_ai.usage.input_tokens')::int,0)
               + coalesce((attributes->>'gen_ai.usage.output_tokens')::int,0) as tokens,
             start_ts
      from apl_span order by start_ts desc limit 40`
    const agents = await aplSql`select coalesce(agent_id,'—') as agent, count(*) n from apl_span group by 1 order by 2 desc`
    return { rows, agents }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[traces] error:", e instanceof Error ? e.message : e)
    return { rows: [], agents: [], error: "AgenticPerformance store unreachable" }
  }
}

const cost = () => {
  try {
    const f = join(GATEWAY_DIR, "data", "evidence.jsonl")
    if (!existsSync(f)) return { total: 0, calls: 0, byRoute: [], recent: [] }
    const lines = readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    const calls = lines.length
    const total = lines.reduce((s, e) => s + (e.cost_usd ?? 0), 0)
    const byRouteMap = new Map<string, { n: number; cost: number }>()
    for (const e of lines) {
      const k = e.route ?? "unknown"
      const cur = byRouteMap.get(k) ?? { n: 0, cost: 0 }
      byRouteMap.set(k, { n: cur.n + 1, cost: cur.cost + (e.cost_usd ?? 0) })
    }
    const byRoute = [...byRouteMap.entries()].map(([route, v]) => ({ route, ...v })).sort((a, b) => b.n - a.n)
    const recent = lines.slice(-15).reverse().map((e) => ({ route: e.route, cost: e.cost_usd, outcome: e.outcome, tenant: e.tenant_id }))
    return { total, calls, byRoute, recent }
  } catch {
    return { total: 0, calls: 0, byRoute: [], recent: [], error: "gateway evidence unreadable" }
  }
}

const findings = () => {
  // Read the most recent SARIF the platform produced (assurance scans of the family).
  const candidates = [
    MANIFEST_SARIF,
    join(ASSURANCE_DIR, "..", "..", "manifests", "agenticmind.sarif"),
    join(ASSURANCE_DIR, "out.sarif"),
  ].filter(Boolean)
  for (const f of candidates) {
    try {
      if (!existsSync(f)) continue
      const sarif = JSON.parse(readFileSync(f, "utf8"))
      const results = sarif.runs?.[0]?.results ?? []
      const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<string, number>
      const items = results.map((r: any) => {
        const level = r.level ?? "note"
        const sev = level === "error" ? "critical" : level === "warning" ? "high" : "info"
        bySeverity[sev] = (bySeverity[sev] ?? 0) + 1
        return { rule: r.ruleId, level: sev, message: r.message?.text ?? "" }
      })
      return { file: f.split("/").pop(), total: results.length, bySeverity, items: items.slice(0, 12) }
    } catch {
      /* try next */
    }
  }
  return { file: null, total: 0, bySeverity: {}, items: [], note: "run `agentic demo` to scan the family" }
}

const memory = async () => {
  try {
    const [beliefs] = await mindSql`select count(*)::int n from beliefs`
    const [materials] = await mindSql`select count(*)::int n from materials`
    const recent = await mindSql`select subject, predicate, left(object,80) as object from beliefs order by created_at desc limit 8`
    return { beliefs: beliefs?.n ?? 0, materials: materials?.n ?? 0, recent }
  } catch {
    return { beliefs: 0, materials: 0, recent: [], error: "AgenticMind store unreachable" }
  }
}

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } })

Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url)
    switch (pathname) {
      case "/api/health":
        return json(await health())
      case "/api/traces":
        return json(await traces())
      case "/api/cost":
        return json(cost())
      case "/api/findings":
        return json(findings())
      case "/api/memory":
        return json(await memory())
      case "/api/overview": {
        const [h, t, m] = await Promise.all([health(), traces(), memory()])
        return json({ health: h, spans: t.rows.length, agents: t.agents, cost: cost(), findings: findings(), memory: m })
      }
      case "/":
      case "/index.html":
        return new Response(Bun.file(join(import.meta.dir, "..", "web", "index.html")))
      default:
        return new Response("not found", { status: 404 })
    }
  },
})
// eslint-disable-next-line no-console
console.log(`[console] Agentic Platform console on http://localhost:${PORT}`)
