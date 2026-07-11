<div align="center">

# Agentic Platform

### The whole AgenticProduct ecosystem, wired into one runnable product.

*One config · one command · one console.* Run → remember → measure → heal → assure.

</div>

---

Six standalone repos (a standard + five reference implementations) each stay adoptable on
their own. **This** repo is the opposite bet: the *integrated* platform — the pieces hard-wired
together, one shared config, one control plane. It doesn't fork or modify the products; it
**vendors them as submodules** and composes them.

```bash
git clone --recurse-submodules <this-repo> && cd agentic-platform
cp integration/platform.env.example .env      # add your OPENROUTER_API_KEY
./cli/agentic install                          # put `agentic` on your PATH (~/.local/bin)
agentic up                                     # brings the whole ecosystem up, wired
agentic doctor                                 # verify end-to-end (routing + Claude's MCP path)
open http://localhost:4600                      # the console — with an "Ask AgenticMind" box
```

**Daily use:** `agentic ask "…"` (query your knowledge base) · `agentic status` (health
verdict) · `agentic backup` (dump your memory to `~/.agentic-backups`) · `agentic doctor`
(is it actually working?). See **[docs/OPERATIONS.md](docs/OPERATIONS.md)** for the full
runbook (reboot recovery, backups, troubleshooting) and
**[docs/CLAUDE-INTEGRATION.md](docs/CLAUDE-INTEGRATION.md)** for how Claude Code uses the
platform as its memory.

**Give a product its own engine:** this repo is a reusable template — one clone per
product/client, stamped with `agentic init <name>`, isolated by
`COMPOSE_PROJECT_NAME`, deploying only the profiles it needs. See
**[docs/DEPLOY.md](docs/DEPLOY.md)**.

## What "wired" means

The platform bakes in the cross-product integration (in the standalone products these are
*optional* seams; here they're on by default):

- **Every LLM call flows through AgenticGateway** — Mind and Performance get a minted Gateway
  tenant key; the gateway routes to one upstream (OpenRouter), with per-tenant budgets, caching,
  and a cost ledger.
- **Every trace flows into AgenticPerformance** — Mind and Gateway export OTel to `:4319`;
  spans are attributed per-agent (`gen_ai.agent.id`).
- **AgenticAssurance red-teams the family** — `agentic demo` scans the products' own capability
  manifests.
- **One shared config & secrets** — a single `.env`; the CLI renders each service's env, mints
  tenants, generates secrets, and isolates Docker volumes with a platform-unique project prefix.

## The console

A single control plane (`console/`) aggregating the live ecosystem into one pane:

| Pane | Source |
|---|---|
| Service health + the loop | all services |
| Traces + agents | AgenticPerformance (`apl_span`) |
| Cost + routes | AgenticGateway (evidence ledger) |
| Security findings | AgenticAssurance (SARIF) |
| Knowledge & memory | AgenticMind |

## Layout

```
agentic-platform/
├── vendor/            ← the 7 products as pinned git submodules (never modified)
├── integration/      ← the unified config
├── cli/agentic       ← control plane: up·down·status·doctor·ask·backup·restore·console·demo·token·install·logs
├── console/          ← BFF (Bun) + web dashboard — the single pane
├── examples/         ← the closed-loop demo + family capability manifests
└── deploy/           ← (compose/helm — hardening)
```

## The products

📐 [agentic-product-standard](https://github.com/Moai-Team-LLC/agentic-product-standard) ·
⚙️ [AgenticOps](https://github.com/Moai-Team-LLC/AgenticOps) ·
🧠 [AgenticMind](https://github.com/Moai-Team-LLC/AgenticMind) ·
📈 [AgenticPerformance](https://github.com/Moai-Team-LLC/AgenticPerformance) ·
🛡️ [AgenticAssurance](https://github.com/Moai-Team-LLC/AgenticAssurance) ·
🚪 [AgenticGateway](https://github.com/Moai-Team-LLC/AgenticGateway)

Plus one piece of **internal infrastructure** (not part of the product line):
[AgenticSelfHealingCode](https://github.com/Moai-Team-LLC/AgenticSelfHealingCode), vendored as
the platform's incident engine — it takes signed failure signals (agent failures, routing
failures, service-down watchdog), runs live LLM + git-blame RCA, and pages Telegram.

## Requirements

[Bun](https://bun.sh) ≥ 1.3 · Docker · an OpenRouter key. Embeddings run in a dedicated
Ollama service (bge-m3, 1024-dim) that loads the model on demand and unloads it when idle,
so `mind-server` stays ~140 MB. All host ports bind to `127.0.0.1` (localhost only).

> **Note.** This is the integration product — it deliberately couples the pieces. The individual
> repos remain standalone and vendor-neutral (Principle 2); adopt one, or run the whole platform here.
