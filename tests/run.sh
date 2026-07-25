#!/usr/bin/env bash
#
# tests/run.sh — self-contained test suite for the `agentic` CLI.
#
# Runs with NO Docker, NO network and NO access to your real cockpit files: every
# invocation gets HOME pointed at a throwaway sandbox, so the CLI's defaults
# (~/.agentic-cockpit/*) resolve to fixtures the tests create. Pure bash+git+python3.
#
#   bash tests/run.sh          # exits 1 if anything fails
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/cli/agentic"
PASS=0; FAIL=0

c()   { printf '\033[%sm%s\033[0m' "$1" "$2"; }
ok()  { printf '  %s %s\n' "$(c '1;32' '✓')" "$1"; PASS=$((PASS+1)); }
no()  { printf '  %s %s\n      %s\n' "$(c '1;31' '✗')" "$1" "${2:-}"; FAIL=$((FAIL+1)); }
has() { case "$2" in *"$3"*) ok "$1";; *) no "$1" "expected to contain: $3";; esac; }
hasnt(){ case "$2" in *"$3"*) no "$1" "must NOT contain: $3";; *) ok "$1";; esac; }
group(){ printf '\n%s\n' "$(c '1;37' "$1")"; }

# ── sandbox ───────────────────────────────────────────────────────────────────
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
export HOME="$SANDBOX/home"           # isolates ~/.agentic-cockpit from the real one
COCK="$HOME/.agentic-cockpit"
mkdir -p "$COCK"

mkgit() {                              # mkgit <path> [extra-file]
  mkdir -p "$1"
  git -c init.defaultBranch=main init -q "$1" >/dev/null 2>&1
  git -C "$1" config user.email t@example.com
  git -C "$1" config user.name "Test"
  printf 'hello\n' > "$1/README.md"
  [ -n "${2:-}" ] && printf 'x\n' > "$1/$2"
  git -C "$1" add -A >/dev/null 2>&1
  git -C "$1" commit -qm init >/dev/null 2>&1
}

# repos: clean · dirty · path-with-space · worktree child · cyrillic · missing
mkgit "$SANDBOX/clean-repo"
mkgit "$SANDBOX/dirty-repo"; printf 'uncommitted\n' > "$SANDBOX/dirty-repo/scratch.txt"
mkgit "$SANDBOX/with space"
mkgit "$SANDBOX/wt-parent"
git -C "$SANDBOX/wt-parent" worktree add -q -b feat/side "$SANDBOX/wt-child" >/dev/null 2>&1
mkgit "$SANDBOX/кириллица"

cat > "$COCK/repos.json" <<JSON
[
 {"name":"clean-repo","path":"$SANDBOX/clean-repo","prod_url":"","droplet_ip":"","ssh_key":"","prod_branch":"main","deploy_cmd":"./deploy.sh prod","notes":""},
 {"name":"dirty-repo","path":"$SANDBOX/dirty-repo","prod_url":"","droplet_ip":"","ssh_key":"","prod_branch":"main","deploy_cmd":"","notes":""},
 {"name":"spaced","path":"$SANDBOX/with space","prod_url":"","droplet_ip":"","ssh_key":"","prod_branch":"","deploy_cmd":"make deploy","notes":""},
 {"name":"wt-child","path":"$SANDBOX/wt-child","prod_url":"","droplet_ip":"","ssh_key":"","prod_branch":"","deploy_cmd":"","notes":""},
 {"name":"кириллица","path":"$SANDBOX/кириллица","prod_url":"","droplet_ip":"","ssh_key":"","prod_branch":"","deploy_cmd":"","notes":"заметка"},
 {"name":"ghost","path":"$SANDBOX/does-not-exist","prod_url":"","droplet_ip":"","ssh_key":"","prod_branch":"","deploy_cmd":"","notes":""}
]
JSON

# minimal snapshot so project seed / check have prod data to read
cat > "$COCK/snapshot.json" <<JSON
{"repos":[{"name":"clean-repo","branch":"main","dirty":0,"unpushed":-1,"age_days":0,"last":"now","gone":false},
          {"name":"dirty-repo","branch":"main","dirty":1,"unpushed":-1,"age_days":0,"last":"now","gone":false}],
 "prod":[],"at":"2026-01-01T00:00:00Z"}
JSON

run() { bash "$CLI" "$@" 2>&1; }        # every run inherits the sandboxed HOME

# ── syntax ────────────────────────────────────────────────────────────────────
group "syntax & help"
if bash -n "$CLI" 2>/dev/null; then ok "bash -n cli/agentic"; else no "bash -n cli/agentic" "syntax error"; fi
OUT="$(run)"
has "usage lists commands" "$OUT" "agentic code-status"
has "usage lists the orchestrator" "$OUT" "agentic brief"

