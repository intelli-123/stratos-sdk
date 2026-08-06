# @intelli-1113/stratos-sdk

**One install** for [Stratos AI](https://github.com) agent observability:

1. **OpenLLMetry / Traceloop** — LLM traces (model, tokens, prompts, tools, latency)
2. **OTLP JSON → Stratos** — export to your dashboard (`/api/ingest`)
3. **Heartbeat** — agent stays “online” between calls (`/api/heartbeat`)
4. **Vercel AI auto-telemetry** — no `experimental_telemetry` in client code
5. **`stratos-mcp-proxy`** — tool-call metering for host MCP servers

| | |
|---|---|
| **Package** | `@intelli-1113/stratos-sdk` |
| **Version** | `1.3.1` |
| **Runtime** | Node.js **≥ 18** (ESM; **≥ 20** recommended for LangChain instrumentation) |
| **Default Stratos URL** | `http://localhost:4000` |

---

## Table of contents

- [What you get](#what-you-get)
- [Install](#install)
- [Configure](#configure)
- [How to use](#how-to-use)
- [What is supported](#what-is-supported)
- [LangChain version inspect & fix](#langchain-version-inspect--fix)
- [Vercel AI SDK (important)](#vercel-ai-sdk-important)
- [Environment reference](#environment-reference)
- [Auto-detected metadata](#auto-detected-metadata)
- [MCP proxy](#mcp-proxy)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Security & privacy](#security--privacy)
- [API](#api)

---

## What you get

| Feature | Description |
|--------|-------------|
| **Liveness** | Heartbeat so the agent shows online in Stratos |
| **LLM spans** | Model name, token usage, latency, prompts/outputs (when enabled) |
| **Tool spans** | Tool name, args, results (from instrumented frameworks / MCP proxy) |
| **Zero agent logic changes** | Prefer `node --import …/register` — no instrumentation in business code |
| **`.env` load** | On `--import`, loads `./.env` from `cwd` so `STRATOS_TOKEN` is available early |
| **MCP host tools** | `stratos-mcp-proxy` wraps Claude Desktop / Cursor / VS Code MCP servers |
| **LangChain inspect** | `stratos-inspect` checks core version; optional uninstall old + install 1.x |

Traces go to:

```http
POST {STRATOS_URL}/api/ingest
Header: x-stratos-token: <STRATOS_TOKEN>
Body: OTLP/JSON
```

---

## Install

```bash
npm i @intelli-1113/stratos-sdk
```

For MCP proxy use from a host app (global CLI):

```bash
npm i -g @intelli-1113/stratos-sdk
```

---

## Configure

1. Open **Stratos AI** → **Add agent** → copy the enrollment **token**.
2. Set environment variables (shell or `.env` in the project root):

```env
# Required
STRATOS_TOKEN=your_enrollment_token_here

# Optional (defaults shown)
STRATOS_URL=http://localhost:4000
STRATOS_APP_NAME=my-agent
```

Production example:

```env
STRATOS_TOKEN=...
STRATOS_URL=https://stratos.example.com
STRATOS_APP_NAME=checkout-agent
```

> Change token/URL anytime and **restart** the process. No code change required.

---

## How to use

### Option A — Zero app-code changes (**recommended**)

Preload the SDK before your app. This is the **required** style for **Vercel AI SDK**.

```bash
node --import @intelli-1113/stratos-sdk/register server.js
```

`package.json`:

```json
{
  "scripts": {
    "start": "node --import @intelli-1113/stratos-sdk/register server.js",
    "dev": "node --import @intelli-1113/stratos-sdk/register --watch server.js"
  }
}
```

Windows PowerShell (same idea):

```powershell
node --import @intelli-1113/stratos-sdk/register .\server.js
```

Your application code stays normal (no Stratos APIs required):

```js
// server.js — business logic only
import { generateText } from "ai";
import { mistral } from "@ai-sdk/mistral";
// or: ChatMistralAI from @langchain/mistralai, OpenAI SDK, etc.

const { text } = await generateText({
  model: mistral("mistral-large-latest"),
  prompt: "Hello",
});
```

### Option B — First import in the entrypoint

Works well for **LangChain**, **OpenAI**, **Anthropic**, **Google GenAI**, etc. (Traceloop auto-patches these **if** this import runs before those libraries load).

```js
import "@intelli-1113/stratos-sdk/register"; // must be first
import { ChatOpenAI } from "@langchain/openai";
// ... rest of app
```

> **Vercel AI note:** a normal `import "@intelli-1113/stratos-sdk/register"` in the **same file** as `import { generateText } from "ai"` is often **too late** (ESM links the whole graph before evaluation). Use **Option A (`--import`)** for Vercel AI.

### Option C — Programmatic `start()`

```js
import { start } from "@intelli-1113/stratos-sdk";

start({
  token: process.env.STRATOS_TOKEN,
  url: process.env.STRATOS_URL,       // optional
  appName: "my-agent",                // optional
  model: "mistral-large-latest",      // optional heartbeat metadata
  tools: ["web_search"],              // optional heartbeat metadata
  framework: "vercel-ai",             // optional override
  heartbeatMs: 30000,                 // optional
});
```

For Vercel AI with Option C, still prefer launching with `--import @intelli-1113/stratos-sdk/register` so the ESM loader is active, **or** call `start()` only after registering the loader yourself (Option A is simpler).

---

## What is supported

### Auto-instrumented stacks (OpenLLMetry / Traceloop)

These emit rich LLM/tool spans **without** client telemetry flags, when the SDK loads **before** the library:

| Stack | Node support via this SDK | Notes |
|-------|---------------------------|--------|
| **LangChain.js** | Yes | Agents, tools, chat models |
| **LangGraph.js** | Yes | Same family as LangChain |
| **LlamaIndex.TS** | Yes | When package is present |
| **OpenAI SDK** (`openai`) | Yes | Chat/completions |
| **Anthropic SDK** | Yes | Messages API |
| **Google Generative AI / GenAI** | Yes | Direct Google SDKs |
| **AWS Bedrock** (SDK path) | Yes | Via Traceloop instrumentation |
| **Together AI** | Yes | Via Traceloop |
| **Vertex AI** | Yes | Via Traceloop |
| **Vercel AI SDK** (`ai`) | Yes (**Stratos-specific**) | See [below](#vercel-ai-sdk-important) — needs `--import` |

### Model providers (examples)

Model choice is independent of framework. These are common pairs:

| Provider | Typical packages | Observed when |
|----------|------------------|---------------|
| OpenAI | `openai`, `@ai-sdk/openai`, LangChain OpenAI | Instrumented path or Vercel AI + Stratos loader |
| Anthropic | `@anthropic-ai/sdk`, `@ai-sdk/anthropic` | Same |
| Google / Gemini | `@google/generative-ai`, `@google/genai`, `@ai-sdk/google` | Same |
| Mistral | `@ai-sdk/mistral`, `@langchain/mistralai` | Same |
| Azure OpenAI / Bedrock | respective SDKs or LangChain | Via instrumented SDKs / LangChain |

### Not automatic (needs extra work or different product path)

| Approach | Why |
|----------|-----|
| Raw `fetch` to LLM HTTP APIs | Nothing to patch |
| Custom agent runtimes with no OTel | No spans unless you emit OTLP yourself |
| Python agents | Use the **Python** Stratos / OpenLLMetry package if provided (this package is **Node**) |
| Frameworks without OpenLLMetry support | May only show heartbeat until support is added |

### Heartbeat-only vs full traces

| You see in Stratos | Meaning |
|--------------------|---------|
| Agent **online**, little detail | Heartbeat works; few/no LLM spans |
| Model, tokens, tools, prompts | Spans reached `/api/ingest` |

---

## LangChain version inspect & fix

Stratos LangChain **metrics** need:

```text
@langchain/core  >= 1.0.0  and  < 2.0.0
```

(from `@traceloop/instrumentation-langchain`, e.g. `^1.2.4` works).

Installing the SDK **does not** auto-upgrade the client’s LangChain 0.x app.
Use **`stratos-inspect`** in the **client project** to check and optionally fix.

### Inspect only

```bash
cd /path/to/client-agent
npx stratos-inspect
```

JSON:

```bash
npx stratos-inspect --json
```

### Uninstall old LangChain (&lt;1.0) and install 1.x

Interactive (asks y/N):

```bash
npx stratos-inspect --fix
```

Non-interactive (CI / scripts):

```bash
npx stratos-inspect --fix --yes
```

Dry run (show plan only):

```bash
npx stratos-inspect --fix --dry-run
```

What `--fix` does:

1. Detects LangChain family packages in the project
2. If `@langchain/core` is **&lt; 1.0** → uninstalls those packages
3. Installs recommended **1.x** set (`@langchain/core@^1.2.4`, `langchain@^1.5.4`, plus any previous `@langchain/*` providers at `^1`)
4. Uses npm / pnpm / yarn / bun based on lockfile

It will **not** auto-downgrade core **≥ 2.0**.

### After install of Stratos

`postinstall` prints a warning if LangChain is present but incompatible (does **not** change deps).

At runtime, `start()` / `register` also warns and suggests `npx stratos-inspect --fix`.

Hard-fail on start if desired:

---


### What the SDK does for Vercel AI

1. Registers a Node **custom module loader** on `register`
2. Intercepts bare imports of `"ai"`
3. Re-exports the real package
4. Wraps `generateText`, `streamText`, `generateObject`, `streamObject`, `embed`, `embedMany`, and related helpers
5. Injects telemetry defaults (`experimental_telemetry` / `telemetry`)

### Client code (unchanged)

```js
import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
// import { mistral } from "@ai-sdk/mistral";
// import { google } from "@ai-sdk/google";

await generateText({
  model: openai("gpt-4o"),
  prompt: "Summarize today's agenda",
  tools: { /* ... */ },
  stopWhen: stepCountIs(5),
});
```

### How the client starts the process

```bash
node --import @intelli-1113/stratos-sdk/register app.js
```

### Opt-out

| Goal | Setting |
|------|---------|
| Disable Vercel AI wrapping entirely | `STRATOS_VERCEL_AI=0` |
| Do not record prompts | `STRATOS_RECORD_INPUTS=0` |
| Do not record completions | `STRATOS_RECORD_OUTPUTS=0` |
| Disable one call only | Pass `experimental_telemetry: { isEnabled: false }` (or `telemetry: { isEnabled: false }` on AI SDK v7) |

### AI SDK v7

If the app also installs `@ai-sdk/otel`, the SDK will try `registerTelemetry(new OpenTelemetry())` when available. The loader-based wrap still covers v5/v6-style `experimental_telemetry`.

---

## Environment reference

### Core

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STRATOS_TOKEN` | **Yes** | — | Enrollment token from Stratos → Add agent |
| `STRATOS_URL` | No | `http://localhost:4000` | Stratos origin (no trailing slash required) |
| `STRATOS_APP_NAME` | No | `npm_package_name` or `"agent"` | Display name / `service.name` |
| `STRATOS_HEARTBEAT_MS` | No | `30000` | Heartbeat interval (ms). `0` disables interval |

### Metadata overrides

| Variable | Description |
|----------|-------------|
| `STRATOS_FRAMEWORK` | Force framework label (`langchain`, `vercel-ai`, `langgraph`, …) |
| `STRATOS_MODEL` | Preferred model label for heartbeat |
| `NVIDIA_MODEL` / `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GEMINI_MODEL` / `GOOGLE_MODEL` / `LLM_MODEL` / `MODEL` | Fallback model detection for heartbeat |
| `STRATOS_TOOLS` | Comma-separated tool names for heartbeat (`web_search,retriever`) |
| `STRATOS_FUNCTION_ID` | Default `functionId` on injected Vercel AI telemetry |
| `STRATOS_STRICT_LANGCHAIN` | Set `1` to throw on start if LangChain core is &lt; 1.0 |
| `STRATOS_SKIP_POSTINSTALL` | Set `1` to skip postinstall LangChain warning |

### Vercel AI controls

| Variable | Default | Description |
|----------|---------|-------------|
| `STRATOS_VERCEL_AI` | on | Set `0` / `false` / `off` to disable auto wrap |
| `STRATOS_RECORD_INPUTS` | on | Set `0` to skip recording prompts |
| `STRATOS_RECORD_OUTPUTS` | on | Set `0` to skip recording outputs |

---

## Auto-detected metadata

On each heartbeat the SDK POSTs JSON to `{STRATOS_URL}/api/heartbeat` with:

| Field | Source |
|-------|--------|
| **framework** | `package.json` deps / resolution, or `STRATOS_FRAMEWORK` |
| **model** | Env vars above or `start({ model })` |
| **tools** | `STRATOS_TOOLS` or `start({ tools })` (spans refine tools over time) |

Detection order for framework (first match wins, unless overridden):

1. Google ADK
2. OpenAI Agents
3. LlamaIndex
4. CrewAI
5. LangGraph
6. LangChain
7. Vercel AI (`ai`)
8. Google GenAI SDKs
9. Anthropic SDK
10. OpenAI SDK

> If a project installs **both** LangChain and Vercel AI, framework detection may prefer LangChain. Set `STRATOS_FRAMEWORK=vercel-ai` (or use separate apps/tokens) when needed.

---

## MCP proxy

Host-launched MCP servers (Claude Desktop, Cursor, VS Code, …) do not run your Node agent process. Use the bundled CLI to proxy **tool calls**:

```bash
npm i -g @intelli-1113/stratos-sdk
```

Host config example:

```json
{
  "mcpServers": {
    "weather": {
      "command": "stratos-mcp-proxy",
      "args": ["--", "npx", "-y", "@scope/weather-mcp@latest"],
      "env": {
        "STRATOS_TOKEN": "<token>",
        "STRATOS_URL": "http://localhost:4000",
        "STRATOS_APP_NAME": "weather"
      }
    }
  }
}
```

| Behavior | Detail |
|----------|--------|
| Protocol | Forwards JSON-RPC stdio **verbatim** |
| Telemetry | Each `tools/call` → OTLP-like span on `/api/ingest` |
| Liveness | Heartbeat on `/api/heartbeat` |
| Logging | **stderr only** (stdout is reserved for MCP) |
| LLM tokens | **Not** captured (MCP servers usually don’t call the LLM) |

Usage:

```bash
stratos-mcp-proxy -- <command> [args...]
```

---

## How it works

```text
┌─────────────────────┐
│  Your agent process │
│  (Node.js)          │
└──────────┬──────────┘
           │ 1. --import register
           ▼
┌─────────────────────┐
│  stratos-sdk        │
│  • load .env        │
│  • Vercel AI loader │
│  • Traceloop init   │
│  • OTLP JSON export │
│  • heartbeat loop   │
└──────────┬──────────┘
           │
           ├─ POST /api/ingest     (spans: LLM + tools)
           └─ POST /api/heartbeat  (online + metadata)
                      │
                      ▼
              ┌───────────────┐
              │  Stratos AI   │
              │  :4000 UI     │
              └───────────────┘
```

- **LangChain / OpenAI / …** → Traceloop instrumentations create spans.
- **Vercel AI** → Stratos loader injects telemetry so the `ai` package creates OTel spans; Traceloop exports them.
- **MCP** → `stratos-mcp-proxy` synthesizes tool spans.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `[stratos] STRATOS_TOKEN not set` | Token missing at process start | Set `STRATOS_TOKEN` or put it in `.env` in `cwd` |
| Agent online, no tokens/tools | Framework not instrumented or Vercel AI without `--import` | Use `--import …/register`; confirm stack is supported |
| Vercel AI still no spans | Started without `--import` | `node --import @intelli-1113/stratos-sdk/register app.js` |
| Wrong framework label | Mixed deps in one `package.json` | Set `STRATOS_FRAMEWORK=vercel-ai` (or `langchain`) |
| Spans lost on short CLI scripts | Process exited before flush | SDK flushes on `beforeExit` / signals; keep process alive until request finishes |
| MCP tools not showing | Proxy not wrapping command / no token | Use `stratos-mcp-proxy -- …` and set env on the host config |
| Local Stratos empty | Wrong URL | Default is `http://localhost:4000`; ensure Stratos is running |

Verify the SDK loaded:

```text
[stratos] telemetry → http://localhost:4000/api/ingest (heartbeat 30000ms, framework=…)
[stratos] vercel-ai auto-telemetry: esm-loader-shim   # when Vercel path is active
```

---

## Security & privacy

- **Token** — treat `STRATOS_TOKEN` like a secret; do not commit it.
- **Prompts/outputs** — may be sent in spans. Disable with:
  - `STRATOS_RECORD_INPUTS=0`
  - `STRATOS_RECORD_OUTPUTS=0`
- **Network** — telemetry is sent to `STRATOS_URL` only.
- **MCP proxy** — tool args/results are reported; avoid secrets in tool arguments when possible.

---

### Entry points

| Import | Purpose |
|--------|---------|
| `@intelli-1113/stratos-sdk/register` | Side-effect: env + Vercel loader + `start()` |
| `@intelli-1113/stratos-sdk` | `{ start }` for programmatic use |

### CLI

| Command | Purpose |
|---------|---------|
| `stratos-inspect` | Check LangChain compatibility in current project |
| `stratos-inspect --fix [--yes]` | Uninstall old LangChain and install 1.x |
| `stratos-mcp-proxy -- <cmd> [args…]` | MCP stdio proxy with tool telemetry |

### `inspectLangChain()` / `fixLangChain()`

See [LangChain version inspect & fix](#langchain-version-inspect--fix).

---

## Requirements

- **Node.js** 18+ (20+ recommended; `.env` via `process.loadEnvFile` when available)
- Network reachability to Stratos (`STRATOS_URL`)
- Valid **STRATOS_TOKEN** from the Stratos UI

---

## License

MIT

---

## Changelog (recent)

### 1.3.1

- **`stratos-inspect`** CLI: check LangChain core version; optional `--fix` uninstall old + install 1.x
- **postinstall** warning if LangChain &lt; 1.0
- Runtime warning on `start()`; optional `STRATOS_STRICT_LANGCHAIN=1`
- Exports: `inspectLangChain`, `fixLangChain`

### 1.3.0

- Auto Vercel AI SDK telemetry via ESM module loader (no client `experimental_telemetry`)
- Load `.env` from `cwd` when using `--import`
- Document `--import` as the recommended zero-code entry
- Framework / model / tools heartbeat metadata retained
- MCP proxy unchanged in purpose (`stratos-mcp-proxy`)
