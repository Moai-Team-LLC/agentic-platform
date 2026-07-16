# Operating the Agentic Platform

The platform runs as durable Docker containers. One CLI (`agentic`) drives everything.
Run `./cli/agentic install` once to put `agentic` on your PATH.

## Commands

| Command | What it does |
|---|---|
| `agentic up` | build + start the whole stack, wired (idempotent) |
| `agentic down` | stop the stack — **data volumes preserved** |
| `agentic status` | aggregate health verdict + per-service states |
| `agentic doctor` | end-to-end readiness: routing + Claude's MCP path |
| `agentic ask "Q"` | ask AgenticMind a question from the terminal |
| `agentic backup` | dump all databases → `~/.agentic-backups` |
| `agentic restore <dir>` | restore the databases from a backup directory |
| `agentic console` | open the console (http://localhost:4600) |
| `agentic app` | open the console as a desktop-style window (Chrome app mode) |
| `agentic menubar` | install the menu-bar control (SwiftBar: live health + start/stop) |
| `agentic token [label]` | mint an MCP token for AgenticMind (Claude Code) |
| `agentic install` | put `agentic` on your PATH (`~/.local/bin`) |
| `agentic logs [service]` | tail a service's logs |

## The console as a desktop app

Three zero-build options (no Electron, no Tauri):

- **`agentic app`** — a chromeless Chrome app-mode window. Instant.
- **Safari → File → Add to Dock** (on http://localhost:4600) — a real Dock icon;
  the console ships a PWA manifest + icons, so the name and icon come out right.
- **`agentic menubar`** — a SwiftBar menu-bar item: a live health dot (`● 9/9`),
  per-service status, and Start / Stop / Doctor / Backup actions. This is the one
  piece a browser sandbox can't do — it drives the `agentic` CLI natively.

## Ports — all bound to `127.0.0.1` (localhost only, never the LAN)

| Port | Service | Purpose |
|---|---|---|
| 4600 | console | the one pane (open in a browser) |
| 4390 | mind-server | AgenticMind API + MCP endpoint (`/mcp`) |
| 8787 | gateway | AgenticGateway — OpenAI-compatible edge |
| 4380 | bifrost | data plane |
| 4319 | apl-ingest | AgenticPerformance — OTLP trace ingest |
| 4700 | ops-runner | AgenticOps fleet |
| 5435 | mind-db | Postgres — **memory (crown jewel)** |
| 5439 | apl-db | Postgres — traces |

Every port is bound to `127.0.0.1`, so nothing is reachable from another machine on
your network. Services talk to each other over the internal compose network by DNS.

## Reboot recovery

Containers are `restart: unless-stopped`, so they come back **once the Docker daemon
is running** — but that policy is inert while Docker itself is down. After a Mac reboot:

1. **Make Docker start on login** (the one manual setting that makes recovery automatic):
   Docker Desktop → Settings → General → check *"Start Docker Desktop when you sign in"*.
   With that on, `restart: unless-stopped` brings the whole platform back by itself.
2. If Docker autostart is off (or after a manual Quit): `open -a Docker`, then `agentic up`
   (idempotent — re-arms the heartbeat and revalidates the gateway key).

## Data & the "never `-v`" rule

Your data lives in Docker **named volumes**:

- `agentic-platform_mind-pgdata` — AgenticMind knowledge & memory (**irreplaceable**)
- `agentic-platform_apl-pgdata` — Performance traces
- `agentic-platform_gateway-data` — the gateway tenant key + cost ledger

`agentic down` stops containers but **preserves** these — safe to run daily.

> ⚠️ **Never** run `docker compose down -v`, `docker volume rm`, `docker system prune
> --volumes`, or Docker Desktop → Troubleshoot → *"Clean / Purge data"*. Each of these
> deletes the volumes above. There is no undo — only a backup.

## Backups

- `agentic backup` dumps mind / apl / sho Postgres + the gateway ledger to
  `~/.agentic-backups/<timestamp>/` — **outside the repo**, so it can never leak to git.
  Keeps the last 14.
- `agentic up` auto-snapshots before running migrations (when a memory volume already
  exists), so an auto-applied vendor migration always has a restore point.
- Restore: `agentic restore ~/.agentic-backups/<timestamp>`.
- Run `agentic backup` before Docker upgrades or `git submodule update` bumps.

## Verifying health — "running" ≠ "working"

- `agentic status` — the fast verdict (`N/M services up`) plus each container's state.
- `agentic doctor` — the **real** end-to-end check: every container running + a routed
  LLM call actually reaches OpenRouter + Claude's MCP path (`tools/list`) works. Run this
  when something feels off: a container can be `running` while the app inside is broken —
  e.g. an expired OpenRouter key leaves every pane green while every call 401s.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Console `:4600` unreachable | Docker not running | `open -a Docker`, then `agentic up` |
| Ask/chat returns nothing; cost frozen | OpenRouter key invalid, or gateway key stale | `agentic doctor`; `agentic logs gateway`; a stale gateway key re-mints itself on the next `agentic up` |
| A service shows `unhealthy` | build / dependency issue | `agentic logs <service>` |
| Claude Code has no `agenticmind` tools | MCP token expired or Mind down | `agentic token`, replace the Bearer in `~/.claude.json`, restart Claude Code (see [CLAUDE-INTEGRATION.md](CLAUDE-INTEGRATION.md)) |
| `agentic: command not found` | not on PATH | `./cli/agentic install` |

## Memory footprint

Embeddings run in a dedicated Ollama service (bge-m3, 1024-dim) that loads the model on
demand and unloads it when idle, so `mind-server` stays ~140 MB instead of ~3.7 GB. The
whole 16-container stack sits around ~2.5 GB.
