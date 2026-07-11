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
import { readFileSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"

const PORT = Number(process.env.CONSOLE_PORT ?? 4600)
const MIND_URL = process.env.MIND_URL ?? "http://localhost:3000"
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:8787"
const BIFROST_URL = process.env.BIFROST_URL ?? "http://localhost:8080"
const APL_URL = process.env.APL_URL ?? "http://localhost:4319"
const SELFHEAL_URL = process.env.SELFHEAL_URL ?? "http://localhost:3100"
const OPS_URL = process.env.OPS_URL ?? "http://localhost:4700"
const MIND_TOKEN = process.env.MIND_TOKEN ?? "" // heartbeat MCP token, for the interactive "ask" box
const MIND_PG_HOST = process.env.MIND_PG_HOST ?? "localhost"
const MIND_PG = process.env.MIND_PG_PORT ?? "5435"
const APL_PG_HOST = process.env.APL_PG_HOST ?? "localhost"
const APL_PG = process.env.APL_PG_PORT ?? "5439"
const GATEWAY_DIR = process.env.GATEWAY_DIR ?? ""
const GATEWAY_EVIDENCE_FILE = process.env.GATEWAY_EVIDENCE_FILE ?? ""
const ASSURANCE_DIR = process.env.ASSURANCE_DIR ?? ""
const MANIFEST_SARIF = process.env.MANIFEST_SARIF ?? ""

const aplSql = new SQL(`postgresql://postgres:postgres@${APL_PG_HOST}:${APL_PG}/postgres`)
const mindSql = new SQL(`postgresql://postgres:mysecretpassword@${MIND_PG_HOST}:${MIND_PG}/postgres`)

const up = async (url: string): Promise<boolean> => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

const health = async () => {
  const [gateway, bifrost, mind, apl, sho, ops] = await Promise.all([
    up(`${GATEWAY_URL}/health`),
    up(`${BIFROST_URL}/health`),
    up(`${MIND_URL}/health`),
    up(`${APL_URL}/health`),
    up(`${SELFHEAL_URL}/status`),
    up(`${OPS_URL}/health`),
  ])
  // assurance is "up" only if the refresher actually produced a RECENT scan — a
  // stale/dead refresher must stop reporting green (freshness, not mere existence).
  const lr = lastRefresh()
  const scanAgeSec = lr ? (Date.now() - new Date(lr).getTime()) / 1000 : null
  const scanned = existsSync(sarifPath()) && (scanAgeSec === null || scanAgeSec < 600)
  return {
    // the full family — the run→remember→measure→heal→assure loop, governed by
    // the Standard (the contract).
    standard: { role: "the contract", up: true, kind: "contract" },
    ops: { role: "runtime & fleet", up: ops },
    gateway: { role: "model plane", up: gateway },
    bifrost: { role: "data plane", up: bifrost },
    mind: { role: "knowledge & memory", up: mind },
    performance: { role: "evals & observability", up: apl },
    selfheal: { role: "incidents & pager", up: sho },
    assurance: { role: "security & assurance", up: scanned, kind: "scan" },
    console: { role: "control plane", up: true },
  }
}

// where the periodic refresher writes the family scan + its timestamp
const sarifPath = (): string =>
  MANIFEST_SARIF !== "" ? MANIFEST_SARIF : join(ASSURANCE_DIR, "..", "..", "manifests", "agenticmind.sarif")
const lastRefresh = (): string | null => {
  try {
    const f = join(sarifPath(), "..", "last-refresh.txt")
    return existsSync(f) ? readFileSync(f, "utf8").trim() : null
  } catch {
    return null
  }
}

const selfheal = async () => {
  try {
    const [statusRes, incRes] = await Promise.all([
      fetch(`${SELFHEAL_URL}/status`, { signal: AbortSignal.timeout(2500) }),
      fetch(`${SELFHEAL_URL}/incidents?limit=6`, { signal: AbortSignal.timeout(2500) }),
    ])
    const status = statusRes.ok ? await statusRes.json() : {}
    const inc = incRes.ok ? await incRes.json() : { incidents: [] }
    return { mode: status.mode ?? "unknown", killed: status.killed ?? false, stats: status.incidents ?? {}, incidents: inc.incidents ?? [] }
  } catch {
    return { mode: "down", killed: false, stats: {}, incidents: [], error: "AgenticSelfHealingCode unreachable" }
  }
}

const fleet = async () => {
  try {
    const r = await fetch(`${OPS_URL}/fleet`, { signal: AbortSignal.timeout(2500) })
    if (!r.ok) throw new Error("bad status")
    const f = await r.json()
    return { agents: f.agents ?? [], backlog: f.backlog ?? {}, recent: f.recent ?? [] }
  } catch {
    return { agents: [], backlog: {}, recent: [], error: "AgenticOps fleet unreachable" }
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
    const f = GATEWAY_EVIDENCE_FILE !== "" ? GATEWAY_EVIDENCE_FILE : join(GATEWAY_DIR, "data", "evidence.jsonl")
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

// age (seconds) of the last routed LLM call — the freshest signal that the model
// plane is actually alive. Stale ⇒ the provider key likely expired / gateway down.
const lastCallAgeSec = (): number | null => {
  try {
    const f = GATEWAY_EVIDENCE_FILE !== "" ? GATEWAY_EVIDENCE_FILE : join(GATEWAY_DIR, "data", "evidence.jsonl")
    if (!existsSync(f)) return null
    return Math.round((Date.now() - statSync(f).mtimeMs) / 1000)
  } catch {
    return null
  }
}

// the one write path: ask AgenticMind a question (proxied MCP kl_ask_global) so the
// console is a tool you can act from, not just a dashboard.
const ask = async (req: Request) => {
  try {
    const { question } = (await req.json()) as { question?: string }
    if (!question || typeof question !== "string") return { error: "question required" }
    if (MIND_TOKEN === "") return { error: "no MCP token — restart the console after `agentic up`" }
    const r = await fetch(`${MIND_URL}/mcp`, {
      method: "POST",
      signal: AbortSignal.timeout(40000),
      headers: { Authorization: `Bearer ${MIND_TOKEN}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "kl_ask_global", arguments: { question } } }),
    })
    if (!r.ok) return { error: `Mind ${r.status}` }
    const raw = await r.text()
    for (const line of raw.split("\n")) {
      const s = line.replace(/^data:\s*/, "").trim()
      if (!s) continue
      try {
        const t = JSON.parse(s)?.result?.content?.[0]?.text
        if (typeof t === "string") {
          try {
            return { answer: JSON.parse(t).answer ?? t }
          } catch {
            return { answer: t }
          }
        }
      } catch {
        /* not the result frame */
      }
    }
    return { answer: "" }
  } catch (e) {
    return { error: "ask failed: " + (e instanceof Error ? e.message : String(e)) }
  }
}

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } })

Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === "/api/ask" && req.method === "POST") return json(await ask(req))
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
      case "/api/selfheal":
        return json(await selfheal())
      case "/api/fleet":
        return json(await fleet())
      case "/api/overview": {
        const [h, t, m, s, fl] = await Promise.all([health(), traces(), memory(), selfheal(), fleet()])
        return json({
          health: h,
          spans: t.rows.length,
          agents: t.agents,
          cost: cost(),
          findings: findings(),
          memory: m,
          selfheal: s,
          fleet: fl,
          lastRefresh: lastRefresh(),
          lastCallAgeSec: lastCallAgeSec(),
          now: new Date().toISOString(),
        })
      }
      case "/":
      case "/index.html":
        return new Response(Bun.file(join(import.meta.dir, "..", "web", "index.html")))
      // PWA assets — lets the console install as a desktop app (Add to Dock)
      case "/manifest.webmanifest":
      case "/icon-512.png":
      case "/icon-192.png":
      case "/apple-touch-icon.png": {
        const f = Bun.file(join(import.meta.dir, "..", "web", pathname.slice(1)))
        return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 })
      }
      default:
        return new Response("not found", { status: 404 })
    }
  },
})
// eslint-disable-next-line no-console
console.log(`[console] Agentic Platform console on http://localhost:${PORT}`)
