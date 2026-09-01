// Network-level budget / lifecycle enforcement.
//
// WHY THE NETWORK LAYER, NOT THE SDK LAYER
// -----------------------------------------------------------------------------
// OpenAI, Anthropic, LangChain, Vercel AI, Google GenAI — every one of them
// ultimately does the same thing: send an outbound HTTP request to the
// provider's API. Traceloop's own instrumentation (which this SDK depends on
// but does not own — @traceloop/instrumentation-openai et al.) exposes no
// pre-call hook that can refuse a request; its config surface is
// traceContent / enrichTokens / exceptionLogger / uploadBase64Image only.
// Wrapping every provider SDK's call function individually is also a moving
// target — a "custom agent" built directly on a raw SDK gets no protection
// until someone ships a wrapper for that specific library.
//
// Patching global `fetch` (and `http`/`https` as a fallback for older
// transports) catches all of them in ONE place, before the request leaves the
// process, with no per-provider code and no dependency on Traceloop's
// internals. This module is installed from register.js, before any provider
// SDK is imported by the agent's own code — the same ordering guarantee the
// Vercel AI ESM loader already relies on.
//
// This does NOT cover the MCP proxy path (src/mcp-proxy.js): that spawns a
// separate child process and proxies its stdio, so patching fetch in THIS
// process has no effect on the child's own network calls. The proxy has its
// own, necessary check at the JSON-RPC `tools/call` boundary instead.

import http from "node:http";
import https from "node:https";

export class StratosBudgetBlockedError extends Error {
  constructor(reason) {
    super(`[stratos] request blocked: ${reason || "budget or lifecycle limit reached"}`);
    this.name = "StratosBudgetBlockedError";
    this.stratosBlocked = true;
  }
}

// Cached from the heartbeat response (see index.js / mcp-proxy.js). Starts
// unblocked: an agent must never be frozen just because it hasn't heard back
// from Stratos yet — same fail-open philosophy as the server's own enforcement
// check (lib/quotaEnforce.ts: "fail open, loudly").
let _blocked = false;
let _reason = null;

export function setBlocked(blocked, reason) {
  _blocked = !!blocked;
  _reason = reason || null;
}

export function isBlocked() {
  return { blocked: _blocked, reason: _reason };
}

// Hostnames of LLM/agent providers to guard. Extend without an SDK release via
// STRATOS_BLOCK_HOSTS (comma-separated substrings) — e.g. a private Azure
// OpenAI deployment hostname, or a self-hosted gateway.
const DEFAULT_PROVIDER_HOSTS = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "aiplatform.googleapis.com",
  "bedrock-runtime.", // *.amazonaws.com region-scoped, matched by substring
  "api.cohere.ai",
  "api.mistral.ai",
  "openrouter.ai",
  "api.together.xyz",
  "api.groq.com",
  "openai.azure.com",
];

function providerHosts() {
  const extra = (process.env.STRATOS_BLOCK_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_PROVIDER_HOSTS, ...extra];
}

// Never guard Stratos's own host: the agent has to be able to reach Stratos to
// find out it has been unblocked. If this returned the wrong host the agent
// would deadlock itself — checked defensively, not just assumed.
function ownHost() {
  try {
    return new URL(process.env.STRATOS_URL || "http://localhost:4000").host;
  } catch {
    return "";
  }
}

function hostFromInput(input) {
  try {
    if (typeof input === "string") return new URL(input).host;
    if (input instanceof URL) return input.host;
    if (input && typeof input === "object") {
      if (input.url) return new URL(input.url).host; // Request-like
      if (input.hostname || input.host) return String(input.hostname || input.host);
    }
  } catch {
    // Not a parseable URL. Let it through — this guard only ever restricts
    // requests to a known provider host, never anything it can't identify.
  }
  return "";
}

function isGuardedHost(host) {
  if (!host) return false;
  if (host === ownHost()) return false;
  return providerHosts().some((h) => host.includes(h));
}

let installed = false;

/**
 * Patch global fetch and http(s).request so a blocked agent cannot reach any
 * known LLM provider, regardless of which SDK it is using. Idempotent — safe
 * to call more than once, and safe to call when no provider SDK is present.
 */
export function installNetworkGuard() {
  if (installed) return;
  installed = true;

  if (typeof globalThis.fetch === "function" && !globalThis.fetch.__stratosGuarded) {
    const realFetch = globalThis.fetch.bind(globalThis);
    const guarded = function stratosGuardedFetch(input, init) {
      if (isGuardedHost(hostFromInput(input))) {
        const { blocked, reason } = isBlocked();
        if (blocked) return Promise.reject(new StratosBudgetBlockedError(reason));
      }
      return realFetch(input, init);
    };
    guarded.__stratosGuarded = true;
    globalThis.fetch = guarded;
  }

  patchRequestModule(http);
  patchRequestModule(https);
}

/**
 * Secondary guard for legacy http(s)-based clients — the fetch guard above is
 * the primary path and already covers current OpenAI / Anthropic / Google /
 * Vercel AI SDKs, which all use fetch on Node 18+. A synchronous throw here is
 * non-standard for a network failure (Node normally emits an async 'error' on
 * the returned request), but building a spec-compliant fake ClientRequest for
 * a fallback path most agents never exercise is not worth the complexity —
 * callers of http(s).request that care will have it in a try/catch already,
 * since the real function can also throw synchronously for invalid options.
 */
function patchRequestModule(mod) {
  if (!mod || !mod.request || mod.request.__stratosGuarded) return;
  const real = mod.request;
  const guarded = function stratosGuardedRequest(...args) {
    const opts = args.find((a) => a && typeof a === "object" && typeof a !== "function");
    const host = opts ? String(opts.hostname || opts.host || "") : hostFromInput(args[0]);
    if (isGuardedHost(host)) {
      const { blocked, reason } = isBlocked();
      if (blocked) throw new StratosBudgetBlockedError(reason);
    }
    return real.apply(mod, args);
  };
  guarded.__stratosGuarded = true;
  mod.request = guarded;
}
