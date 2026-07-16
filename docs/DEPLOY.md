# Deploying an engine to a new product

This repo is a **reusable engine template**. The doctrine: every product (yours or a
client's) gets its **own** Agentic engine instance — its own knowledge, memory, model
plane and traces, fully isolated. One git clone = one engine.

## Stand up an engine (5 steps, ~3 min after images cache)

```bash
# 1. clone the template for this product
git clone --recurse-submodules https://github.com/Moai-Team-LLC/agentic-platform.git acme-engine
cd acme-engine

# 2. stamp the instance: own name, ports, secrets, profiles
./cli/agentic init acme 4900 scan
#   acme       → containers/volumes/network prefixed 'acme-engine' (isolated)
#   4900       → sequential host ports (4900–4908). OMIT on a dedicated server.
#   scan       → service profiles (see below). 'fleet' is dogfood-only; products skip it.

# 3. put the one provider key into .env
#    OPENROUTER_API_KEY=...

# 4. bring it up + verify end-to-end
./cli/agentic up
./cli/agentic doctor            # containers + real routed LLM call + Claude's MCP path

# 5. hand the product team their integration card
./cli/agentic handout           # writes handout.md (gitignored) — endpoints + credentials
```

`handout.md` is everything the product needs to plug in: the MCP endpoint + a minted
token (memory), the gateway base URL + key (model plane), and the OTLP endpoint (traces).

## Service profiles — deploy only what the product needs

`core` always runs (Mind + memory, Gateway + Bifrost, Performance, Console, embeddings).
Extras are opt-in via `COMPOSE_PROFILES` (set by `init`, changeable in `.env`):

| Profile | Adds | When |
|---|---|---|
| `fleet` | ops-runner + heartbeat (the platform's own dogfood agents) | only the platform's own instance |
| `scan` | periodic Assurance re-scan | when you want a live security pane |

A product engine is typically `scan`.

## One machine, many engines

Give each instance a distinct `port-base` (9 ports apart) — `COMPOSE_PROJECT_NAME`
isolates containers, network **and data volumes**, so nothing collides. Verified: the
platform's own instance (`:4600`) and a second `demo-engine` (`:4904`) ran side by side
with separate `*_mind-pgdata` volumes. Watch the RAM though — each engine is ~2–2.5 GB;
a laptop Docker VM fits ~2–3 comfortably. For a client, one engine per server (omit
`port-base` → default ports) is cleaner.

## How a product plugs in (from handout.md)

- **Memory**: add the `agenticmind` MCP server (`http://localhost:<MIND_PORT>/mcp`, Bearer
  token) to Claude Code / any MCP client → `kl_*` + `mem_*` tools. See
  [CLAUDE-INTEGRATION.md](CLAUDE-INTEGRATION.md).
- **Model plane**: point the app's OpenAI client at `http://localhost:<GATEWAY_PORT>/v1`
  with the `sk-agw-…` key + passthrough model slugs → budgeted, cost-tracked calls.
- **Traces**: set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:<APL_INGEST_PORT>`, attribute
  agents with `gen_ai.agent.id`.

## Operations

Same CLI on every instance: `agentic status` / `doctor` (health), `agentic backup` /
`restore` (the memory is the asset — back it up), `agentic app` / `menubar` (desktop
surface). Reboot recovery is automatic (`restart: unless-stopped` + Docker start-on-login).
Full runbook: [OPERATIONS.md](OPERATIONS.md).

## Teardown

`agentic down` stops an engine, **preserving data**. To destroy a throwaway instance
completely (containers **and** volumes), from its directory:
`docker compose -f deploy/docker-compose.yml --env-file .env down -v`. Never run `-v` on
an engine whose memory you want to keep.
