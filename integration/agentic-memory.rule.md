# Agentic Memory — Always-On (Global)

> Install: `cp integration/agentic-memory.rule.md ~/.claude/rules/agentic-memory.md`
> This is an OPT-IN behavioral rule. It changes how Claude Code works across all your
> projects (it makes Claude use AgenticMind's memory), so install it deliberately.

Claude has a live semantic memory + knowledge layer: **AgenticMind**, wired as the
`agenticmind` MCP server (`http://localhost:3000/mcp`, part of the local Agentic
Platform). When those MCP tools are present, USE them — that is what turns "the tool is
available" into "the tool is used". This rule is self-gating: if the `agenticmind` tools
are **not** in the session, or a call errors (platform down), skip silently and proceed —
never block work on it, never announce its absence.

This is complementary to Claude Code's file-based auto-memory (`memory/MEMORY.md`), which
stays the **curated, reviewed cross-session index**. AgenticMind is the **live, queryable**
store: semantic search over accumulated knowledge + a private belief store. Write durable,
human-meaningful facts to file-memory as before; use AgenticMind for recall-by-similarity
and for capturing operational learnings as you work.

## Recall — at the start of non-trivial project work
Before substantial work on a project, spend one cheap call to ground yourself:
- `mem_recall` — your prior beliefs (filter by subject when you have one).
- `kl_search` or `kl_ask_global` — relevant accumulated knowledge for the task.
Do it once, silently; fold anything useful into your plan. Skip for trivial or purely
conversational turns.

## Capture — after a decision, deploy, or non-obvious fix
When you learn something that would help a future session, record it (best-effort, one
line, no ceremony):
- `mem_write` — a durable belief `{subject, predicate, object, confidence}`
  (e.g. subject=`agentic-platform`, predicate=`gateway-vk`, object=`keep AGW_REQUIRE_VK
  false — true needs a per-tenant vaulted credential`).
- `kl_ingest` — longer notes / decisions worth full-text + semantic retrieval later.
Prefer specific, falsifiable statements over vague ones. Never write secrets.

## The available tools (AgenticMind MCP)
`kl_search` · `kl_ask_global` · `kl_get_material` · `kl_ingest` · `kl_forget` ·
`mem_recall` · `mem_write` · `mem_forget` · `kl_signal`.

## Posture
- Silent and cheap: recall is one call, capture is one line. Never narrate "checking
  memory" / "saving to memory" unless the user asked.
- Degrade gracefully: tools missing or a call fails → carry on as if the rule weren't
  here. The platform being down must never degrade the actual task.
- Don't double-log: if a fact already went to file-memory verbatim, a short `mem_write`
  pointer is enough — don't paste large blobs into both.

Start the platform with `agentic up`; verify Claude's MCP path with `agentic doctor`.
