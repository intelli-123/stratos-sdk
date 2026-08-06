// @intelli-1113/stratos-sdk — initialize OpenLLMetry and stream telemetry to Stratos AI.
//
// Config (environment):
//   STRATOS_TOKEN      enrollment token from Stratos "Add agent"   (required)
//   STRATOS_URL        Stratos origin (default http://localhost:4000)
//   STRATOS_APP_NAME   display name for this agent                 (optional)
//   STRATOS_VERCEL_AI  set 0 to disable auto Vercel AI patching    (default on)
//   STRATOS_FRAMEWORK  override auto framework detection           (optional)
//
// Vercel AI: clients only need this register entry (or --import). No
// experimental_telemetry in their generateText/streamText calls.
import * as traceloop from "@traceloop/node-server-sdk";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { enableVercelAiTelemetry } from "./vercel-ai.js";
import { inspectLangChain } from "./inspect-langchain.js";

export { inspectLangChain, fixLangChain } from "./inspect-langchain.js";

const _require = createRequire(import.meta.url);
const resolvable = (pkg) => {
  try {
    _require.resolve(pkg);
    return true;
  } catch {
    return false;
  }
};
const resolvableFromCwd = (pkg) => {
  try {
    createRequire(join(process.cwd(), "package.json")).resolve(pkg);
    return true;
  } catch {
    return false;
  }
};

function agentDeps() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    );
    return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  } catch {
    return {};
  }
}

function detectFramework() {
  if (process.env.STRATOS_FRAMEWORK) return process.env.STRATOS_FRAMEWORK;
  const deps = agentDeps();
  const has = (n) => n in deps || resolvableFromCwd(n) || resolvable(n);
  if (has("@google/adk") || has("google-adk") || has("@iqai/adk")) return "google-adk";
  if (has("@openai/agents")) return "openai-agents";
  if (has("llamaindex")) return "llamaindex";
  if (has("crewai")) return "crewai";
  if (has("@langchain/langgraph")) return "langgraph";
  if (has("langchain") || has("@langchain/core")) return "langchain";
  if (has("ai")) return "vercel-ai";
  if (has("@google/generative-ai") || has("@google/genai")) return "google-genai";
  if (has("@anthropic-ai/sdk")) return "anthropic";
  if (has("openai")) return "openai";
  return null;
}

function detectModel(opts) {
  return (
    opts.model ||
    process.env.STRATOS_MODEL ||
    process.env.NVIDIA_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    process.env.GEMINI_MODEL ||
    process.env.GOOGLE_MODEL ||
    process.env.LLM_MODEL ||
    process.env.MODEL ||
    null
  );
}

let started = false;

export function start(opts = {}) {
  if (started) return;
  const token = opts.token || process.env.STRATOS_TOKEN || "";
  const origin = (opts.url || process.env.STRATOS_URL || "http://localhost:4000").replace(
    /\/+$/,
    ""
  );
  const appName =
    opts.appName ||
    process.env.STRATOS_APP_NAME ||
    process.env.npm_package_name ||
    "agent";
  const heartbeatMs = Number(
    opts.heartbeatMs || process.env.STRATOS_HEARTBEAT_MS || 30000
  );

  if (!token) {
    console.warn(
      "[stratos] STRATOS_TOKEN not set — telemetry disabled. Add the token from Stratos > Add agent."
    );
    return;
  }
  started = true;

  const ingest = `${origin}/api/ingest`;
  const heartbeatUrl = `${origin}/api/heartbeat`;

  traceloop.initialize({
    appName,
    disableBatch: true,
    exporter: new OTLPTraceExporter({
      url: ingest,
      headers: { "x-stratos-token": token },
    }),
  });

  // LangChain version check (warn only — fix via: npx stratos-inspect --fix)
  try {
    const lc = inspectLangChain();
    if (lc.hasLangChain && lc.needsAttention) {
      console.warn(`[stratos] ${lc.message}`);
      console.warn("[stratos] Fix: npx stratos-inspect --fix");
      if (process.env.STRATOS_STRICT_LANGCHAIN === "1" && lc.needsUpgrade) {
        throw new Error(
          "Incompatible @langchain/core (<1.0). Upgrade with: npx stratos-inspect --fix --yes"
        );
      }
    }
  } catch (err) {
    if (process.env.STRATOS_STRICT_LANGCHAIN === "1") throw err;
  }

  // Vercel AI v7 optional global register; v5/v6 covered by ESM loader in register.js
  enableVercelAiTelemetry()
    .then((r) => {
      if (r.enabled) {
        console.log(`[stratos] vercel-ai auto-telemetry: ${r.mode}`);
      }
    })
    .catch(() => {});

  const toolsEnv = (
    opts.tools ||
    (process.env.STRATOS_TOOLS || "").split(",")
  )
    .map((s) => String(s).trim())
    .filter(Boolean);

  const meta = {
    framework: opts.framework || detectFramework(),
    model: detectModel(opts),
    tools: toolsEnv,
  };

  const ping = () =>
    fetch(heartbeatUrl, {
      method: "POST",
      headers: {
        "x-stratos-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(meta),
    }).catch(() => {});
  ping();
  if (heartbeatMs > 0) setInterval(ping, heartbeatMs).unref();

  process.on("beforeExit", () => {
    traceloop.forceFlush().catch(() => {});
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      traceloop.forceFlush().finally(() => process.exit(0));
    });
  }

  console.log(
    `[stratos] telemetry → ${ingest} (heartbeat ${heartbeatMs}ms, framework=${meta.framework || "?"})`
  );
}

export default { start };
