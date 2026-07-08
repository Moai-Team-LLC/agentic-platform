/**
 * ops-runner — a thin service around the AgenticOps library so the platform has
 * a *live* fleet the console can observe. AgenticOps ships no server (it's a
 * runtime library); this wires its primitives — manifests → scheduler → durable
 * backlog → bounded run → telemetry — into a demo fleet that ticks continuously,
 * and exposes GET /fleet (agent health, backlog stats, recent audit) + /health.
 *
 * Mounted into the AgenticOps image at /app/server.ts, so `./src/index` resolves
 * to the vendored library. The fleet work is simulated (no real agent runtime) —
 * this is the operations plane, not the agents themselves.
 */
import {
  AgentManifest,
  Backlog,
  CallPolicy,
  delegate,
  runAgent,
  Scheduler,
  Telemetry,
} from "./src/index"

const mk = (name: string, model: string, mayCall: string[] = []) =>
  AgentManifest.parse({
    name,
    runtime: "claude-code",
    model,
    instructionsPath: `./agents/${name}/CLAUDE.md`,
    limits: { maxTurns: 6, timeoutMs: 8000 },
    ...(mayCall.length ? { mayCall } : {}),
  })

const fleet = [
  mk("scout", "claude-opus-4-8", ["sage"]),
  mk("sage", "claude-sonnet-5"),
  mk("analyst", "claude-sonnet-5", ["scout"]),
]
const byName = new Map(fleet.map((a) => [a.name, a]))
const policy = new CallPolicy(fleet)
const backlog = new Backlog(":memory:")
const scheduler = new Scheduler(backlog, ":memory:")
const telemetry = new Telemetry(":memory:")

// Arm each agent on a once-a-minute schedule.
for (const a of fleet) scheduler.register(a.name, "* * * * *", a.name, { goal: "scheduled sweep" }, "UTC", Date.now())

let ticks = 0
async function tick(): Promise<void> {
  const now = Date.now()
  scheduler.tick(now)
  let task = backlog.claim()
  while (task) {
    const m = byName.get(task.agent) ?? fleet[0]
    telemetry.audit({ agent: task.agent, kind: "lifecycle", action: "run.started", detail: task.payload })
    telemetry.heartbeat(task.agent, "ok")
    const outcome = await runAgent(m, async ({ turn }) => {
      telemetry.audit({ agent: m.name, kind: "tool", action: "work", detail: { turn } })
      return { done: true }
    })
    telemetry.audit({ agent: task.agent, kind: "lifecycle", action: `run.${outcome.status}`, detail: { turns: outcome.turns } })
    if (outcome.status === "completed") backlog.complete(task.id)
    task = backlog.claim()
  }
  // Exercise enforced delegation occasionally (scout → sage is allowed).
  if (ticks % 3 === 0) {
    try {
      delegate({ policy, backlog, telemetry }, "scout", "sage", { ask: "deep-dive the top finding" })
    } catch {
      /* denied — expected for some pairs */
    }
  }
  ticks += 1
}

setInterval(() => void tick().catch(() => {}), 20_000)
void tick()

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } })

Bun.serve({
  port: Number(process.env.PORT ?? 4700),
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === "/health") return json({ ok: true, service: "ops-runner" })
    if (pathname === "/fleet") {
      return json({
        agents: telemetry.health(),
        backlog: backlog.stats(),
        recent: telemetry
          .recent()
          .slice(-14)
          .reverse()
          .map((e) => ({ agent: e.agent, kind: e.kind, action: e.action })),
      })
    }
    return new Response("not found", { status: 404 })
  },
})
// eslint-disable-next-line no-console
console.log(`[ops-runner] AgenticOps fleet telemetry on :${process.env.PORT ?? 4700}`)
