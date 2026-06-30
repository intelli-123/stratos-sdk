// @intelli-1113/stratos-sdk — initialize OpenLLMetry and stream telemetry to Stratos AI.
//
// Config comes from the environment (so the ingest URL / token can change
// without editing code or re-publishing the SDK):
//   STRATOS_TOKEN     enrollment token from Stratos "Add agent"   (required)
//   STRATOS_URL       Stratos origin, e.g. https://stratos.lnt.com (default http://localhost:4000)
//   STRATOS_APP_NAME  display name for this agent                 (optional)
//
// Why this exists: traceloop defaults to OTLP *protobuf* at <baseUrl>/v1/traces;
// Stratos ingests OTLP *JSON* at /api/ingest. This wires a JSON exporter to the
// right URL and runs a heartbeat so the agent shows online while it's up.
import * as traceloop from "@traceloop/node-server-sdk";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const has = (pkg) => { try { _require.resolve(pkg); return true; } catch { return false; } };

// Detect the agent framework from what's actually installed — no manual input.
function detectFramework() {
  if (has("@langchain/langgraph")) return "langgraph";
  if (has("langchain") || has("@langchain/core")) return "langchain";
  if (has("llamaindex")) return "llamaindex";
  if (has("@google/adk") || has("google-adk") || has("@iqai/adk")) return "google-adk";
  if (has("@google/generative-ai") || has("@google/genai")) return "google-genai";
  if (has("crewai")) return "crewai";
  if (has("ai")) return "vercel-ai";
  if (has("@anthropic-ai/sdk")) return "anthropic";
  if (has("openai")) return "openai";
  return null;
}
// Best-effort model from common env vars (or opts.model). Spans still refine it.
function detectModel(opts) {
  return opts.model || process.env.STRATOS_MODEL || process.env.NVIDIA_MODEL || process.env.OPENAI_MODEL
    || process.env.ANTHROPIC_MODEL || process.env.LLM_MODEL || process.env.MODEL || null;
}

let started = false;

export function start(opts = {}) {
  if (started) return; // idempotent — safe to import/register more than once
  const token = opts.token || process.env.STRATOS_TOKEN || "";
  const origin = (opts.url || process.env.STRATOS_URL || "http://localhost:4000").replace(/\/+$/, "");
  const appName = opts.appName || process.env.STRATOS_APP_NAME || process.env.npm_package_name || "agent";
  const heartbeatMs = Number(opts.heartbeatMs || process.env.STRATOS_HEARTBEAT_MS || 30000);

  if (!token) {
    console.warn("[stratos] STRATOS_TOKEN not set — telemetry disabled. Add the token from Stratos > Add agent.");
    return;
  }
  started = true;

  const ingest = `${origin}/api/ingest`;
  const heartbeatUrl = `${origin}/api/heartbeat`;

  traceloop.initialize({
    appName,
    disableBatch: true,
    exporter: new OTLPTraceExporter({ url: ingest, headers: { "x-stratos-token": token } }),
  });

  // Auto-detected metadata sent on every heartbeat → Stratos auto-fills the
  // agent's framework/model/tools (no manual entry, no reliance on span quality).
  const toolsEnv = (opts.tools || (process.env.STRATOS_TOOLS || "").split(",")).map((s) => String(s).trim()).filter(Boolean);
  const meta = { framework: detectFramework(), model: detectModel(opts), tools: toolsEnv };

  // Keep the agent "online" while the process is alive (telemetry alone only
  // fires on LLM calls, which would let liveness lapse between requests).
  const ping = () =>
    fetch(heartbeatUrl, {
      method: "POST",
      headers: { "x-stratos-token": token, "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    }).catch(() => {});
  ping();
  if (heartbeatMs > 0) setInterval(ping, heartbeatMs).unref();

  console.log(`[stratos] telemetry → ${ingest} (heartbeat ${heartbeatMs}ms, framework=${meta.framework || "?"})`);
}

export default { start };
