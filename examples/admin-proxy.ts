/**
 * admin-proxy — reference pattern for surfacing an Agentic engine's console data
 * inside YOUR product's admin panel, safely.
 *
 * The engine BFF (console) has NO auth and is private-network only (see
 * docs/CONSOLE-API.md). This file is the boundary that makes it safe to expose in a
 * product: your authenticated admin backend calls the BFF over the private network,
 * enforces YOUR authz, scopes to the caller's tenant, and returns only their slice.
 * The browser NEVER talks to the BFF directly.
 *
 * Framework-agnostic core + an Express-style handler. Adapt to your stack (Next.js
 * route handler, NestJS controller, Fastify, …) — the three rules are what matter:
 *   1. authenticate + authorize BEFORE you fetch the engine
 *   2. reach the engine over the PRIVATE network (never a public URL)
 *   3. scope the aggregate to the caller's tenant before returning
 */

// ── config (server-side only — never shipped to the browser) ──────────────
// From the engine's handout.md. Co-located: http://127.0.0.1:<CONSOLE_PORT>.
// Separate host: the engine's PRIVATE IP. Must NOT be a public interface.
const ENGINE_BFF = process.env.ENGINE_BFF_URL ?? "http://127.0.0.1:4914"

/** Fetch a read-only endpoint from the engine BFF (server-side). */
async function engineBff<T>(path: string): Promise<T> {
  const r = await fetch(`${ENGINE_BFF}${path}`, { signal: AbortSignal.timeout(5000) })
  if (!r.ok) throw new Error(`engine BFF ${path} → ${r.status}`)
  return (await r.json()) as T
}

// ── tenant scoping — the aggregate BFF → this tenant's slice ──────────────
// The BFF returns the whole engine (all cost, all memory). Filter to the caller.
function scopeToTenant(overview: any, tenantId: string) {
  const prefix = `tenant:${tenantId}/`
  const mine = (overview.cost?.byTenant ?? []).find((t: any) => t.tenant === tenantId) ?? { n: 0, cost: 0 }
  return {
    // BFF pre-aggregates spend per tenant → take this tenant's row (never the global total)
    cost: {
      calls: mine.n,
      total: mine.cost,
      recent: (overview.cost?.recent ?? []).filter((e: any) => e.tenant === tenantId),
    },
    // memory beliefs are namespaced by the tenant:<id>/… subject convention
    memory: {
      recent: (overview.memory?.recent ?? []).filter((b: any) => String(b.subject ?? "").startsWith(prefix)),
    },
    // health / model-plane liveness are engine-wide (not tenant data) — safe to pass
    health: overview.health,
    modelPlaneIdle: (overview.lastCallAgeSec ?? 0) > 600,
    at: overview.now,
  }
}

// ── Express-style handler: GET /admin/ai-ops ──────────────────────────────
// Replace `req.user` / `requireAdmin` with your own auth. This is the whole point:
// nothing reaches the engine until the caller is authenticated + authorized.
export async function adminAiOps(req: any, res: any) {
  // 1. YOUR auth — reject before touching the engine
  const user = req.user // populated by your session/auth middleware
  if (!user || !user.isAdmin) return res.status(403).json({ error: "forbidden" })

  try {
    // 2. private-network call to the engine BFF
    const overview = await engineBff<any>("/api/overview")

    // 3. scope to the admin's tenant (a tenant admin sees only their slice;
    //    a platform/staff admin could get the raw aggregate instead — your call)
    const payload = user.isStaff ? overview : scopeToTenant(overview, user.tenantId)
    res.json(payload)
  } catch (e) {
    // engine down must not 500 your admin — degrade
    res.status(200).json({ error: "engine unavailable", detail: String(e).slice(0, 120) })
  }
}

// ── optional: proxy the "ask" path (POST) behind admin auth ───────────────
export async function adminAsk(req: any, res: any) {
  const user = req.user
  if (!user || !user.isAdmin) return res.status(403).json({ error: "forbidden" })
  const question = String(req.body?.question ?? "").slice(0, 2000)
  if (!question) return res.status(400).json({ error: "question required" })
  try {
    const r = await fetch(`${ENGINE_BFF}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(40_000),
    })
    res.json(await r.json())
  } catch (e) {
    res.status(200).json({ error: "engine unavailable" })
  }
}

/*
 * Wiring (Express):
 *   app.get("/admin/ai-ops", adminAiOps)   // your admin UI polls this every ~4s
 *   app.post("/admin/ai-ask", adminAsk)
 *
 * Your admin UI (React/etc.) fetches YOUR routes (/admin/ai-ops), never the engine.
 * It renders the cost/memory/health slice in your own design — see docs/CONSOLE-API.md
 * for the field shapes. The prebuilt console page (http://<engine>:<port>) stays a
 * private operator tool; it is not what you embed.
 */
