/**
 * ops-runner — a thin service around the AgenticOps library so the platform has
 * a *live* fleet the console can observe. AgenticOps ships no server (it's a
 * runtime library); this wires its primitives — manifests → scheduler → durable
 * backlog → bounded run → telemetry — into a demo fleet, and exposes GET /fleet
 * + /health.
 *
 * REAL WORK: when a gateway tenant key + a Mind MCP token are present (armed by
 * `agentic up`), each scheduled run is a genuine bounded agent — it grounds on
 * AgenticMind's knowledge (kl_ask), reasons through AgenticGateway (the model
 * plane), and writes what it learned back into AgenticMind's memory (mem_write).
 * So the fleet's work shows up as real traces (Performance), cost (Gateway) and
 * memory (Mind) — the loop exercising itself. Without the tokens it degrades to
 * a heartbeat-only fleet (still live, no LLM spend).
 *
 * Mounted at /app/server.ts, so `./src/index` resolves to the vendored library.
 */
import { createHmac, randomUUID } from "node:crypto"
import {
  AgentManifest,
  Backlog,
  CallPolicy,
  runAgent,
  Scheduler,
  Telemetry,
} from "./src/index"

const MIND_URL = process.env.MIND_URL ?? "http://mind-server:3000"
const MIND_TOKEN = process.env.MIND_TOKEN ?? ""
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://gateway:8787"
const GATEWAY_KEY = process.env.GATEWAY_KEY ?? ""
const GATEWAY_MODEL = process.env.GATEWAY_MODEL ?? "openrouter/openai/gpt-4o-mini"
const FLEET_CRON = process.env.FLEET_CRON ?? "*/10 * * * *" // real work every 10 min (cost-modest)
const REAL = MIND_TOKEN !== "" && GATEWAY_KEY !== ""
const SELFHEAL_URL = process.env.SELFHEAL_URL ?? ""
const SIGNAL_SECRET = process.env.SIGNAL_SECRET ?? ""

/** Report a REAL fleet failure to AgenticSelfHealingCode (signed, fire-and-forget —
 *  self-heal being down must never break the fleet). The affected path is the actual
 *  executor code, so RCA can git-blame the platform's own repo. */
function reportIncident(agent: string, kind: string, message: string): void {
  if (SELFHEAL_URL === "" || SIGNAL_SECRET === "") return
  const body = JSON.stringify({
    id: randomUUID(),
    source: "otel",
    fingerprint: `${kind}:${agent}`,
    severity: 3,
    first_seen: new Date().toISOString(),
    occurrences: 1,
    affected_service: `fleet/${agent}`,
    affected_paths: ["services/ops-runner/server.ts"],
    recent_deploys: [],
    shape: "spike",
    raw_payload: { error_class: kind, message, title: `fleet ${agent}: ${kind}` },
  })
  const sig = createHmac("sha256", SIGNAL_SECRET).update(body, "utf8").digest("hex")
  void fetch(`${SELFHEAL_URL}/webhook/otel`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": sig },
    body,
    signal: AbortSignal.timeout(60_000),
  }).catch(() => {})
}

const mk = (name: string, model: string, mayCall: string[] = []) =>
  AgentManifest.parse({
    name,
    runtime: "claude-code",
    model,
    instructionsPath: `./agents/${name}/CLAUDE.md`,
    limits: { maxTurns: 4, timeoutMs: 90_000 },
    ...(mayCall.length ? { mayCall } : {}),
  })

// Each agent has a role-specific question it grounds on.
const AGENTS: { m: ReturnType<typeof mk>; question: string }[] = [
  { m: mk("scout", "claude-opus-4-8", ["sage"]), question: "What are the products in the agentic platform and each one's role?" },
  { m: mk("analyst", "claude-sonnet-5"), question: "What routes every LLM call and how is per-run cost tracked?" },
  { m: mk("sage", "claude-sonnet-5"), question: "What red-teams the agents, and what does a scan of AgenticMind find?" },
]
const byName = new Map(AGENTS.map((a) => [a.m.name, a]))
const policy = new CallPolicy(AGENTS.map((a) => a.m))
const backlog = new Backlog(":memory:")
const scheduler = new Scheduler(backlog, ":memory:")
const telemetry = new Telemetry(":memory:")

for (const { m } of AGENTS) scheduler.register(m.name, FLEET_CRON, m.name, { goal: "grounded status sweep" }, "UTC", Date.now())

// ── executors ──────────────────────────────────────────────
// Honour the runner's AbortSignal (so runAgent's timeout can cancel an in-flight
// turn) AND a per-call ceiling.
const withDeadline = (signal: AbortSignal, ms: number): AbortSignal =>
  AbortSignal.any([signal, AbortSignal.timeout(ms)])

