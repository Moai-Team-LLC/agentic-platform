#!/usr/bin/env bash
#
# The closed loop, live: ingest → ask (routed through Gateway, traced into
# Performance) → red-team the family with Assurance. Watch it land in the console.
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; . "$ROOT/.env" 2>/dev/null || true; set +a
: "${MIND_PORT:=3000}" "${CONSOLE_PORT:=4600}"
V="$ROOT/vendor"

echo "▸ 1/3  Mint an MCP token + ingest a note into AgenticMind"
TOK="$(cd "$V/AgenticMind" && bun run scripts/issue-mcp-token.ts --label demo --ttl-days 1 2>/dev/null | grep -oE 'ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' | tail -1)"
[ -z "$TOK" ] && { echo "  could not mint token — is the platform up? (agentic up)"; exit 1; }
H=(-H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")
call(){ curl -s --max-time 120 -N -X POST "http://localhost:$MIND_PORT/mcp" "${H[@]}" -d "$1" | sed 's/^data: //' \
  | python3 -c "import json,sys
for l in sys.stdin:
 l=l.strip()
 if not l: continue
 try:
  r=json.loads(l).get('result',{});print('   ',('ERR' if r.get('isError') else 'OK '),r.get('content',[{}])[0].get('text','')[:90])
 except: pass"; }
call '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kl_ingest","arguments":{"title":"Platform note","text":"AgenticGateway is the model plane routing every LLM call; AgenticPerformance stores OTLP traces on port 4319; AgenticAssurance red-teams agents."}}}'

echo "▸ 2/3  Ask a question — routed via Gateway, traced into Performance"
call '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"kl_ask_global","arguments":{"question":"What routes every LLM call and what red-teams agents?"}}}'

echo "▸ 3/3  Red-team the family surface with AgenticAssurance"
[ -d "$V/AgenticAssurance/node_modules" ] || ( cd "$V/AgenticAssurance" && bun install >/dev/null 2>&1 )
( cd "$V/AgenticAssurance" && bun run cli -- scan "$ROOT/examples/manifests/agenticmind.json" \
    --sarif "$ROOT/.run/agenticmind.sarif" --report "$ROOT/.run/agenticmind.md" 2>&1 | tail -3 )

echo
echo "✓ Loop complete. Open the console → http://localhost:$CONSOLE_PORT"
echo "  You should see the ask attributed to 'agenticmind', its Gateway cost, and the PASS scan."
