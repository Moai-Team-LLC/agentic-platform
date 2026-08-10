# CONFORMANCE.md

**Regulatory readiness map — Agentic Platform**

Document v1.0 · 2026-08-10 · Apache-2.0 · maintained in-repo

This document maps the evidence this platform actually produces onto the requirements of **AIUC-1** and **Regulation (EU) 2024/1689 (EU AI Act)**, as amended by **Regulation (EU) 2026/1744 (Digital Omnibus on AI)**.

It is a **readiness map**. It is not a certificate, not an attestation, and not a claim of compliance.

---

## a. Who this is for, and what it is not

### Audience

| Reader | What to use this for |
|---|---|
| Enterprise technical buyer | Vendor due diligence: what governance artifacts exist, in what format, and how to pull them yourself before signing anything |
| Auditor / assessor | An evidence index: which requirement has a machine-readable artifact behind it, which has only a document, and which has nothing |
| Operator deploying this platform | A gap list to close *before* an assessment, not after |

### What this document is not

1. **Not a certification.** No accredited auditor has assessed this repository. AIUC-1 certificates are issued by accredited auditors (Schellman was accredited 2026-02-03); no such engagement has taken place. Every mapping below uses **"maps to"** and **"evidence available for"** — never "compliant with".
2. **Not legal advice.** Authored by an EU (Cyprus)-based consultancy, not a law firm. Article interpretation below is engineering-level, for scoping conversations with counsel.
3. **Not a claim that deploying this platform makes an AI system compliant.** The majority of both frameworks' requirements are organisational (policies, incident-response plans, vendor due diligence, acceptable-use terms, processing locations, third-party testing contracts). Software cannot satisfy them. Where a requirement is organisational, this document says **None** and does not dress it up.
4. **Not a substitute for reading the code.** Every "Evidence" row cites a path. Verify it — §f gives the commands.
5. **AIUC-1 is an overlay on SOC 2.** This repository produces no SOC 2 evidence and makes no claim about the general security controls SOC 2 covers.

### Status vocabulary

Used consistently in every table below.

| Marker | Meaning |
|---|---|
| **Evidence** | Running code produces a machine-readable artifact. Path or endpoint given. |
| **Partial** | An artifact exists, but with a named limitation an assessor will hit. The limitation is stated in the row. |
| **Declared** | The requirement is written into the standard or doctrine this repo follows, but **no enforcement code exists here**. Treat as absent. |
| **None** | No artifact. Either organisational, or not built. |

### Scope

This maps the `agentic-platform` repository plus its six vendored submodules at their pinned commits:
`vendor/AgenticAssurance`, `vendor/AgenticGateway`, `vendor/AgenticMind`, `vendor/AgenticOps`, `vendor/AgenticPerformance`, `vendor/agentic-product-standard` (Standard v3.3.0, 2026-08-05).

Claims describe the pinned commits. Run `git submodule status` to confirm what you have.

---

## b. Evidence surfaces — what exists and how to get it

### b.1 Runtime evidence artifacts

