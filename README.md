# @intelli-1113/stratos-sdk

One-line [OpenLLMetry](https://traceloop.com/docs/openllmetry) telemetry for **Stratos AI** — streams agent liveness, tokens, cost, prompts and tool usage to your Stratos dashboard.

## Install
```bash
npm i @intelli-1113/stratos-sdk
```

## Configure (environment)
```bash
STRATOS_TOKEN=<token from Stratos → Add agent>   # required
STRATOS_URL=https://stratos.lnt.com              # optional, default http://localhost:4000
STRATOS_APP_NAME=my-agent                         # optional display name
```

## Use — pick one

**Zero code changes** (recommended) — load before your app via Node's `--import`:
```bash
node --import @intelli-1113/stratos-sdk/register server.js
```

**One line** — must be the FIRST import in your entrypoint (before `openai`/`langchain`/etc.):
```js
import "@intelli-1113/stratos-sdk/register";
```

**Programmatic** — if you want to pass config explicitly:
```js
import { start } from "@intelli-1113/stratos-sdk";
start({ token: "...", url: "https://stratos.lnt.com", appName: "my-agent" });
```

## Why it must load first
OpenLLMetry patches `openai`/`langchain` to capture spans — it has to run **before** those modules are imported. The `--import` flag and the `/register` entry both guarantee that.

## Changing the URL or token
Both come from env, read at startup — change the `.env` value and restart. No code edit, no SDK re-publish.

## MCP servers (Claude Desktop / Cursor / VS Code)
The same package ships a `stratos-mcp-proxy` command for monitoring host-launched MCP servers.
Add an agent (type `mcp`) in Stratos, then wrap the server's command in the host config:
```json
"weather": {
  "command": "npx",
  "args": ["-y","@intelli-1113/stratos-sdk","stratos-mcp-proxy","--","npx","-y","@scope/weather-mcp@latest"],
  "env": { "STRATOS_TOKEN":"<token>", "STRATOS_URL":"http://localhost:4000", "STRATOS_APP_NAME":"weather" }
}
```
(Or `npm i -g @intelli-1113/stratos-sdk` once, then use `"command":"stratos-mcp-proxy"`.) It forwards
the JSON-RPC stream verbatim and reports each **tool call** (name, args, result, latency) + liveness.
Note: host MCP servers don't call the LLM themselves, so tokens/cost aren't captured.
