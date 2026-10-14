# Stratos SDK plan — Claude Code capture  [SDK]

**Repo:** `@intelli-1113/stratos-sdk` (its own package, not the Stratos app repo).
**Companion:** `review/stratos-app-plan.md` (server side). They meet at the shared org/team token
and the `/api/ingest` contract (`/v1/traces` → `/api/ingest`).

## Scope
Only **Claude Code** needs the SDK. **Cowork** needs none (it exports native OTEL logs configured
org-wide in Claude Desktop — server-only). **Managed Agents** are pulled server-side. Claude chat
is out of scope (no telemetry export).

Scope is smaller than the first draft: Claude Code's native OTEL traces already post **directly**
to Stratos via the `/v1/traces` rewrite (observed live), so **no local bridge**.

## Identity rule (drives the SDK design)
A token is **shared** — one MDM bundle for a whole team — so the token identifies the **org/team**,
never a person. The person comes from Claude Code's own identity attributes on each span
(`user.email`, `user.account_uuid`), resolved server-side. **The SDK never needs to know who is
typing**, and every developer gets the same bundle.

## Principles
Content-free (tokens / cost / model / latency / execution events; never prompt or response; no
transcript reads). Cost is computed server-side (cache-aware). Seat cost is an estimate.

## Spike (gates the milestones)
- Confirm Claude Code native traces + hooks under the **enhanced-telemetry beta**.
- Confirm what the existing `execution-spans.js` already covers.
- Confirm **which identity attributes** (`user.email`, `user.account_uuid`) Claude Code puts on
  trace spans under **OAuth vs API-key** auth (API-key sessions may carry no account email → the
  server's "Unattributed" bucket).

## Milestones
### A-S1 · `stratos setup claude-code`
Writes Claude Code's native-OTEL config — `CLAUDE_CODE_ENABLE_TELEMETRY`, the enhanced-telemetry
beta flag, `OTEL_*`, and the **shared org/team token** — into `~/.claude/settings.json` or the
enterprise managed-settings file. Content-off by default. OpenLLMetry injection only as an optional
richer tier if the spike shows it hooks the transport.
**Done when:** a fresh machine, after `stratos setup claude-code`, sends traces that land in Stratos.

### A-S2 · Execution hooks
Verify/extend `execution-spans.js` + Claude Code hooks so skills / sub-agents / hooks / commands /
plugins emit `skill:` / `subagent:` / `hook:` / `cmd:` / `plugin:` spans (zero-token, zero-cost)
with the shared token. MCP via `stratos-mcp-proxy` (`mcp:`). *(Bridge dropped — not needed.)*
**Done when:** a skill and a sub-agent appear as execution nodes for the right developer.

### A-S3 · `stratos doctor` + MDM packaging
Add the `doctor` bin (today `package.json` exposes no such command): pings `STRATOS_URL`, validates
the token, confirms emission, prints pass/fail. Document MDM delivery of the managed-settings file.
**Done when:** a machine configured by MDM alone passes `stratos doctor`.

### A-S4 · Release
Versioned, backward compatible, tested on a real Claude Code session (usage + execution,
content-null); published.

## Sequencing
Spike → A-S1 → A-S2 → A-S3 → A-S4. Starts in parallel with the server work once the server's
shared-token model (D-M2) is defined.

## Risks
- Native traces depend on Claude Code's enhanced-telemetry **beta** — `doctor` must report clearly
  if a version stops emitting.
- API-key sessions may carry no identity → they land as Unattributed (by design, not counted as
  developers).
- Content-off must be verified, or injection could capture prompts we won't store.
