// Vercel AI auto-telemetry orchestration for Stratos.
// Hooks are registered from register.js (custom ESM loader) before app code runs.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { injectTelemetryOptions, TELEMETRY_CALL_NAMES } from "./vercel-ai-inject.js";

export { injectTelemetryOptions, TELEMETRY_CALL_NAMES };

function resolveFromCwd(pkg) {
  try {
    return createRequire(join(process.cwd(), "package.json")).resolve(pkg);
  } catch {
    return null;
  }
}

function flagEnabled(name, defaultOn = true) {
  const v = process.env[name];
  if (v == null || v === "") return defaultOn;
  return !["0", "false", "off", "no"].includes(String(v).toLowerCase());
}

/**
 * Optional AI SDK v7 global registerTelemetry when @ai-sdk/otel is present.
 * Safe no-op on v5/v6.
 */
export async function enableVercelAiTelemetry() {
  if (!flagEnabled("STRATOS_VERCEL_AI", true)) {
    return { enabled: false, mode: "disabled" };
  }

  const aiPath = resolveFromCwd("ai");
  if (!aiPath) return { enabled: false, mode: null };

  try {
    // Via our shim if loader is active, or direct file URL
    const ai = await import(pathToFileURL(aiPath).href);

    if (typeof ai.registerTelemetry === "function") {
      const otelPath = resolveFromCwd("@ai-sdk/otel");
      if (otelPath) {
        try {
          const otel = await import(pathToFileURL(otelPath).href);
          const OpenTelemetry = otel.OpenTelemetry || otel.LegacyOpenTelemetry;
          if (typeof OpenTelemetry === "function") {
            ai.registerTelemetry(new OpenTelemetry());
            return { enabled: true, mode: "registerTelemetry" };
          }
        } catch {
          /* fall through */
        }
      }
    }

    // ESM loader path is the primary mechanism (stratos-sdk:ai shim)
    return { enabled: true, mode: "esm-loader-shim" };
  } catch {
    return { enabled: true, mode: "esm-loader-shim" };
  }
}
