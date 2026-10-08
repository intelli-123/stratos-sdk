# Plan 1 — Stratos SDK: capture Claude on developer machines

**Repo:** `@intelli-1113/stratos-sdk` (its own package, not the Stratos app repo).
**Companion:** `review/11-stratos-app-plan.md` (the Stratos-app side). Read both — they meet at
the enrollment token + the `/api/ingest` contract.
**Scope:** Claude only. Capture a developer's Claude usage **and** execution (skills / sub-agents
/ hooks / mods / MCP) across surfaces (code / chat / cowork), **content-free**, over a logged-in
seat or an API key.

---

## Principles (shared with Plan 2)

- **A developer is not an agent.** An "agent" is an app/service that runs the SDK → one `agents`
  row via one token. A **developer** is a person using Claude across surfaces, onboarded by a
  **separate flow** (Plan 2, A-M4). Claude is never assumed installed — a developer who only
  builds agents keeps the existing Add-agent + SDK flow unchanged.
- **Identity = person × surface.** `alice · code`, `alice · chat`, `alice · cowork` — one agent
  per surface, all sharing `owner_email` and Team, so usage differentiates by surface yet rolls
  up per developer and team. One token = one agent → one token per person×surface.
- **Content-free.** Tokens + cost + model + latency + execution events only. **Never
  prompt/response.** Never read local session transcripts.
- **Reuse the SDK (OpenLLMetry/Traceloop) — no proxy.**
- **Instrumentation is config applied by MDM, not a side-effect of `npm i`.** Install does
  nothing on its own; a command + managed config turns it on (below).
- **Layered capture with a guaranteed floor:** (1) OpenLLMetry injection → per-call spans;
  (2) if it can't hook Claude Code's bundled transport, **native OTEL** → first-party usage,
  always emits; (3) **hooks** always fire for execution. Worst case still yields usage + skill
  execution.
- Seat cost is an **estimate** (tokens × rate card); the Admin usage API is the billing-truth
  option (Plan 2).

---

## Plan 0 — Spike (gates both plans; ~2–3 days)

Per surface (code / chat / cowork), establish the capture path in preference order:

1. **Injection** — `NODE_OPTIONS="--import @intelli-1113/stratos-sdk/register"`: does
   OpenLLMetry capture the surface's model calls as `gen_ai` usage spans, under a seat **and**
   an API key? If yes → Stratos-shaped spans directly, no bridge.
2. **Native OTEL + local bridge** — if injection can't hook the transport, does the surface emit
   standard OTLP (`OTEL_EXPORTER_OTLP_ENDPOINT`/`_HEADERS`) that a localhost bridge can receive
   and translate? (This resolves the `STRATOS_*`-vs-raw-OTEL mismatch.)
3. **Content-off** verified on the winning path (`TRACELOOP_TRACE_CONTENT=false` or OTEL
   resource config) → `prompt`/`response` null.
4. **Hooks** fire for skills / sub-agents / plugins / mods / commands and POST content-free events.
5. Classify each surface: **CLI/instrumentable** vs **closed GUI** → Admin-API-only fallback
   (person/org level, no per-skill).

---

## Milestones

### S-M1 · Usage plane + the `stratos setup` command *(layered, guaranteed floor)*
Build `stratos setup claude-code`: detect and configure the best capture tier —
(1) OpenLLMetry injection if it hooks Claude Code (per-call spans), else (2) native OTEL
(first-party usage) — write the content-off flag and the managed-settings/env, then run
`stratos doctor`. Confirm/add the SDK content-off switch.
**Done when:** on a machine where injection works *and* one where it doesn't, the command leaves
Claude Code emitting content-free usage into `/api/ingest`, verified by `doctor`.

### S-M2 · Local OTEL bridge *(the raw-OTEL handler; if Spike 2 is the path)*
A tiny localhost bridge shipped in the SDK (reuse the `stratos-mcp-proxy` harness). The surface
points its **standard** `OTEL_EXPORTER_OTLP_ENDPOINT` at `http://localhost:<port>`; the bridge
holds the Stratos URL + the person×surface token, receives OTLP metrics/logs, maps them to
Stratos usage/execution spans, attaches `x-stratos-token`, forwards to `STRATOS_URL`. Keeps the
token out of the tool's env; **no server change**.
- **Alternative (decide with the app team):** a Stratos OTLP-metrics endpoint (Plan 2, A-M3) and
  the surface posts direct. One or the other, not both.
- **Done when:** a surface configured with only standard OTEL vars lands correctly-shaped,
  content-free usage in Stratos.

### S-M3 · Execution plane — hooks/plugin bundle
Ship a Claude Code **plugin/mod** + `~/.claude/settings.json` hooks
(`PreToolUse`/`PostToolUse`/`SessionStart`/`Stop`/`SubagentStop`/`UserPromptSubmit`/
`Notification`) that POST content-free execution spans using the existing task prefixes
(`skill:`, `subagent:`, `hook:`, `cmd:`, `plugin:`), each carrying its surface's token. MCP keeps
flowing via `stratos-mcp-proxy` (`mcp:`).
**Done when:** a skill + a sub-agent in the `code` surface appear as `skill:`/`subagent:` nodes on
`alice · code`.

### S-M4 · Packaging, MDM delivery & self-check
One `npm i -g`; everything else is config applied by MDM:
- the enterprise **managed-settings file** + env (register hook or native-OTEL vars, content-off,
  hooks, bridge endpoint) — developer never hand-edits;
- **`stratos doctor`** — pings `STRATOS_URL`, validates the token, confirms the exporter/bridge is
  emitting, prints pass/fail;
- emit the per-developer bundle the app's enrollment (Plan 2, A-M4) produces: one block per surface.
- **Done when:** a clean machine, after an MDM push alone, passes `stratos doctor` and appears
  Connected in Stratos — no manual developer steps.

### S-M5 · Release
Versioned, backward compatible (existing agents unaffected), tested against a real session on each
instrumentable surface (usage + execution + content-null); published to npm/PyPI. **README documents
`npm i -g` → `stratos setup claude-code` → `stratos doctor`.**

---

## Setup UX (for the README)
```
npm i -g @intelli-1113/stratos-sdk
stratos setup claude-code      # writes Claude Code config, auto-selects capture tier
stratos doctor                 # confirms token + data flowing
```
MDM runs the same two commands non-interactively per developer, with the person×surface token
delivered as a secret.

## Risks
- **OpenLLMetry may not hook Claude Code's bundled transport** — not a blocker; native OTEL +
  hooks are the guaranteed floor and `stratos setup` auto-selects. Spike decides the primary tier.
- **Closed-GUI surfaces** (if chat/cowork aren't CLIs) → Admin-API fallback (person/org level).
- **Content-off must be verified**, or injection/bridge captures prompts we won't store.
- **No live kill** for telemetry/hook capture — governance (budget/alert/revocation) lives in the app.
