# How Stratos disables an agent (Control Tower + this SDK)

Disable is **not** “kill the Node process.” Stratos sets a flag in Postgres; **this SDK** (`@intelli-1113/stratos-sdk`) learns it on the next heartbeat and **refuses outbound LLM / tool calls**. The agent process stays up, but it cannot talk to OpenAI, Anthropic, Bedrock Runtime, etc.

This only applies to **Custom / self-hosted** agents that run the SDK (or `stratos-mcp-proxy`). Cloud-synced providers (Bedrock, LangSmith, Anthropic, Salesforce) cannot be disabled this way.

---

## End-to-end picture

```
  Operator in Stratos AI (Onboarding / Agents)
           │
           │  POST /api/agents/{id}/status-requests
           │  { requested_status: "disabled", reason? }
           ▼
  agent_status_requests  (pending)
           │  emails + optional Jira webhook
           │  (disable_alert_emails, disable_jira_webhook_url)
           ▼
  Approver (BU Head, or admin if no BU Head)
           │  PATCH /api/agent-status-requests?id=…
           │  { approve: true }
           ▼
  RPC agent_status_request_decide
           │  agents.status = 'disabled'
           ▼
  Agent process (this SDK)
           │  POST /api/heartbeat  every ~30s  (header x-stratos-token)
           │  response: { ok, blocked: true, reason: "Agent disabled from the Stratos Control Tower." }
           ▼
  SDK setBlocked(true)
           │
           ├─ LLM agents: patched fetch / http / https → StratosBudgetBlockedError
           └─ MCP proxy: JSON-RPC tools/call refused before the child MCP starts
```

Until **approval**, the agent is still **online** and can still call models. Request ≠ disable.

---

## 1. Operator requests disable (Stratos UI)

- Custom Provider agents only (`isCloudSyncedFramework` is false).
- `POST /api/agents/{id}/status-requests` with `requested_status: "disabled"`.
- Creates a **pending** row in `agent_status_requests`. A second pending request is rejected (`409`).
- Already `disabled` → `400`.

**Alerts (optional, set on the agent form):**

| Channel | When |
|---|---|
| `disable_alert_emails` | Request submitted, and again when approved |
| `disable_jira_webhook_url` | Request submitted only (`event: agent.disable.requested`) |

Approvers get a separate email: BU Heads for the agent’s BU, or full admins if none.

**Enable** is the reverse: `requested_status: "offline"` (meaning “leave disabled state”) and the same approval flow.

---

## 2. Approver flips `agents.status`

- `PATCH /api/agent-status-requests?id={requestId}` `{ approve: true }`.
- SQL function `agent_status_request_decide` applies the status change **atomically** and blocks self-approval.
- Rejection requires a note; status is **not** changed.
- After approve of disable: confirmation email to `disable_alert_emails` (no second webhook).

The live process is **not** signaled here. It finds out on heartbeat.

---

## 3. Heartbeat is the control channel

SDK (`src/index.js`) and MCP proxy (`src/mcp-proxy.js`) POST:

```http
POST {STRATOS_URL}/api/heartbeat
Header: x-stratos-token: <enrollment token>
Body:   { framework, model, tools }   (SDK only; proxy may omit)
```

Default interval: **30s** (`STRATOS_HEARTBEAT_MS`).

`pages/api/heartbeat.ts`:

1. Resolve the token → `agent_id` (hash, then legacy plaintext).
2. Load `agents.status` (and framework).
3. If `status === "disabled"` → `blocked: true`, reason  
   `"Agent disabled from the Stratos Control Tower."`
4. Else, for custom agents, also block if the **circuit breaker** is open or **manual kill**.
5. Update `last_seen` always. **Do not** set `status: "online"` when blocked (that would undo disable).

Response:

```json
{ "ok": true, "blocked": true, "reason": "Agent disabled from the Stratos Control Tower." }
```

or `{ "ok": true, "blocked": false }` when allowed.

