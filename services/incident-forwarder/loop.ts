/**
 * incident-forwarder — turns the platform's REAL operational failures into
 * AgenticSelfHealingCode signals. Self-contained platform self-monitoring.
 *
 * Source: the AgenticGateway ledger (evidence.jsonl) — every routed LLM call, incl.
 * failures (outcome matches /error|timeout|fail|exceeded/). A genuine failure is a real
 * incident; a success is skipped. We normalize the failure into a signed IncidentCandidate
 * and POST it to self-heal /webhook/otel (HMAC over the body with SIGNAL_SECRET). NO
 * fabrication — it only fires when a real call actually failed. A line-offset in a durable
 * volume prevents re-forwarding on restart; self-heal's notify-CAS dedups repeats by class.
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

async function tick(): Promise<void> {
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
