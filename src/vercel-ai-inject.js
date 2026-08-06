// Pure helpers for Vercel AI telemetry injection (no side effects).
// Used by the ESM loader shim and optional call-site wrappers.

export function flagEnabled(name, defaultOn = true) {
  const v = process.env[name];
  if (v == null || v === "") return defaultOn;
  return !["0", "false", "off", "no"].includes(String(v).toLowerCase());
}

export function defaultTelemetrySettings() {
  return {
    isEnabled: true,
    recordInputs: flagEnabled("STRATOS_RECORD_INPUTS", true),
    recordOutputs: flagEnabled("STRATOS_RECORD_OUTPUTS", true),
    functionId: process.env.STRATOS_FUNCTION_ID || "stratos-vercel-ai",
    metadata: {
      framework: "vercel-ai",
      agent:
        process.env.STRATOS_APP_NAME ||
        process.env.npm_package_name ||
        "agent",
    },
  };
}

/**
 * Merge Stratos defaults into AI SDK call options.
 * Respects client opt-out: experimental_telemetry/telemetry isEnabled: false.
 */
export function injectTelemetryOptions(opts) {
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) return opts;

  const defaults = defaultTelemetrySettings();

  if (opts.experimental_telemetry?.isEnabled === false) return opts;
  if (opts.telemetry?.isEnabled === false) return opts;

  const next = { ...opts };

  next.experimental_telemetry = {
    ...defaults,
    ...(opts.experimental_telemetry || {}),
    isEnabled: opts.experimental_telemetry?.isEnabled ?? true,
    metadata: {
      ...defaults.metadata,
      ...(opts.experimental_telemetry?.metadata || {}),
    },
  };

  if (opts.telemetry == null || typeof opts.telemetry === "object") {
    next.telemetry = {
      ...defaults,
      ...(opts.telemetry || {}),
      isEnabled: opts.telemetry?.isEnabled ?? true,
      metadata: {
        ...defaults.metadata,
        ...(opts.telemetry?.metadata || {}),
      },
    };
  }

  return next;
}

/** Functions whose first argument is call options that accept telemetry. */
export const TELEMETRY_CALL_NAMES = [
  "generateText",
  "streamText",
  "generateObject",
  "streamObject",
  "embed",
  "embedMany",
  "experimental_generateImage",
  "experimental_generateSpeech",
  "generateImage",
  "generateSpeech",
  "experimental_transcribe",
];