/** Call a Mind MCP tool, parse the SSE, return the result's text (throws on error). */
async function mcpCall(name: string, args: unknown, signal: AbortSignal): Promise<string> {
  const res = await fetch(`${MIND_URL}/mcp`, {
    method: "POST",
    signal: withDeadline(signal, 75_000),
    headers: {
      Authorization: `Bearer ${MIND_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  })
  if (!res.ok) throw new Error(`mind ${name} HTTP ${res.status}`)
  const raw = await res.text()
  for (const line of raw.split("\n")) {
    const s = line.replace(/^data:\s*/, "").trim()
    if (!s) continue
    let d: { result?: { isError?: boolean; content?: { text?: string }[] } }
    try {
      d = JSON.parse(s)
    } catch {
      continue // not a JSON frame
    }
    const r = d?.result
    if (r === undefined) continue
    if (r.isError) throw new Error(`mind ${name} tool error`) // never treat an error frame as a fact
    const t = r.content?.[0]?.text
    if (typeof t === "string") return t
  }
  return ""
}
/** One chat completion through the gateway (the model plane). */
async function gatewayChat(prompt: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    signal: withDeadline(signal, 60_000),
    headers: { Authorization: `Bearer ${GATEWAY_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: GATEWAY_MODEL, messages: [{ role: "user", content: prompt }] }),
  })
  if (!res.ok) throw new Error(`gateway HTTP ${res.status}`)
  const d = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return d?.choices?.[0]?.message?.content ?? ""
}

/** A real, bounded agent turn: gather (kl_ask) → reason (gateway) → act (mem_write).
 *  runAgent is 1-based (turn = 1,2,3…), so normalise to a 0-based step. */
function makeRealTurn(agentName: string, question: string) {
  let answer = ""
  let insight = ""
  return async ({ turn, signal }: { turn: number; signal: AbortSignal }): Promise<{ done: boolean }> => {
    const step = turn - 1
    try {
      if (step === 0) {
        telemetry.audit({ agent: agentName, kind: "tool", action: "kl_ask", detail: { q: question } })
        const t = await mcpCall("kl_ask_global", { question }, signal)
        try {
          answer = (JSON.parse(t) as { answer?: string }).answer ?? t
        } catch {
          answer = t
        }
        return { done: answer === "" } // nothing grounded → stop, don't fabricate
      }
      if (step === 1) {
        telemetry.audit({ agent: agentName, kind: "tool", action: "synthesize" })
        insight = await gatewayChat(`In ONE terse sentence for an ops log, state the key fact: ${answer.slice(0, 700)}`, signal)
        return { done: false }
      }
      telemetry.audit({ agent: agentName, kind: "tool", action: "mem_write" })
      await mcpCall(
        "mem_write",
        { subject: `fleet/${agentName}`, predicate: "observed", object: (insight || answer).slice(0, 220), confidence: 0.7 },
        signal,
      )
      return { done: true }
    } catch (e) {
      telemetry.audit({ agent: agentName, kind: "error", action: "turn.failed", detail: { turn, err: String(e).slice(0, 140) } })
      reportIncident(agentName, "turn.failed", String(e).slice(0, 300)) // real failure → self-heal
      return { done: true } // finish gracefully — bounded, never hang
    }
  }
}
const fakeTurn = async (): Promise<{ done: boolean }> => ({ done: true })

// Lease must outlive a bounded run (manifest timeoutMs=90s) so a slow run is
// never re-claimed and duplicated while still in flight.
const LEASE_MS = 130_000
let ticking = false
async function tick(): Promise<void> {
  if (ticking) return // single-flight: never overlap ticks (no concurrent duplicate runs)
  ticking = true
  try {
    const now = Date.now()
    for (const { m } of AGENTS) telemetry.heartbeat(m.name, "ok") // liveness between runs
    scheduler.tick(now)
    let task = backlog.claim({ leaseMs: LEASE_MS })
    while (task) {
      const a = byName.get(task.agent) ?? AGENTS[0]
      telemetry.audit({ agent: task.agent, kind: "lifecycle", action: "run.started", detail: task.payload })
      const outcome = await runAgent(a.m, REAL ? makeRealTurn(a.m.name, a.question) : fakeTurn)
      telemetry.audit({ agent: task.agent, kind: "lifecycle", action: `run.${outcome.status}`, detail: { turns: outcome.turns } })
      // Always terminally ack: complete on success, else fail() so it parks after
      // maxAttempts instead of being re-claimed and re-spent forever.
      if (outcome.status === "completed") backlog.complete(task.id)
      else {
        backlog.fail(task.id)
        reportIncident(task.agent, `run.${outcome.status}`, `bounded run ended ${outcome.status} after ${outcome.turns} turn(s)`)
      }
      task = backlog.claim({ leaseMs: LEASE_MS })
    }
  } finally {
    ticking = false
  }
}

setInterval(() => void tick().catch(() => {}), 20_000)
void tick().catch(() => {})

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } })
Bun.serve({
  port: Number(process.env.PORT ?? 4700),
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === "/health") return json({ ok: true, service: "ops-runner", mode: REAL ? "real" : "heartbeat" })
    if (pathname === "/fleet") {
      return json({
        mode: REAL ? "real" : "heartbeat",
        agents: telemetry.health(),
        backlog: backlog.stats(),
        recent: telemetry
          .recent()
          .slice(-16)
          .reverse()
          .map((e) => ({ agent: e.agent, kind: e.kind, action: e.action })),
      })
    }
    return new Response("not found", { status: 404 })
  },
})
// eslint-disable-next-line no-console
console.log(`[ops-runner] AgenticOps fleet on :${process.env.PORT ?? 4700} — mode=${REAL ? "real (grounded agents)" : "heartbeat (no tokens)"}`)
