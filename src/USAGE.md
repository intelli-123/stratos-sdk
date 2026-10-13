# How to use the Stratos SDK

`@intelli-1113/stratos-sdk` connects things that use AI to **Stratos**, so their activity (models, tokens, tools) shows up in the Stratos dashboard.

Pick the section that matches you:

| You are… | What you connect | Go to |
|---|---|---|
| A team running a **Node.js AI agent** (LangChain, OpenAI, Anthropic, Vercel AI, …) | Your agent process | [For agents](#1-for-agents) |
| A **developer using Claude Code** (terminal, desktop app or IDE) | Your own Claude Code usage | [For developers using Claude Code](#2-for-developers-using-claude-code) |
| A developer using **MCP tools** in Claude Desktop, Cursor or VS Code | Tool calls to an MCP server | [MCP tools](#3-for-developers-using-mcp-tools) |
| Someone **working on this SDK** | The SDK code itself | [Contributing](#4-for-developers-working-on-this-sdk) |

**Before you start, you need:**
- **Node.js 20.12 or newer**: check with `node --version`.
- **A token from Stratos**: in Stratos, open **Add agent** and copy the token. The server decides the token format; use it exactly as given.
- **The Stratos URL**, e.g. `https://stratos.example.com`. For a local Stratos it is `http://localhost:4000`, which is the default.

Treat the token like a password: don't commit it or paste it into chats.

---

## 1. For agents

This is for an AI agent written in Node.js that runs as a server, worker or script.

### Step 1: Install

In your agent's project folder:

```bash
npm install @intelli-1113/stratos-sdk
```

### Step 2: Add the token

Create a `.env` file in the project folder, or set the same variables in your deployment:

```env
STRATOS_TOKEN=<your-token>
STRATOS_URL=https://stratos.example.com
STRATOS_APP_NAME=checkout-agent
```

`STRATOS_APP_NAME` is the name shown in the dashboard.

### Step 3: Start your agent with the SDK loaded

**Recommended: no code changes.** Add `--import` to the command that starts your agent:

```bash
node --import @intelli-1113/stratos-sdk/register server.js
```

Or in `package.json`:

```json
{
  "scripts": {
    "start": "node --import @intelli-1113/stratos-sdk/register server.js"
  }
}
```

**Other options**, if you can't change the start command:

```js
// Option B: the very first line of your entry file
import "@intelli-1113/stratos-sdk/register";
```

```js
// Option C: start it yourself
import { start } from "@intelli-1113/stratos-sdk";
start({ token: process.env.STRATOS_TOKEN, url: process.env.STRATOS_URL, appName: "checkout-agent" });
```

> **Using the Vercel AI SDK (`ai` package)?** Use the `--import` option. With options B and C, the `ai` package can load before the SDK and its calls won't be tracked.

### Step 4: Check it works

When the agent starts you should see:

```text
[stratos] telemetry → https://stratos.example.com/api/ingest (heartbeat 30000ms, framework=langchain)
```

Within about 30 seconds the agent shows as **online** in Stratos. After its first AI call, the model, tokens and tools appear.

### What gets tracked

| Works automatically | Notes |
|---|---|
| LangChain / LangGraph | Needs `@langchain/core` 1.x; run `npx stratos-inspect` to check |
| OpenAI, Anthropic, Google GenAI, Bedrock, Vertex, Together, LlamaIndex SDKs | Through OpenLLMetry (Traceloop) |
| Vercel AI SDK (`ai`) | Only when started with `--import` |
| Raw `fetch` calls to an AI API, Python agents | **Not tracked**: only the heartbeat shows |

### Keeping prompts private

By default, prompt and answer text is sent with each call. To send only model, token and tool data:

```env
STRATOS_RECORD_INPUTS=0
STRATOS_RECORD_OUTPUTS=0
```

### When Stratos blocks your agent

If your agent goes over budget or is disabled in the Stratos Control Tower, the SDK learns it from its next heartbeat, within about 30 seconds. From then on, calls to AI providers fail with a `StratosBudgetBlockedError`, and the log shows:

```text
[stratos] BLOCKED: <reason> — outbound calls to LLM providers will be refused until this clears.
```

Calls resume by themselves once Stratos unblocks the agent. Catch `StratosBudgetBlockedError` (it has `err.stratosBlocked === true`) if your agent should handle this gracefully.

### Useful settings

| Variable | Default | What it does |
|---|---|---|
| `STRATOS_TOKEN` | (required) | Token from Stratos |
| `STRATOS_URL` | `http://localhost:4000` | Stratos server |
| `STRATOS_APP_NAME` | package name | Name in the dashboard |
| `STRATOS_HEARTBEAT_MS` | `30000` | How often to check in (minimum 1000) |
| `STRATOS_FRAMEWORK` | auto-detected | Force the framework label, e.g. `vercel-ai` |
| `STRATOS_MODEL` | auto-detected | Model label shown on the heartbeat |
| `STRATOS_BLOCK_HOSTS` | (none) | Extra AI hostnames to block when Stratos blocks the agent, comma-separated |
| `STRATOS_VERCEL_AI` | on | `0` turns off the Vercel AI wrapper |
| `STRATOS_DEBUG` | off | `1` prints detailed logs |

The full list is in [README.md](README.md#environment-reference).

### Troubleshooting

| You see | Fix |
|---|---|
| `STRATOS_TOKEN not set — telemetry disabled` | Put the token in `.env` in the folder you start the agent from, or set it in the environment |
| Agent online but no models or tokens | Start with `--import`, and check your framework is in the table above |
| LangChain warning at start | Run `npx stratos-inspect`, then `npx stratos-inspect --fix` |
| Nothing in Stratos | Check `STRATOS_URL`, and that the agent's machine can reach it |

---

## 2. For developers using Claude Code

This tracks **your own Claude Code usage** (terminal, desktop app or IDE extension): which models you use, how many tokens, and which tools and subagents ran. There's nothing to change in your projects.

It works through small **hooks** that Claude Code runs itself. After each answer, a hook reads Claude Code's session log, sends the new usage to Stratos, and exits. Nothing keeps running in the background, so restarting your laptop doesn't stop it.

### Step 1: Install the CLI

```bash
npm install -g @intelli-1113/stratos-sdk
```

### Step 2: Connect Claude Code

```bash
stratos setup claude-code --token <your-token> --url https://stratos.example.com
```

This command:
- saves the token and URL in `~/.stratos/config.json`, which only you can read;
- adds four hooks to `~/.claude/settings.json`, keeping your existing settings and saving a backup first;
- runs `stratos doctor` to check everything.

### Step 3: Use Claude Code as normal

Start a **new** Claude Code session; sessions that were already open don't pick up the hooks. Your usage appears in Stratos after each answer.

### Check or fix your setup

```bash
stratos doctor
```

It checks the config, the hooks, that `node` is on your PATH, and that Stratos accepts your token. It also shows when usage was last sent.

### What is sent, and what isn't

| Sent | Not sent |
|---|---|
| Model name for each request | Your prompts |
| Input, output and cache tokens | Claude's answers |
| Tool names, how long they took, success or failure (including MCP tools) | Commands, file paths, file contents |
| Subagents used | Your token (it never goes into `settings.json`) |

To also send prompt and answer text, for example for a team that needs audit logs, re-run setup with `--record-prompts`.

### If Stratos is unreachable

Usage is saved in `~/.stratos/outbox/` and sent automatically by the next hook once Stratos is reachable again. Claude Code is never slowed down or blocked. Any problems are written to `~/.stratos/hook.log`.

### Remove it

```bash
stratos setup claude-code --remove
```

### For admins: roll out to everyone

```bash
stratos setup claude-code --print-managed
```

This prints a hooks block for Claude Code's `managed-settings.json`. Paths are `C:\Program Files\ClaudeCode\` on Windows, `/Library/Application Support/ClaudeCode/` on macOS and `/etc/claude-code/` on Linux. Each developer still needs their own token, which they add with:

```bash
stratos setup claude-code --config-only --token <their-token> --url <url>
```

---

## 3. For developers using MCP tools

Claude Desktop, Cursor and VS Code start MCP servers themselves. Wrap the server's command with `stratos-mcp-proxy` to report each tool call to Stratos.

```bash
npm install -g @intelli-1113/stratos-sdk
```

In the app's MCP config, put `stratos-mcp-proxy --` in front of the original command:

```json
{
  "mcpServers": {
    "weather": {
      "command": "stratos-mcp-proxy",
      "args": ["--", "npx", "-y", "@scope/weather-mcp@latest"],
      "env": {
        "STRATOS_TOKEN": "<your-token>",
        "STRATOS_URL": "https://stratos.example.com",
        "STRATOS_APP_NAME": "weather"
      }
    }
  }
}
```

The proxy passes everything through unchanged. If Stratos blocks this agent, tool calls get an error instead of running.

> **Using Claude Code?** Its MCP tool calls are already tracked by the Claude Code hooks in section 2, so you don't need the proxy there.

---

## 4. For developers working on this SDK

### Set up

```bash
git clone https://github.com/intelli-123/stratos-sdk.git
cd stratos-sdk
npm install
npm link          # makes the stratos commands use this folder; edits apply immediately
npm test          # 17 tests, about 1s
```

`npm unlink -g @intelli-1113/stratos-sdk` undoes the link.

### Where things are

| Path | What it does |
|---|---|
| `src/register.js` | `--import` entry: loads `.env`, installs the network guard and the Vercel AI loader, then calls `start()` |
| `src/index.js` | `start()`: OpenLLMetry (Traceloop) setup, framework and model detection, heartbeat |
| `src/enforcement.js` | Network guard: refuses calls to AI providers while Stratos says the agent is blocked |
| `src/vercel-ai*.js` | Wraps the `ai` package so Vercel AI calls are tracked |
| `src/mcp-proxy.js` | `stratos-mcp-proxy` |
| `src/inspect-langchain.js`, `src/cli-inspect.js`, `src/postinstall.js` | LangChain version check and fix (`stratos-inspect`) |
| `src/cli.js`, `src/cli-setup.js`, `src/cli-doctor.js` | `stratos` CLI: `setup`, `doctor`, `hook` |
| `src/claude-code/` | Claude Code integration: `transcript.js` turns the session log into spans, `hook.js` runs the hooks, `settings.js` handles config and the settings merge |
| `src/config-templates.js` | Config bundles for rolling out to many developers |
| `test/` | `node:test` tests and a sample transcript |
| `docs/` | Plain-language reviews: `STRATOS-SDK-REVIEW.*`, `CLAUDE-CODE-INTEGRATION.*` |

### Try the Claude Code hooks without touching your real setup

```bash
export STRATOS_HOME=/tmp/stratos CLAUDE_CONFIG_DIR=/tmp/claude
stratos setup claude-code --token test --url http://127.0.0.1:4999
claude -p "hello" --settings /tmp/claude/settings.json
```

Point `--url` at any small local HTTP server that logs `POST /api/heartbeat` and `POST /api/ingest` to see exactly what is sent.

### Rules worth keeping

- **Hooks must never get in Claude Code's way:** they print nothing to stdout, always exit 0, and log problems to `~/.stratos/hook.log`.
- **Don't validate the token format.** The Stratos server owns it; ask the server (`/api/heartbeat`) instead.
- **No secrets in `~/.claude/settings.json`.** Its `env` section is passed to every command Claude runs.
- **Text is off by default** for Claude Code: only names, counts and timings unless someone opts in.

### Release

1. Bump `version` in `package.json`.
2. `npm test`
3. `npm login`
4. `npm publish --access public`
