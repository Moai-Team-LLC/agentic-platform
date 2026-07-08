# How Claude uses the Agentic Platform

The platform isn't just *observed* by Claude — Claude Code **uses** it. There are two
integration surfaces, and they work differently.

## 1. AgenticMind as Claude's memory (MCP) — the live wiring

AgenticMind is registered as an MCP server in `~/.claude.json`:

```json
"agenticmind": {
  "type": "http",
  "url": "http://localhost:3000/mcp",
  "headers": { "Authorization": "Bearer <mcp-token>" }
}
```

So in every Claude Code session (while the platform is up), Claude has these tools:

| Tool | What Claude does with it |
|---|---|
| `kl_search` | semantic search over the knowledge base |
| `kl_ask_global` | ask a natural-language question (RAG over ingested material) |
| `kl_ingest` | add a document / note to the knowledge base |
| `kl_get_material` / `kl_forget` | fetch / delete a material by id |
| `mem_recall` | recall accumulated beliefs (private ∪ shared) |
| `mem_write` | record a durable belief (subject · predicate · object · confidence) |
| `mem_forget` | retract one of your beliefs (soft, bitemporal) |
| `kl_signal` | emit a feedback signal (verified / eval-passed / …) |

That gives Claude a **persistent memory + knowledge layer** that survives across
sessions — an external brain, queryable by meaning.

### Making Claude actually USE it (behavioral wiring)

The MCP server being *present* is not the same as Claude *using* it. The behavior is
driven by a rule. The canonical text lives in this repo at
[`integration/agentic-memory.rule.md`](../integration/agentic-memory.rule.md). To
activate it globally (all your Claude Code sessions):

```bash
cp integration/agentic-memory.rule.md ~/.claude/rules/agentic-memory.md
```

The rule tells Claude to **recall** relevant context at the start of substantial work
(`mem_recall` / `kl_search`) and to **capture** learnings after a decision, deploy, or
non-obvious fix (`mem_write` / `kl_ingest`) — silently, cheaply, and only when the
tools are present (it degrades gracefully when the platform is down). It's complementary
to Claude Code's file-based auto-memory, which stays the curated cross-session index.

### Getting / refreshing the token

`agentic token` mints a 365-day MCP token. Paste it as the `Bearer` in the `agenticmind`
server in `~/.claude.json`, then restart Claude Code. If Claude's `agenticmind` tools
disappear (token expired, or the Mind DB was reset), re-run `agentic token`, replace the
Bearer, and restart. `agentic doctor` verifies this exact path (`tools/list`).

## 2. AgenticGateway as the model plane — used by the platform's own agents

Every LLM call made by the platform's *own* components flows through the Gateway
(`:8787`, OpenAI-compatible) → Bifrost → OpenRouter, with a per-tenant key, a budget, and
each call's cost written to the ledger. This is what the fleet (`ops-runner`), the
`heartbeat`, and Mind's card-extraction use.

> Note: Claude Code's **own** model calls (this conversation) go to Anthropic directly —
> they do **not** route through the Gateway (that's your Claude subscription). The Gateway
> serves the agents the *platform* runs, not Claude Code's turns.

### Routing your own projects through the Gateway (optional)

If you want your own apps' LLM usage to show up in the console's Cost / Traces panes:

1. Mint a tenant:
   `docker compose -f deploy/docker-compose.yml exec gateway bun run src/cli.ts tenant create <name> --budget-usd <n>`
2. Point your app's OpenAI client at `http://localhost:8787/v1` with the minted `sk-agw-…` key.
3. Use passthrough model slugs, e.g. `openrouter/openai/gpt-4o-mini`.

## 3. Where things land

- Ask Claude (or the console, or `agentic ask`) something grounded → `kl_ask_global` → answer.
- Any agent/component makes an LLM call → Gateway → cost recorded + a trace in
  AgenticPerformance (`:4319` → `apl_span`).
- The `ops-runner` fleet runs real grounded agents (kl_ask → gateway → mem_write); the
  `heartbeat` keeps traces + cost live on their own.
- All of it is visible in the console (`http://localhost:4600`), which also has an
  **"Ask AgenticMind"** box so you can query the knowledge base without leaving the pane.

See [OPERATIONS.md](OPERATIONS.md) for running, backing up, and troubleshooting the platform.
