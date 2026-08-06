// Side-effect entry so telemetry starts before your app code loads.
//   node --import @intelli-1113/stratos-sdk/register server.js   (zero code changes)
//   import "@intelli-1113/stratos-sdk/register";                 (first line of entrypoint)
//
// Order matters:
//  1) Load .env from cwd (so --import sees STRATOS_TOKEN before start)
//  2) Register Vercel AI ESM loader (intercepts `import … from "ai"`)
//  3) start() → Traceloop + OTLP export to Stratos

import { register as registerModuleHook } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

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