| # | Surface | Format | Produced by | How to read it | Status |
|---|---|---|---|---|---|
| 1 | Security findings | SARIF 2.1.0 (`runs[].results[]`, `security-severity` 9.5/8.0/5.0/3.0/0.0) | `vendor/AgenticAssurance/src/report/sarif.ts`, `src/report/findings.ts` | `aal scan <manifest> --sarif <path>`; console `GET /api/findings` | **Evidence** |
| 2 | Structured scan report | `aal-core-report/0.1` JSON | `vendor/AgenticAssurance/src/report/json.ts` | `aal scan … --json <path>` | **Evidence** |
| 3 | Attack corpus | 8 scenarios / 3 YAML files: `data-exfil`, `trifecta-exploit`, `prompt-injection`, `indirect-injection`, `tool-poisoning`, `tool-shadowing`, `mcp-rug-pull`, `config-rce`; mapped to OWASP ASI01–05 and MITRE ATLAS | `vendor/AgenticAssurance/attacks/{exfil,injection,tools}.yaml` | Read the files | **Partial** — 8 scenarios is a narrow corpus; it does not evidence "full OWASP ASI coverage" |
| 4 | Scan coverage metric | `attacksConclusive / attacksTotal` | `vendor/AgenticAssurance/src/scan.ts` (`computeCoverage`) | In the report payload | **Evidence** — fail-closed: `not_verified` is never counted as `safe` (`src/index.ts:12–13`) |
| 5 | Cost ledger | SQLite `request_ledger`: tenant, key, run, model, route, `outcome` (9 values incl. `denied_guard`/`denied_budget`/`denied_policy`), tokens, `cost_usd`, cache fields, `latency_ms`, `judge_verdict`, `input_hash` (sha256) | `vendor/AgenticGateway/src/cost/ledger.ts`; DB at `AGW_DB_PATH` (default `./data/agw.db`) | Direct SQL | **Partial** — no export API, no retention policy, not surfaced in the console |
| 6 | Decision evidence stream | JSONL, hash-not-text, event kinds `GatewayRequest`/`GuardBlock`/`OutputLeak`/`ProtectedPathFlag`/`SpendAnomaly`/`JudgeVerdict`/`CliMutation` | `vendor/AgenticGateway/src/delegate/evidence.ts`; `AGW_EVIDENCE_FILE` (default `./data/evidence.jsonl`) or HTTP to `POST /hooks/audit` | `jq` over the file; console `GET /api/cost` | **Evidence** — best-effort by design: evidence failure never blocks a request |
| 7 | Execution traces | `apl_span`: tenant, trace/span/parent, operation, **`agent_id` + `agent_version`**, timestamps, attributes; TimescaleDB hypertable, tenant RLS FORCE | `vendor/AgenticPerformance/packages/core/src/database/schema/trace-span.ts` | Postgres SQL (`APL_PG_PORT`, default 5439); console `GET /api/traces` | **Partial** — retention 90 days (`_span-hypertable.sql:16`); console shows only the latest rows |
| 8 | Judge calibration card | TPR/TNR with **Wilson 95% lower bound**, ECE (10 bins), Brier; pinned `model_snapshot_id`; status `uncalibrated`/`calibrated`/`stale` | `vendor/AgenticPerformance/packages/core/src/judge/{calibration,card}.ts`, schema `judge.ts` | Postgres SQL | **Evidence** — only `calibrated` judges may gate |
| 9 | Eval sets + provenance | `apl_eval_case`/`apl_eval_run`, per-agent golden sets, `case_set_hash`, provenance (`rubric_version`, `labeler`, `label_date`, `agreement`, `origin`); sets without provenance are marked `unanchored` and cannot gate a release | `vendor/AgenticPerformance/packages/core/src/database/schema/eval.ts` | Postgres SQL | **Evidence** |
| 10 | Change ledger (agent improvements) | `apl_improvement`: `version_from/to`, hypothesis, status `proposed→approved→canary→deployed→rolled_back`, author (`human`/`claude`/`judge-gated`), `patch_diff`, `eval_run_id`, `calibration_snapshot`, `canary_ab_outcome` | `.../schema/improvement.ts` | Postgres SQL | **Evidence** — a `judge-gated` author is rejected without patch + eval run + calibration + canary |
| 11 | Tool-use audit log | `tool_audit_events`: source, `event_kind` (`PostToolUse`, `PermissionRequest`, `ConfigChange`, …), actor, session, tool, decision, `payload_hash` (sha256) | `vendor/AgenticMind/packages/shared/src/database/schema/knowledge/tool-audit-events.ts`; ingest `vendor/AgenticMind/apps/server/src/hooks-audit.ts` | `POST /hooks/audit` (bearer, `audit:write` scope, body capped by `AUDIT_MAX_BYTES`); Postgres SQL (`MIND_PG_PORT`, default 5435) | **Partial** — no retention policy, no SIEM forwarder |
| 12 | Guard events | `guard_events`: tenant, actor, tool, `reason` ∈ {`injection`, `pii_redacted`, `rate_limited`, `output_leak`, `too_long`}, `input_hash` | `.../schema/knowledge/guard-events.ts` | Postgres SQL | **Partial** — no retention policy |
| 13 | HITL approval ledger | `RemediationState` machine: `guard_rejected`/`judge_rejected`/`pending_approval`/`approved`/`applied`/`reverted`/`declined`; approve/decline require an actor of form `hitl:<approver>`; append-only, deep-frozen history | `vendor/AgenticMind/packages/assurance/src/remediate/ledger.ts` | Read via the assurance package / DB | **Partial** — covers AAL remediations only, not general agent runtime |
| 14 | Human-decision capture | Each `approve`/`override`/`reject` becomes a golden-set candidate with `origin: review_capture` | `vendor/AgenticPerformance/packages/core/src/hitl/review-capture.ts` | Postgres SQL | **Evidence** — label supply, **not** a blocking approval |
| 15 | Read-only aggregation API | JSON: `/api/health`, `/api/cost`, `/api/traces`, `/api/findings`, `/api/memory`, `/api/fleet`, `/api/overview` | `console/bff/server.ts` | `curl http://127.0.0.1:4600/api/overview` | **Partial** — **no authentication**; bound to `127.0.0.1` by design; connects to Postgres with the default superuser role (`console/bff/server.ts:35–36`), so tenant RLS does not constrain it |
| 16 | Container image signatures | cosign / sigstore | `vendor/AgenticMind/.github/workflows/release-images.yml` | Verify with `cosign verify` | **Partial** — images only. **No evidence artifact (SARIF, ledger, audit log) is signed.** |

