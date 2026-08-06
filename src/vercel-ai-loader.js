// Node custom module loader: rewrite bare specifier `ai` → Stratos shim
// that re-exports the real package with telemetry injected on generate*/stream*/embed*.
//
// Registered from register.js BEFORE start(), so client code needs no changes:
//   import "@intelli-1113/stratos-sdk/register";
//   import { generateText } from "ai";  // ← gets wrapped exports

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TELEMETRY_CALL_NAMES } from "./vercel-ai-inject.js";

const SHIM_URL = "stratos-sdk:ai";
const __dirname = dirname(fileURLToPath(import.meta.url));
const INJECT_URL = pathToFileURL(join(__dirname, "vercel-ai-inject.js")).href;

function flagEnabled(name, defaultOn = true) {
  const v = process.env[name];
  if (v == null || v === "") return defaultOn;
  return !["0", "false", "off", "no"].includes(String(v).toLowerCase());
}

export async function resolve(specifier, context, nextResolve) {
  if (!flagEnabled("STRATOS_VERCEL_AI", true)) {
    return nextResolve(specifier, context);
  }

  // Only rewrite the bare package name. Absolute/file imports of real `ai` pass through
  // (used by this shim to load the original module without recursion).
  if (specifier === "ai") {
    return {
      shortCircuit: true,
      url: SHIM_URL,
      format: "module",
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url !== SHIM_URL) {
    return nextLoad(url, context);
  }

  const req = createRequire(join(process.cwd(), "package.json"));
  let realPath;
  try {
    realPath = req.resolve("ai");
  } catch (err) {
    // Consumer doesn't have `ai` — fall through to a clear error on use
    return {
      format: "module",
      shortCircuit: true,
      source: `throw new Error("[stratos] package \\"ai\\" (Vercel AI SDK) is not installed in this project");\n`,
    };
  }

  const realUrl = pathToFileURL(realPath).href;
  // Load real module via absolute URL (does not match specifier === "ai")
  const real = await import(realUrl);
  const wrapSet = new Set(TELEMETRY_CALL_NAMES);
  const keys = Object.keys(real).filter(
    (k) => k !== "default" && k !== "__esModule" && /^[A-Za-z_$][\w$]*$/.test(k)
  );

  let source = "";
  source += `import * as __real from ${JSON.stringify(realUrl)};\n`;
  source += `import { injectTelemetryOptions } from ${JSON.stringify(INJECT_URL)};\n`;
  source += `
function __stratosWrap(fn) {
  if (typeof fn !== "function" || fn.__stratosWrapped) return fn;
  const wrapped = function stratosVercelAiWrap(opts, ...rest) {
    return fn.call(this, injectTelemetryOptions(opts), ...rest);
  };
  wrapped.__stratosWrapped = true;
  try { Object.defineProperty(wrapped, "name", { value: fn.name || "stratosVercelAiWrap" }); } catch {}
  return wrapped;
}
`;

  for (const k of keys) {
    if (wrapSet.has(k)) {
      source += `export const ${k} = __stratosWrap(__real[${JSON.stringify(k)}]);\n`;
    } else {
      source += `export const ${k} = __real[${JSON.stringify(k)}];\n`;
    }
  }

  if (Object.prototype.hasOwnProperty.call(real, "default")) {
    source += `export default __real.default;\n`;
  }

  return {
    format: "module",
    shortCircuit: true,
    source,
  };
}