# ── code-status ───────────────────────────────────────────────────────────────
group "code-status (portfolio git)"
OUT="$(run code-status --json)"
if printf '%s' "$OUT" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  ok "--json emits valid JSON"
else no "--json emits valid JSON" "not parseable"; fi
has "reports the clean repo" "$OUT" '"name": "clean-repo"'
has "counts uncommitted changes" "$OUT" '"dirty": 1'
has "handles cyrillic paths (py3.6 utf-8)" "$OUT" "кириллица"
has "flags a vanished path as gone" "$OUT" '"gone": true'
# regression: a git worktree has .git as a FILE, not a dir — must not read as gone
WT="$(printf '%s' "$OUT" | python3 -c 'import json,sys
d=[r for r in json.load(sys.stdin) if r["name"]=="wt-child"]
print(d[0]["gone"] if d else "missing")' 2>/dev/null)"
if [ "$WT" = "False" ]; then ok "worktree is not mistaken for a dead path"; else no "worktree is not mistaken for a dead path" "gone=$WT"; fi
OUT="$(run code-status)"
has "table renders a header" "$OUT" "REPO"

# ── deploy ────────────────────────────────────────────────────────────────────
group "deploy (registry-driven, read-first)"
OUT="$(run deploy clean-repo)"
has "forces cd into the repo" "$OUT" "cd $SANDBOX/clean-repo && ./deploy.sh prod"
has "stays dry by default" "$OUT" "dry-run"
OUT="$(run deploy spaced)"
has "shell-quotes a path with spaces" "$OUT" 'with\ space'
# regression: empty deploy_cmd must NOT let prod_branch slide into the command slot
OUT="$(run deploy dirty-repo)"
has "empty deploy_cmd reports it" "$OUT" "no deploy_cmd"
hasnt "empty deploy_cmd never runs the branch name" "$OUT" "&& main"
OUT="$(run deploy nope-xyz)"; has "unknown repo errors" "$OUT" "no repo matching"
OUT="$(run deploy repo)";     has "ambiguous prefix errors" "$OUT" "ambiguous"

# ── project / sdlc (two-axis model) ───────────────────────────────────────────
group "project & sdlc (business × engineering)"
export AGENTIC_PROJECTS="$COCK/projects.json"
OUT="$(run project seed)";  has "seed groups repos into projects" "$OUT" "projects"
OUT="$(run project acme --repos clean-repo,dirty-repo --phase shipped --money near --focus)"
has "set applies phase/money" "$OUT" "phase=shipped money=near"
OUT="$(run project)"
has "show lists the project" "$OUT" "acme"
has "show reports the sprawl line" "$OUT" "in focus"
OUT="$(run project acme --add-repos spaced)"; has "--add-repos merges a repo in" "$OUT" "repos=3"
OUT="$(run project acme --phase not-a-phase)"; has "rejects an unknown phase" "$OUT" "bad phase"
OUT="$(run project acme --money gold)";        has "rejects an unknown money value" "$OUT" "money:"
OUT="$(run sdlc clean-repo build)";            has "sdlc sets a stage" "$OUT" "sdlc=build"
OUT="$(run sdlc clean-repo teleport)";         has "sdlc rejects an unknown stage" "$OUT" "stage:"
OUT="$(run sdlc not-a-repo build)";            has "sdlc rejects an unknown repo" "$OUT" "not found"
OUT="$(run sdlc)";                             has "sdlc show groups by stage" "$OUT" "build"
OUT="$(run project acme --delete)";            has "--delete removes the project" "$OUT" "deleted acme"

# ── check (readiness) ─────────────────────────────────────────────────────────
group "check (readiness checklist)"
OUT="$(run check clean-repo)"
has "scores a single repo" "$OUT" "clean-repo"
has "lists the documentation item" "$OUT" "documentation"
OUT="$(run check clean-repo --json)"
if printf '%s' "$OUT" | python3 -c 'import json,sys
d=json.load(sys.stdin); assert d and "done" in d[0] and "items" in d[0]' 2>/dev/null; then
  ok "--json carries score + items"
else no "--json carries score + items" "bad shape"; fi

# ── act / dev (sub-agent dispatch — must stay dry, never call claude) ─────────
group "act & dev (agent dispatch stays dry)"
run project acme --repos clean-repo --phase shipped >/dev/null 2>&1
run sdlc clean-repo deploy >/dev/null 2>&1
OUT="$(run act acme)"
has "act picks the GTM prompt for shipped" "$OUT" "paying"
has "act stays dry without --run" "$OUT" "dry-run"
OUT="$(run dev clean-repo)"
has "dev picks the deploy checklist prompt" "$OUT" "deploy-readiness"
has "dev stays dry without --run" "$OUT" "dry-run"
OUT="$(run dev not-a-repo)"; has "dev errors on an unknown repo" "$OUT" "no SDLC stage"

# ── summary ───────────────────────────────────────────────────────────────────
printf '\n%s  %s passed · %s failed\n\n' \
  "$(c '1;36' 'result:')" "$(c '1;32' "$PASS")" "$([ "$FAIL" -gt 0 ] && c '1;31' "$FAIL" || c '2' 0)"
[ "$FAIL" -eq 0 ]