### b.2 Enforcement gates

| # | Gate | Where | Behaviour | Status |
|---|---|---|---|---|
| 17 | Per-tenant / per-run spend ceiling | `vendor/AgenticGateway/src/cost/budgets.ts` | Fail-closed: a tenant with no budget is denied | **Evidence** |
| 18 | Spend anomaly throttle | `vendor/AgenticGateway/src/cost/anomaly.ts` | 5× baseline over a 5-minute window vs trailing hour → alert + optional key throttle | **Evidence** |
| 19 | Loop budget | `vendor/AgenticPerformance/packages/core/src/improve/loop-budget.ts` | `maxIterations`, `tokenBudget`, `costCapUsd`, `timeoutMs`; `shouldStop()` checked at top-of-iteration **and** before point-of-effect | **Evidence** |
| 20 | Kill switch | `vendor/AgenticPerformance/apps/worker/src/index.ts:46` (`APL_SWEEP_KILL=1`) | Re-checked every iteration and before point-of-effect | **Evidence** |
| 21 | Escalation to human | `loop-budget.ts` (`escalateAfterVerifyFails` → `StopReason: "escalate_verify_fails"`) | Stops the loop after N verification failures | **Evidence** |
| 22 | Cycle-of-Trust guard | `vendor/AgenticMind/packages/assurance/src/remediate/guard.ts` | Structural allowlist (`prompt.system`, `context.trusted.descriptions`, `manifest.declared.mitigations`); rejects any diff touching tool/permission/scope/grant/credential/auth/trust/hook — matched on tokens, not on the patch's own declaration. Hard-gate test | **Evidence** |
| 23 | Call policy (agent→agent) | `vendor/AgenticOps/src/policy/policy.ts`, wired in `src/delegate.ts` | **Default deny**: `canCall()` returns false unless the callee is in `manifest.mayCall[]` | **Partial** — static manifest list; **refusals are thrown, not journalled** — there is no persistent "X tried to call Y and was denied" record |
| 24 | Protected-path / config-change hooks | `vendor/AgenticAssurance/policy-pack/hooks/{guard-config-change,guard-protected-paths}.mjs` | Blocks edits to protected configuration at `PreToolUse` / `ConfigChange` — a second, independent fence | **Evidence** |
| 25 | Output-leak gate | AgenticGateway output guard (`denied_output` outcome, `output_leak` reason) | Non-streaming responses are denied fail-closed | **Partial** — on **streamed** responses the bytes are already with the client; the check can only record evidence, not block |
| 26 | Input guard | AgenticGateway / AgenticMind guard | Deterministic EN+RU regex set, sub-millisecond; guards the latest user turn only | **Partial** — not an ML classifier; PII is **tagged, not redacted** at the gateway (redaction happens at AgenticMind's memory-write boundary) |
| 27 | Rate limiting | `vendor/AgenticMind/packages/shared/src/database/schema/knowledge/rate-limits.ts` | Fixed-window counters per principal (or principal:tool), atomic upsert | **Evidence** |
| 28 | Eval regression CI gate | `vendor/agentic-product-standard/templates/ci/eval-gate.yml` | File is marked `TEMPLATE` with `TODO`s. `MIN_PASS_RATE` appears **nowhere** outside that template | **Declared** — not wired into any pipeline in this repo or any submodule |
| 29 | Blast-radius limit | Doctrine only (`STANDARD.md`, skills) | No code limits how many files/tenants/records one action may touch | **Declared** |

---

## c. Mapping to the EU AI Act

### c.1 Regulatory timing — read this before using the table

**The high-risk timeline is contested and recently moved.** Regulation (EU) 2026/1744 ("Digital Omnibus on AI") was published in the Official Journal on 2026-07-24 and entered into force 2026-07-27 — six days before the original 2026-08-02 deadline. It postpones Chapter III obligations:

| Track | Original | Current | Confidence |
|---|---|---|---|
| Annex III standalone high-risk (employment, education, credit scoring, law enforcement, critical infrastructure) | 2026-08-02 | **2027-12-02** | Multi-source secondary; fixed calendar date, no standards-readiness trigger |
| Annex I embedded high-risk (medical devices, machinery, toys) | 2027-08-02 | **2028-08-02** | Multi-source secondary |
| **Art. 50** transparency to natural persons | 2026-08-02 | **unchanged — in force since 2026-08-02** | Multi-source secondary. Narrow transition to 2026-12-02 for machine-readable marking of pre-existing generative content |
| Art. 5 prohibitions, Art. 4 AI literacy | 2025-02-02 | unchanged | Settled |
| Art. 53/55 GPAI | 2025-08-02 | unchanged; penalty grace period ended 2026-08-02 | Settled |

**Caveat, stated plainly:** these dates were confirmed against six independent legal commentaries (Gibson Dunn, White & Case, K&L Gates, Cuatrecasas, Cloud Security Alliance, EU Law Live), **not** read from the Official Journal text directly — the EUR-Lex page did not render for automated retrieval. Verify against <https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng> before relying on this in a filing. One source additionally claims the Omnibus adds new prohibited practices under Art. 5; that claim is **unverified** and deliberately not carried into the table below.

**Consequence for readers:** the obligation that is live *today* for most deployments of an agent platform is **Art. 50**, not the high-risk regime — and Art. 50 is precisely where this platform contributes **nothing** (row below).

### c.2 Provider vs deployer

Role determines which obligations attach, and the platform does not decide the role for you:

- Configure, fine-tune, add tools/instructions and ship an agent to a client **under your own brand** → likely **provider** of that configuration, and often simultaneously **deployer** if you also operate it.
- **Substantial modification** of an existing system can convert an integrator into a provider.
- Deploy the platform unmodified while the client operates it → likely **deployer**, or outside the operator chain entirely.

Distribute these roles explicitly in the contract, including who owns Art. 50 disclosure, who owns the DPIA/GDPR layer, and who registers in the EU database if Annex III applies from 2027-12-02.

### c.3 Article mapping

| Article | Requirement (condensed) | Platform evidence | Status |
|---|---|---|---|
| **Art. 4** — AI literacy (in force) | Staff competence measures | None. `docs/OPERATIONS.md` is an operations runbook, not a literacy programme | **None** — organisational |
| **Art. 5** — prohibited practices (in force) | Absolute prohibitions regardless of risk tier | Out of scope for the software: the platform implements no biometric categorisation, emotion recognition, or social scoring. It also does **not** detect a prohibited use inside a hosted agent | **None** — obligation follows the use case |
| **Art. 12** — automatic record-keeping | Automatic (not manual) event logging across the lifecycle; traceability of decisions | Surfaces 5, 6, 7, 11, 12 — all written by code, none by hand | **Partial** — logs are automatic and machine-readable, but **unsigned** (no tamper-evidence) and retention is inconsistent (90 days for spans, unbounded elsewhere) |
| **Art. 13** — transparency & instructions for deployer | Instructions describing oversight measures, log access, declared accuracy metrics | Judge Card (accuracy with confidence bounds, ECE, Brier) → surface 8; `docs/CONSOLE-API.md` documents log access; Capability Manifest (`examples/manifests/agenticmind.json`) declares agent capabilities | **Partial** — no Art. 13 instructions-for-use template per deployed agent; the Capability Manifest is a red-team input, not an instruction sheet |
| **Art. 14** — human oversight | Effective oversight; ability to recognise automation bias and to stop the system | Kill switch (20), escalation (21), Cycle-of-Trust guard (22), default-deny call policy (23), HITL approval ledger with machine-checked `hitl:` actor (13) | **Partial** — **no durable pause/resume of an arbitrary agent run.** Oversight is stop-and-escalate plus post-hoc approval of AAL remediations, not "hold this action until a human approves" for general runtime |
| **Art. 15** — accuracy, robustness, cybersecurity | Appropriate accuracy/robustness/cybersecurity across the lifecycle; resistance to poisoning, adversarial attack, model manipulation; fail-safe | AAL SARIF findings incl. prompt injection, indirect injection, tool poisoning/shadowing, exfiltration (1, 3); judge calibration with Wilson lower bound (8); fail-closed budgets (17); tenant-isolation tests CI-gated (`vendor/AgenticGateway/tests/isolation.test.ts`) | **Partial** — corpus is 8 scenarios; testing is **self-run, not independent**; the eval regression gate is not wired (28) |
| **Art. 26** — deployer obligations | Use per instructions; assign a competent overseer; monitor; **keep logs ≥ 6 months**; report incidents | Logs exist (5, 6, 7, 11, 12) | **Partial + conflict** — default span retention is **90 days**, below the 6-month floor. Operators must raise `add_retention_policy('apl_span', …)` before relying on this |
| **Art. 50** — transparency to natural persons (**live since 2026-08-02**) | Inform the person they are interacting with an AI; mark AI-generated/manipulated content | **Nothing.** A repository-wide search found no AI-disclosure component; the platform renders no end-user surface | **None** — the obligation sits in the product built on top. Do not assume the platform discharges it |
| **Art. 72** — post-market monitoring | Documented PMM plan; collect operational data; feed risk management | Traces (7), failure taxonomy (`.../schema/failure.ts`), findings (1), cost/outcome data (5) | **Partial** — the data exists; there is **no PMM plan document**, and no scan-over-scan diff (each scan is a snapshot, not a trend) |
| **Art. 53 / 55** — GPAI provider | Technical documentation, downstream information, copyright policy, training-data summary; systemic-risk evaluation | **Not applicable** — the platform is not a GPAI provider; it routes to third-party models. It supplies supporting evidence: model + route per call in the ledger, and pinned `model_snapshot_id` (never a floating alias) in judge records | **n/a** — supporting evidence only |

---

## d. Mapping to AIUC-1

### d.1 Scope and method caveat

- AIUC-1 is not published as a single downloadable catalogue; the public site is modular, one page per domain. This mapping is against the **publicly documented top-level requirement IDs as of 2026-08-10**. AIUC states "51 requirements / 130 controls"; only ~44 top-level IDs are publicly enumerable (2 of them Retired in Q1 2026). **Sub-controls are not mapped** — an assessor will ask for more than the rows below.
- AIUC-1 updates **quarterly**. Re-check IDs before an engagement.
- **Six requirements (B001, C010, C011, C012, D002, D004) mandate independent third-party testing, five of them on a quarterly cadence.** No third-party testing has been performed on this platform. Every one of those rows is **None**, and no amount of in-repo tooling changes that — the requirement is about who runs the test, not whether a test exists.

### d.2 A — Data & Privacy

| ID | Requirement | Evidence | Status |
|---|---|---|---|
| A001 | Input-data policy (training, inference, retention, client rights) | — | **None** — document |
| A002 | Output ownership / use / deletion policy | — | **None** — document |
| A003 | Restrict agent data access by task/role/context | Default-deny `CallPolicy` (23); per-tenant gateway keys with `key_id` on every ledger row; scoped bearer tokens (`audit:write`) | **Partial** — enforcement exists; denials are not journalled |
| A004 | Protect IP / trade secrets from leaking through the model | Output-leak gate (25) | **Partial** — non-streaming only; no IP-specific classifier |
| A005 | Prevent cross-tenant (multi-tenant) leakage | Tenant RLS FORCE on `apl_span`; tenant-scoped keys, budgets, cache, vault, routing, ledger, evidence; `vendor/AgenticGateway/tests/isolation.test.ts` CI-gated | **Partial** — RLS is bypassed by a superuser connection. The console BFF connects as the default superuser role by design (`console/bff/server.ts:35–36`), making it an all-tenant read plane guarded only by loopback binding. Deployments must use non-superuser roles for anything tenant-facing |
| A006 | Prevent PII leakage in outputs and logs | `guard_events.reason = pii_redacted`; hash-not-text contract across ledger, evidence, audit (`input_hash`/`payload_hash` only) | **Partial** — at the gateway PII is **tagged, not redacted** (a gateway must not alter forwarded payloads); redaction happens at AgenticMind's memory-write boundary |
| A007 | Prevent infringing third-party IP in outputs | — | **None** |
| A008 | Prevent credential/secret leakage in inputs, outputs, logs | `denied_vault` outcome; payload-free evidence contract (`evidence.ts` has deliberately no field for raw text); upstream keys AES-GCM encrypted at rest, client keys stored as sha256 | **Partial** — structural (no secrets are stored) rather than detective (no scanner for secrets in model output) |

### d.3 B — Security

| ID | Requirement | Mandatory | Evidence | Status |
|---|---|---|---|---|
| B001 | Third-party adversarial robustness testing | Yes | Self-run AAL scans only | **None** — no independent test |
| B002 | Adversarial input detection | Optional | `guard_events.reason = injection`; AAL injection rules | **Partial** — deterministic EN+RU regex, latest user turn only |
| B003 | Manage public disclosure of technical detail | Optional | Repository is intentionally public (Apache-2.0) | **None** — deliberate |
| B004 | Endpoint scraping protection | Yes | `rate_limits` fixed-window counters (27) | **Partial** — rate limiting only; no bot detection |
| B005 | Real-time input filtering | Optional | Gateway input guard (26) | **Partial** |
| B006 | Prevent unauthorised agent actions | Yes | Default-deny `CallPolicy` (23), Cycle-of-Trust guard (22), protected-path hooks (24) | **Evidence** |
| B007 | Differentiate user access rights to the AI system | Yes | Per-tenant `sk-agw-*` keys; scoped bearer tokens on the audit endpoint | **Partial** — **the console BFF has no authentication at all** (documented in `docs/CONSOLE-API.md`); access control must be supplied by the operator's own backend |
| B008 | Protect the deployment environment | Yes | All host ports bind `127.0.0.1` by default; secrets encrypted at rest | **Partial** — no attestation of the deployment environment itself |
| B009 | Limit excessive disclosure in outputs | Yes | Output-leak gate (25) | **Partial** — streamed responses can only be flagged |
| B010 | Secure patterns in generated code | Yes | AAL static rules `untrusted→code-exec`, `config-rce`, `lethal-trifecta` | **Partial** — flow-level, not a code security scanner |

### d.4 C — Safety

| ID | Requirement | Mandatory | Evidence | Status |
|---|---|---|---|---|
| C001 | Define a risk taxonomy for the system | Yes | Failure taxonomy schema (`.../schema/failure.ts`); findings carry OWASP ASI + MITRE ATLAS mappings | **Partial** — the taxonomy exists in code, not as a published risk document |
| C002 | Pre-deployment testing of changes | Yes | Eval runs + canary states in `apl_improvement` (10) | **Partial** — the **CI gate that would block a regression is not wired** (28) |
| C003 | Prevent harmful outputs | Yes | — | **None** — no harmful-content eval suite in the corpus |
| C004 | Prevent out-of-scope outputs | Yes | — | **None** |
| C005 | Prevent agent-specific high-risk outputs | Yes | — | **None** |
| C006 | Prevent vulnerabilities in outputs (code injection, exfiltration) | Yes | AAL `data-exfil`, `config-rce`, `untrusted→code-exec` (1, 3) | **Partial** — 8-scenario corpus |
| C007 | Flag high-risk outputs for human review | Optional | `pending_approval` state in the remediation ledger (13) | **Partial** — AAL remediations only |
| C008 | Monitor risk categories | Optional | Findings by severity via `/api/findings`; `guard_events` by reason | **Partial** — snapshot only, no trend across scans |
| C009 | Real-time feedback and intervention | Optional | Kill switch (20), escalation (21) | **Partial** — stop, not steer |
| C010 | Third-party testing of harmful outputs, **quarterly** | Yes | — | **None** |
| C011 | Third-party testing of out-of-scope outputs, **quarterly** | Yes | — | **None** |
| C012 | Third-party testing of customer-defined risks, **quarterly** | Yes | — | **None** |

### d.5 D — Reliability

| ID | Requirement | Mandatory | Evidence | Status |
|---|---|---|---|---|
| D001 | Prevent hallucinations | Yes | `judge_verdict` recorded per sampled call in `request_ledger`; calibrated judges with Wilson lower bound (8); provenance-anchored golden sets (9) | **Partial** — the measurement plane exists; there is **no dedicated hallucination eval suite** in this repository |
| D002 | Third-party hallucination testing, **quarterly** | Yes | — | **None** |
| D003 | Restrict unsafe tool calls | Yes | Default-deny `CallPolicy` (23); Cycle-of-Trust guard (22); `tool-poisoning`, `tool-shadowing`, `mcp-rug-pull` attacks (3) | **Evidence** |
| D004 | Third-party tool-call testing, **quarterly** | Yes | — | **None** |

### d.6 E — Accountability

| ID | Requirement | Evidence | Status |
|---|---|---|---|
| E001 | Security breach response plan | `docs/OPERATIONS.md` is a recovery/backup runbook, not an IR plan | **None** |
| E002 | Harmful-output response plan | — | **None** |
| E003 | Response plan for hallucinations causing financial harm | — | **None** |
| E004 | Assign accountability (change approval) | `apl_improvement` status machine with typed author, and rejection of `judge-gated` authorship without patch + eval + calibration + canary (10); remediation ledger requiring an `hitl:<approver>` actor (13) | **Partial** — covers agent-improvement and AAL-remediation changes, not general repository changes |
| E005 | Document data-storage security | Schema and encryption are in code; no consolidated document | **Partial** |
| E006 | Vendor due diligence | Model and route recorded per call; pinned `model_snapshot_id` | **Partial** — data that supports a vendor file; the process itself is organisational |
| E007 | *(Retired Q1 2026 — merged into E004)* | — | n/a |
| E008 | Internal process review | — | **None** |
| E009 | Monitor third-party access | `tool_audit_events` ingests external agent-runtime activity via an authenticated endpoint; `key_id` per ledger row | **Partial** — no access-review reporting |
| E010 | Acceptable use policy | — | **None** |
| E011 | Track data-processing locations | — | **None** — deployment fact, not code |
| E012 | Document regulatory compliance | This document; `LICENSE`, `NOTICE` | **Partial** — a readiness map, not a compliance file |
| E013 | Quality management system | — | **None** |
| E014 | *(Retired Q1 2026 — merged into E017)* | — | n/a |
| E015 | Log AI-system activity | Surfaces 5, 6, 7, 11, 12 — traces with agent attribution, tool-use audit, guard events, per-call ledger | **Evidence** — the strongest row in this document |
| E016 | Disclose "this is AI, not a human" | Nothing found in the repository | **None** — same gap as EU AI Act Art. 50 |
| E017 | System transparency policy (model cards, datasheets) | Judge Card (8) is a model card **for the judge model only** | **Partial** |

### d.7 F — Society

| ID | Requirement | Evidence | Status |
|---|---|---|---|
| F001 | Guardrails against cyber misuse (text/automation/voice/code) | Input guard (26), default-deny call policy (23), protected-path hooks (24), AAL corpus (3) | **Partial** — architectural containment, not misuse classification |
| F002 | Guardrails against catastrophic misuse (CBRN) | None added by this platform; inherited from the upstream model provider | **None** |

---

## e. Honest gap list — what an auditor will ask for that does not exist

Ordered by how early it will block an engagement.

| # | What is asked | Why we cannot produce it | What would close it |
|---|---|---|---|
| 1 | **Independent third-party test reports, quarterly** (AIUC-1 B001, C010–C012, D002, D004) | All testing here is self-run. No accredited or third-party engagement exists | Contract an external red-team; establish and evidence a quarterly cadence |
| 2 | **End-user AI disclosure** (EU AI Act Art. 50 — live since 2026-08-02; AIUC-1 E016) | The platform renders no end-user surface and contains no disclosure component | Implement in the product layer; document who owns it in the contract |
| 3 | **Signed / tamper-evident evidence** | SARIF, ledger rows, audit events and JSONL are unsigned. cosign is used only for AgenticMind container images | Sign evidence bundles at export (e.g. cosign over the artifact digest) |
| 4 | **One evidence bundle for a date range** | Four disconnected retrieval paths: SARIF from a file, cost from JSONL, spans and audit from two different Postgres instances | An `agentic evidence --from --to` command producing one signed archive |
| 5 | **Log retention ≥ 6 months** (Art. 26) | `apl_span` retention is 90 days by default; `tool_audit_events`, `guard_events`, `request_ledger` and `evidence.jsonl` have **no retention policy at all** — they grow unbounded | Set one coherent policy: ≥ 6 months where the law requires it, bounded elsewhere |
| 6 | **Proof that a regression cannot ship** (AIUC-1 C002; DoD "CI blocks deploy on eval regression") | `eval-gate.yml` is a `TEMPLATE` with `TODO`s. `MIN_PASS_RATE` appears nowhere else in the repository or its submodules | Wire the gate into a real workflow with a real threshold |
| 7 | **Blast-radius limits** | Doctrine only. No code caps how many files, tenants, or records one autonomous action may touch | Implement and test a per-action cap |
| 8 | **Durable human-in-the-loop for a live run** | The remediation ledger is a genuine durable approval state machine, but scoped to AAL remediations. There is no pause/resume of an arbitrary agent run awaiting a human | Durable pause/resume in the runtime |
| 9 | **Policy-refusal audit trail** | `CallPolicy` denies by throwing. There is no persistent record of who tried to call whom and was refused | Journal denials to `guard_events` or the ledger |
| 10 | **A single cost/quality source of truth** | The rich SQLite ledger (with `judge_verdict` and cost-per-verified-outcome) and the JSONL the console actually reads are **different sources**. The dashboard does not show cost-per-verified-outcome | Have the console read the ledger, or export the ledger into the evidence stream |
| 11 | **Authenticated access to governance data** | The console BFF has no authentication and connects to Postgres as a superuser, so tenant RLS does not constrain it. It is safe only because it binds to loopback | Front it with the operator's authenticated backend (`examples/admin-proxy.ts`), and use a non-superuser role |
| 12 | **Corpus breadth proportional to the claim** | 8 attack scenarios across 3 files. This does not evidence "OWASP ASI Top 10 coverage", and contains no harmful-content, out-of-scope, or CBRN testing (AIUC-1 C003–C005, F002) | Expand the corpus, or narrow the claim to what the corpus tests |
| 13 | **Written policies** (A001, A002, E001–E003, E008, E010, E011, E013) | Organisational artifacts. No software produces them | Write them; this platform supplies the operational data several of them reference |

---

## f. Reproducing the evidence yourself

Nothing below requires trusting this document. Every command is runnable against a clean clone.

### f.0 Pin the ground truth

```bash
git clone --recurse-submodules <this-repo> && cd agentic-platform
git submodule status          # the commits every claim in this document describes
```

### f.1 Bring the platform up

```bash
cp integration/platform.env.example .env    # add your OPENROUTER_API_KEY
./cli/agentic install                        # puts `agentic` on PATH (~/.local/bin)
agentic up
agentic doctor                               # end-to-end wiring verdict
```

Default ports (from `integration/platform.env.example`): console `4600`, AgenticMind `4390`, gateway `8787`, Bifrost `4380`, ops `4700`, Mind Postgres `5435`, APL Postgres `5439`. All bind to `127.0.0.1`.

### f.2 Produce security findings (SARIF 2.1.0)

```bash
mkdir -p manifests
cd vendor/AgenticAssurance && bun install
bun run src/cli.ts scan ../../examples/manifests/agenticmind.json \
  --sarif  ../../manifests/agenticmind.sarif \
  --json   ../../manifests/agenticmind.assurance.json \
  --report ../../manifests/agenticmind.md \
  --runs 5 --seed 1
```

`--seed` makes the run reproducible. The CLI exits non-zero on any critical finding. With no runnable target it still runs the static graph and honestly reports every dynamic attack as `not_verified` — never as `safe`.

### f.3 Read the aggregated planes (read-only, loopback)

```bash
curl -s http://127.0.0.1:4600/api/overview | jq .
curl -s http://127.0.0.1:4600/api/findings | jq '.bySeverity'
curl -s http://127.0.0.1:4600/api/cost     | jq '{total, calls, byTenant}'
curl -s http://127.0.0.1:4600/api/traces   | jq '.agents'
```

### f.4 Cost ledger — the full record (not what the console shows)

```bash
sqlite3 vendor/AgenticGateway/data/agw.db \
  "SELECT tenant_id, model, route, outcome, cost_usd, judge_verdict, created_at
     FROM request_ledger ORDER BY created_at DESC LIMIT 20;"

# cost per verified outcome — the metric the dashboard does not render
sqlite3 vendor/AgenticGateway/data/agw.db \
  "SELECT SUM(cost_usd) / NULLIF(SUM(judge_verdict='pass'),0) FROM request_ledger;"

# budget state (fail-closed: no budget row = denied)
sqlite3 vendor/AgenticGateway/data/agw.db "SELECT * FROM budgets;"
```

### f.5 Decision evidence stream

```bash
jq -c 'select(.decision=="deny")' vendor/AgenticGateway/data/evidence.jsonl | tail -20
jq -s 'group_by(.event) | map({event: .[0].event, n: length})' \
   vendor/AgenticGateway/data/evidence.jsonl
```

Confirm the hash-not-text contract holds — this should return nothing:

```bash
jq -c 'select(has("prompt") or has("text") or has("response"))' \
   vendor/AgenticGateway/data/evidence.jsonl
```

### f.6 Traces, judges, evals (APL Postgres, port 5439 — credentials from your `.env`)

```sql
-- agent attribution
SELECT agent_id, agent_version, count(*) FROM apl_span GROUP BY 1,2 ORDER BY 3 DESC;

-- which judges are allowed to gate
SELECT version, status, card->'tpr_lower', card->'ece', card->'brier' FROM apl_judge;

-- eval sets that cannot gate a release
SELECT id, case_set_hash, origin FROM apl_eval_case WHERE origin IS NULL;

-- the change ledger
SELECT version_from, version_to, status, author, eval_run_id FROM apl_improvement
ORDER BY created_at DESC LIMIT 20;

-- retention actually in force
SELECT * FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention';
```

### f.7 Audit and guard events (Mind Postgres, port 5435)

```sql
SELECT event_kind, decision, count(*) FROM tool_audit_events GROUP BY 1,2;
SELECT reason, count(*) FROM guard_events GROUP BY 1 ORDER BY 2 DESC;
SELECT min(created_at), max(created_at) FROM tool_audit_events;  -- unbounded growth, see gap 5
```

### f.8 Verify the negative claims in this document

Do not take the gaps on faith either:

```bash
# gap 6 — no eval regression gate is wired anywhere
grep -rn "MIN_PASS_RATE" --include="*.yml" --include="*.yaml" .
# → only vendor/agentic-product-standard/templates/ci/eval-gate.yml (a TEMPLATE)

# gap 3 — signing covers container images only
grep -rln "cosign" --include="*.yml" --include="*.yaml" .
# → only vendor/AgenticMind/.github/workflows/release-images.yml

# gap 2 — no AI-disclosure component exists
grep -rn "is an AI\|ai_disclosure" --include="*.ts" vendor/ console/
# → no matches

# gap 11 — console DB role
sed -n '35,36p' console/bff/server.ts
```

---

## Maintenance

| Trigger | Action |
|---|---|
| Submodule pin moves | Re-verify every path in §b; paths are the load-bearing part of this document |
| AIUC-1 quarterly update | Re-check requirement IDs in §d; two IDs were already retired in Q1 2026 |
| Any EU AI Act amendment | Re-check §c.1 against EUR-Lex directly, not against commentary |
| A gap in §e closes | Move the row into §b with its path, and delete it from §e — not the other way round |

**Standing statement:** this platform produces artifacts. Certification is issued by an accredited auditor after an engagement that has not taken place. Anyone representing this document as evidence of certification is misrepresenting it.

---
