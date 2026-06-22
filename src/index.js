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

  // Keep the agent "online" while the process is alive (telemetry alone only
  // fires on LLM calls, which would let liveness lapse between requests).
  const ping = () =>
    fetch(heartbeatUrl, { method: "POST", headers: { "x-stratos-token": token } }).catch(() => {});
  ping();
  if (heartbeatMs > 0) setInterval(ping, heartbeatMs).unref();

  console.log(`[stratos] telemetry → ${ingest} (heartbeat ${heartbeatMs}ms)`);
}

export default { start };
