# Console API — embed engine data in your product

The console is a read-only **BFF** (backend-for-frontend): a JSON API over the running
engine — health, cost, memory, traces, incidents, fleet — plus a default dashboard page.
Every engine instance serves one. To surface engine data inside your own product (e.g. an
admin panel), **consume this API from your backend** — don't iframe the page.

## ⚠️ Security model — read this first

The BFF has **NO authentication**. It is bound to `127.0.0.1` on purpose: it exposes
memory, cost and health with zero access control. Therefore:

- **Never expose the BFF — or the console page — to the public internet.**
- Integrate through **your product's authenticated backend**: your admin server calls the
  BFF over the **private network**, enforces **your** auth/authorization, and returns only
  what the signed-in admin may see. The browser never talks to the BFF directly.
- Reference implementation: [`examples/admin-proxy.ts`](../examples/admin-proxy.ts).

## Base URL

`http://<engine-host>:<CONSOLE_PORT>` — private only.
- Co-located (engine on the same host as your app): `http://127.0.0.1:<CONSOLE_PORT>`.
- Separate host: the engine's **private** IP (never a public interface).

`CONSOLE_PORT` is `4600` for the platform's own instance, or the `agentic init` base+4 for a
product engine (e.g. `4914` for `init … 4910`). All ports come from the engine's `handout.md`.

## Endpoints — all GET, JSON, read-only

### `GET /api/overview` — one call, everything (poll ~4s)
```jsonc
{
  "health":   { "<svc>": { "role": str, "up": bool, "kind?": str, "active?": bool } },
  "spans":    int,
  "agents":   [ { "agent": str, "n": str } ],
  "cost":     { "total": float, "calls": int,
                "byRoute":  [ { "route": str, "n": int, "cost": float } ],
                "byTenant": [ { "tenant": str, "n": int, "cost": float } ],   // per-tenant spend, desc by cost
                "recent":   [ { "route": str, "cost": float, "outcome": str, "tenant": str } ] },
  "findings": { "file": str, "total": int,
                "bySeverity": { "critical": int, "high": int, "medium": int, "low": int, "info": int },
                "items": [ { "rule": str, "level": str, "message": str } ] },
  "memory":   { "beliefs": int, "materials": int,
                "recent": [ { "subject": str, "predicate": str, "object": str } ] },
  "selfheal": { "mode": str, "killed": bool,
                "stats": { "total": int, "delivered": int, "escalated": int, "suspicious": int, "acked": int },
                "incidents": [ … ] },
  "fleet":    { "agents": [ { "agent": str, "status": str, "lastSeen": int, "stale": bool } ],
                "backlog": { "pending": int, "leased": int, "failed": int },
                "recent":  [ { "agent": str, "kind": str, "action": str } ] },
  "lastRefresh":    isoString,
  "lastCallAgeSec": int,          // age of the last routed LLM call — model-plane liveness
  "now":            isoString
}
```

### The granular endpoints (same data, split — use these to poll only what you render)
| Endpoint | Shape |
|---|---|
| `GET /api/health`   | `{ "<svc>": { role, up, kind?, active? } }` — `active:false` = not deployed in this engine's profile (render "off", not "down") |
| `GET /api/cost`     | `{ total, calls, byRoute:[{route,n,cost}], byTenant:[{tenant,n,cost}], recent:[{route,cost,outcome,tenant}] }` |
| `GET /api/memory`   | `{ beliefs, materials, recent:[{subject,predicate,object}] }` |
| `GET /api/traces`   | `{ rows:[{agent,operation,name,tokens,start_ts}], agents:[{agent,n}] }` |
| `GET /api/selfheal` | `{ mode, killed, stats:{total,delivered,escalated,suspicious,acked}, incidents:[…] }` |
| `GET /api/fleet`    | `{ agents:[{agent,status,lastSeen,stale}], backlog:{pending,leased,failed}, recent:[{agent,kind,action}] }` |
| `GET /api/findings` | `{ file, total, bySeverity:{critical,high,medium,low,info}, items:[{rule,level,message}] }` |

### `POST /api/ask` — the one write-ish path
`{ "question": string }` → `{ "answer": string }` (or `{ "error": string }`). Proxies
`kl_ask_global` to the engine's knowledge base. Gate it behind your admin auth like the rest.
Degrades gracefully: any unreachable datasource returns `{ …, "error": "…" }` instead of throwing —
render the `error` string, don't assume the field is absent.

## Multi-tenancy — the BFF is aggregate, you scope

The BFF returns the engine's **whole** picture (all cost, all memory). It pre-aggregates cost
per tenant, but does not *restrict* the payload to one tenant — so scope in **your** backend,
after auth:
- **Cost**: use `cost.byTenant` (pre-summed spend per tenant, desc) for the "who is burning
  budget" table; `cost.recent[].tenant` carries the id per line. Pick the caller's tenant.
- **Memory**: namespaced by the `tenant:<id>/…` subject convention (see
  [CLAUDE-INTEGRATION.md](CLAUDE-INTEGRATION.md)) — filter `memory.recent[].subject` by prefix.

Never send the raw aggregate to a tenant admin — a tenant must only ever see their slice.

### ⚠️ Tenant isolation is APP-LEVEL by default — DB RLS is bypassed
AgenticMind's tables carry row-level-security policies, **but the default engine compose
connects to Postgres as the `postgres` superuser, and Postgres superusers bypass RLS.** So
out of the box, per-tenant isolation is **not DB-enforced** — it holds only as far as the
app consistently scopes every write and read (subject namespacing + the filtering shown in
`examples/admin-proxy.ts`). For a real multi-tenant product this means:
- **Do the scoping in code and never skip it** — a missing filter = a cross-tenant leak,
  silently (no DB backstop).
- Scope the engine's memory the same way: write beliefs under `tenant:<id>/…`, and constrain
  `mem_recall`/`kl_ask` to the caller's tenant — don't trust RLS to do it.
- To get DB-enforced isolation, harden the engine: a non-superuser app role with RLS active
  and a per-request `app.current_tenant` (a hardening checklist exists for AgenticMind; the
  default compose does **not** do this).
