/**
 * Platform override entrypoint for AgenticSelfHealingCode.
 *
 * The vendored server hardcodes the LLM model ('claude-opus-4-8') and never passes a
 * model to proposeWithClaude. This thin wrapper REUSES the vendored buildServerDeps +
 * createFetchHandler untouched, and only re-binds deps.propose so the model is env-driven
 * (ANTHROPIC_MODEL) — letting us route the real Claude call through Bifrost → OpenRouter
 * (model = openrouter/anthropic/claude-opus-4.8) instead of api.anthropic.com. No fork,
 * no copy of vendor logic; mounted at /app/platform-server.ts.
 */
import { buildServerDeps } from "./packages/app/src/server"
import { createFetchHandler } from "./packages/app/src/http"
import { proposeWithClaude, optionalEnv } from "@sho/adapters"

const deps = buildServerDeps(() => Date.now())

// Real, env-selected LLM: keep the vendored fake-fallback, but when a key + model are
// present, route the actual Claude hypothesis through our model plane.
const apiKey = optionalEnv("ANTHROPIC_API_KEY")
const model = optionalEnv("ANTHROPIC_MODEL")
if (apiKey && model) {
  const baseUrl = optionalEnv("ANTHROPIC_BASE_URL")
  deps.propose = (input) => proposeWithClaude(input, { apiKey, baseUrl, model })
}

const port = Number(optionalEnv("PORT") ?? 3000)
;(globalThis as { Bun?: { serve(o: unknown): unknown } }).Bun?.serve({ port, fetch: createFetchHandler(deps) })

const on = (k: string) => (optionalEnv(k) ? "on" : "off")
// eslint-disable-next-line no-console
console.log(
  `AgenticSelfHealingCode (platform) — listening.  db=${on("DATABASE_URL")}  ` +
    `llm=${on("ANTHROPIC_API_KEY")}  model=${model ?? "default"}  telegram=${on("TELEGRAM_BOT_TOKEN")}  ` +
    `git-rca=${on("RCA_GIT_REPO")}`,
)
