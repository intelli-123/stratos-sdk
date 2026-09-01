// Side-effect entry so telemetry starts before your app code loads.
//   node --import @intelli-1113/stratos-sdk/register server.js   (zero code changes)
//   import "@intelli-1113/stratos-sdk/register";                 (first line of entrypoint)
//
// Order matters:
//  1) Load .env from cwd (so --import sees STRATOS_TOKEN before start)
//  2) Install the network guard (see enforcement.js) — before ANY provider SDK
//     (openai, @anthropic-ai/sdk, langchain, ai, …) has a chance to import and
//     capture a reference to the unpatched global fetch/http/https.
//  3) Register Vercel AI ESM loader (intercepts `import … from "ai"`)
//  4) start() → Traceloop + OTLP export to Stratos, and the heartbeat that
//     keeps the network guard's blocked/unblocked state up to date.

import { register as registerModuleHook } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { installNetworkGuard } from "./enforcement.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// So `node --import …/register app.js` picks up STRATOS_* without client code
try {
  const envPath = join(process.cwd(), ".env");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
} catch {
  /* optional */
}

// Must run before any consumer imports of a provider SDK — it patches the
// shared, global fetch/http/https that every one of them ultimately calls
// through, so a single install here covers openai/anthropic/langchain/ai/…
// without a per-library wrapper. See enforcement.js for why this is the
// network layer and not the SDK layer.
try {
  installNetworkGuard();
} catch (err) {
  console.warn("[stratos] could not install network guard:", err?.message || err);
}

// Must run before any consumer imports of `ai`
try {
  registerModuleHook(
    pathToFileURL(join(__dirname, "vercel-ai-loader.js")).href
  );
} catch (err) {
  console.warn(
    "[stratos] could not register Vercel AI loader:",
    err?.message || err
  );
}

import { start } from "./index.js";
start();