If heartbeat fails (network, 401), the SDK **does not** freeze the agent. Fail-open: `_blocked` stays as last known; it starts **unblocked**.

---

## 4. What the SDK does with `blocked`

### 4.1 Install order (`src/register.js`)

`node --import @intelli-1113/stratos-sdk/register app.js`

1. Load `.env`
2. **`installNetworkGuard()`** — patch `fetch` / `http.request` / `https.request` **before** OpenAI/Anthropic/LangChain import
3. Vercel AI loader
4. `start()` — OTLP ingest + heartbeat loop → `setBlocked(data.blocked, data.reason)`

### 4.2 Network guard (`src/enforcement.js`)

When `_blocked` is true, any request whose host matches a **provider** list is refused:

- `api.openai.com`, `api.anthropic.com`, Gemini, Vertex, `bedrock-runtime.`, Cohere, Mistral, OpenRouter, Together, Groq, Azure OpenAI
- Extra hosts: `STRATOS_BLOCK_HOSTS` (comma-separated substrings)

**Never** blocked: Stratos’s own host (`STRATOS_URL`) so the agent can still heartbeat and learn it was **unblocked**.

Refusal:

```text
StratosBudgetBlockedError: [stratos] request blocked: Agent disabled from the Stratos Control Tower.
```

(`stratosBlocked: true`)

Same flag is used for **budget / circuit breaker**; the SDK does not distinguish *why*.

### 4.3 MCP proxy (`src/mcp-proxy.js`)

Patching `fetch` in the proxy process does **not** stop the child MCP. At JSON-RPC `tools/call`:

- If blocked: **do not** write to the child stdin
- Return JSON-RPC error `-32001` (`Stratos: blocked — …`)
- Still report the refusal to `/api/ingest` so it shows in Stratos

---

## 5. What disable does **not** do

- Kill or restart the Node process
- Stop heartbeats (`last_seen` still updates)
- Stop ingest of spans that already left the process
- Work for Bedrock / LangSmith / Anthropic / Salesforce (those are API-synced; `403` on status-requests)
- Block arbitrary HTTP (only known LLM hosts + `STRATOS_BLOCK_HOSTS`)
- Block MCP tools unless traffic goes through `stratos-mcp-proxy`

---

## 6. Timing

| Event | Agent still calling models? |
|---|---|
| Disable **requested** | Yes |
| Disable **approved** | Yes, until next heartbeat |
| Next heartbeat (≤ ~30s) | No — provider calls throw / MCP tools/call refused |
| Enable **approved** | Still blocked until next heartbeat returns `blocked: false` |

Worst-case extra runtime after approve ≈ heartbeat interval.

---

## 7. Files

| Piece | File |
|---|---|
| Request disable | Stratos `pages/api/agents/[id]/status-requests.ts` |
| Approve / apply status | Stratos `pages/api/agent-status-requests.ts` + RPC `agent_status_request_decide` |
| Emails / Jira | Stratos `lib/agentDisableNotify.ts` |
| Heartbeat + `blocked` | Stratos `pages/api/heartbeat.ts` |
| Heartbeat client | SDK `src/index.js`, `src/mcp-proxy.js` |
| Refuse LLM HTTP | SDK `src/enforcement.js` |
| Guard install | SDK `src/register.js` |
| Refuse MCP tools | SDK `src/mcp-proxy.js` |

---

## 8. Operator checklist

1. Agent is **Custom Provider**, running with  
   `node --import @intelli-1113/stratos-sdk/register …`  
   and `STRATOS_TOKEN` / `STRATOS_URL`.
2. Request disable → wait for BU Head/admin approval.
3. Within ~30s, agent logs:  
   `[stratos] BLOCKED: Agent disabled from the Stratos Control Tower.`
4. Next LLM call fails with `StratosBudgetBlockedError`.
5. To resume: request **enable**, approve, wait for heartbeat `unblocked`.
