/**
 * incident-forwarder — turns the platform's REAL operational failures into
 * AgenticSelfHealingCode signals. Self-contained platform self-monitoring.
 *
 * Source 1: the AgenticGateway ledger (evidence.jsonl) — every routed LLM call, incl.
 * failures (outcome matches /error|timeout|fail|exceeded/). A genuine failure is a real
 * incident; a success is skipped. We normalize the failure into a signed IncidentCandidate
 * and POST it to self-heal /webhook/otel (HMAC over the body with SIGNAL_SECRET). NO
 * fabrication — it only fires when a real call actually failed. A line-offset in a durable
 * volume prevents re-forwarding on restart; self-heal's notify-CAS dedups repeats by class.
 *
 * Source 2: a health WATCHDOG over the core services (direct /health pings). Docker's
 * restart policy revives a crashed process, but a hung or manually-stopped service just
 * sits there — the console shows a red dot and nobody gets paged. The watchdog pages:
 * two consecutive failed pings (~60s) → ONE signed incident per outage (re-armed only
 * after the service recovers). Caveat by design: if self-heal itself is down, there is
 * nobody to page through — that one shows only in the console/menu bar.
 */
import { createHmac, randomUUID } from "node:crypto"
import { readFileSync, existsSync, writeFileSync } from "node:fs"

const LEDGER = process.env.LEDGER_FILE ?? "/gateway-data/evidence.jsonl"
const STATE = process.env.STATE_FILE ?? "/state/forwarder.offset"
const SELFHEAL = process.env.SELFHEAL_URL ?? "http://selfheal:3000"
const SECRET = process.env.SIGNAL_SECRET ?? ""
const INTERVAL = Number(process.env.INTERVAL ?? 30) * 1000
const FAIL_RE = /error|timeout|fail|exceeded|exhausted|refused/i

const readOffset = (): number => {
  try {
    return Number(readFileSync(STATE, "utf8").trim()) || 0
  } catch {
    return 0
  }
}
const writeOffset = (n: number): void => {
  try {
    writeFileSync(STATE, String(n))
  } catch {
    /* best effort */
  }
}

const toCandidate = (e: Record<string, unknown>) => {
  const route = String(e.route ?? "unknown")
  const outcome = String(e.outcome ?? "error")
  const svc = route.split("/")[0] || "gateway"
  return {
    id: randomUUID(),
    source: "otel",
    fingerprint: `${outcome}:${route}`,
    severity: /exceeded|exhausted/i.test(outcome) ? 4 : 3,
    first_seen: typeof e.ts === "string" ? e.ts : new Date().toISOString(),
    occurrences: 1,
    affected_service: `gateway/${svc}`,
    affected_paths: [] as string[],
    recent_deploys: [] as unknown[],
    shape: "spike",
    raw_payload: {
      error_class: outcome,
      message: `AgenticGateway ${outcome} routing '${route}'`,
      title: `LLM route failure: ${route}`,
      route,
      tenant: e.tenant_id,
      session: e.session_id,
    },
  }
}

const signal = async (candidate: unknown): Promise<boolean> => {
  const body = JSON.stringify(candidate)
  const sig = createHmac("sha256", SECRET).update(body, "utf8").digest("hex")
  const r = await fetch(`${SELFHEAL}/webhook/otel`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": sig },
    body,
    signal: AbortSignal.timeout(120_000),
  })
  return r.ok
}

// ── health watchdog ────────────────────────────────────────
// Targets are instance-specific: WATCHDOG_SERVICES="name=url,name=url" overrides
// the default platform set (a product engine without the fleet profile must not
// watch ops-runner, or it would page a service that isn't deployed).
const DEFAULT_WATCH: Record<string, string> = {
  gateway: "http://gateway:8787/health",
  bifrost: "http://bifrost:8080/health",
  mind: "http://mind-server:3000/health",
  performance: "http://apl-ingest:4319/health",
  "ops-runner": "http://ops-runner:4700/health",
  console: "http://console:4600/api/health",
}
const WATCH: Record<string, string> = (() => {
  const spec = (process.env.WATCHDOG_SERVICES ?? "").trim()
  if (spec === "") return DEFAULT_WATCH
  const out: Record<string, string> = {}
  for (const pair of spec.split(",")) {
    const i = pair.indexOf("=")
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
  }
  return Object.keys(out).length > 0 ? out : DEFAULT_WATCH
})()
const DOWN_AFTER = 2 // consecutive failed pings before paging (~2×INTERVAL)
const streak: Record<string, number> = {}
const paged: Record<string, boolean> = {}

const downCandidate = (name: string, url: string, fails: number) => ({
  id: randomUUID(),
  source: "otel",
  fingerprint: `service.down:${name}`,
  severity: 4,
  first_seen: new Date().toISOString(),
  occurrences: fails,
  affected_service: `platform/${name}`,
  affected_paths: ["deploy/docker-compose.yml"],
  recent_deploys: [] as unknown[],
  shape: "step",
  raw_payload: {
    error_class: "service.down",
    message: `${name} failed ${fails} consecutive health checks (${url})`,
    title: `platform service DOWN: ${name}`,
  },
})

async function watchdogTick(): Promise<void> {
  for (const [name, url] of Object.entries(WATCH)) {
    let up = false
    try {
      up = (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok
    } catch {
      /* down */
    }
    if (up) {
      if (paged[name]) console.log(`[watchdog] ${name} recovered`) // eslint-disable-line no-console
      streak[name] = 0
      paged[name] = false
      continue
    }
    streak[name] = (streak[name] ?? 0) + 1
    if (streak[name] >= DOWN_AFTER && !paged[name]) {
      paged[name] = true // one page per outage; re-arms on recovery
      try {
        const ok = await signal(downCandidate(name, url, streak[name]))
        // eslint-disable-next-line no-console
        console.log(`[watchdog] ${ok ? "→ paged" : "✗ page failed"}: ${name} DOWN`)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(`[watchdog] error paging ${name}: ${String(err).slice(0, 140)}`)
      }
    }
  }
}

async function tick(): Promise<void> {
  await watchdogTick().catch(() => {})
  if (!existsSync(LEDGER)) return
  const lines = readFileSync(LEDGER, "utf8").split("\n").filter(Boolean)
  let off = readOffset()
  if (off > lines.length) off = 0 // ledger rotated/truncated → replay from start
  let processed = off
  for (const line of lines.slice(off)) {
    processed++
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (!FAIL_RE.test(String(e.outcome ?? ""))) continue
    try {
      const ok = await signal(toCandidate(e))
      // eslint-disable-next-line no-console
      console.log(`[forwarder] ${ok ? "→ signalled" : "✗ post failed"}: ${e.outcome} ${e.route}`)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`[forwarder] error: ${String(err).slice(0, 140)}`)
    }
  }
  writeOffset(processed)
}

// eslint-disable-next-line no-console
console.log(`[incident-forwarder] watching ${LEDGER} → ${SELFHEAL}/webhook/otel every ${INTERVAL / 1000}s (real failures only)`)
setInterval(() => void tick().catch(() => {}), INTERVAL)
void tick().catch(() => {})
