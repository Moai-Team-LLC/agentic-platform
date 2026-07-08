/**
 * heartbeat — keeps the platform "breathing". Every INTERVAL it asks AgenticMind
 * a question, which routes through the gateway (cost) and emits a why-trace
 * (spans) into AgenticPerformance. So the Observability + cost panes stay live
 * even with no human traffic. Needs an MCP token (minted by `agentic up`).
 */
const MIND = process.env.MIND_URL ?? "http://mind-server:3000"
const INTERVAL = Number(process.env.INTERVAL ?? 180) * 1000
const TOKEN = process.env.HEARTBEAT_TOKEN ?? ""

const QUESTIONS = [
  "What is the model plane and what port does it use?",
  "Which product stores OTLP traces?",
  "What red-teams the agents in the platform?",
  "How does the knowledge and memory layer work?",
]
let i = 0

async function beat(): Promise<void> {
  if (TOKEN === "") return
  const question = QUESTIONS[i++ % QUESTIONS.length]
  try {
    await fetch(`${MIND}/mcp`, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "kl_ask_global", arguments: { question } },
      }),
    })
  } catch {
    /* transient — the next beat retries */
  }
}

setInterval(() => void beat(), INTERVAL)
void beat()
// eslint-disable-next-line no-console
console.log(`[heartbeat] every ${INTERVAL / 1000}s → kl_ask (token ${TOKEN ? "set" : "MISSING — agentic up mints it"})`)
