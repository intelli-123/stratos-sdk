// Claude Code transcript → Stratos spans (pure, no I/O).
//
// Claude Code writes every session to a JSONL transcript
// (~/.claude/projects/<project>/<session>.jsonl, subagents in
// <session>/subagents/agent-<id>.jsonl). Each assistant API call carries the
// model and token usage; tool calls appear as tool_use blocks, answered later
// by tool_result blocks. The format is internal to Claude Code and not
// documented, so everything here is defensive: unknown shapes are skipped and
// nothing throws.
//
// Spans use the same OpenLLMetry/Traceloop attribute names the rest of the SDK
// sends (see mcp-proxy.js reportTool), so /api/ingest needs no changes.

import { createHash } from "node:crypto";

const MAX_TEXT = 2048;

const hash = (s, n) => createHash("sha256").update(String(s)).digest("hex").slice(0, n);
const attr = (k, v) => ({ key: k, value: { stringValue: String(v) } });
const clip = (s) => {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str.length > MAX_TEXT ? str.slice(0, MAX_TEXT) + "…" : str;
};

function toNano(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? (BigInt(ms) * 1000000n).toString() : null;
}

export const traceIdFor = (sessionId) => hash(`session:${sessionId}`, 32);
export const llmSpanIdFor = (messageId) => hash(`msg:${messageId}`, 16);
export const toolSpanIdFor = (toolUseId) => hash(`tool:${toolUseId}`, 16);

/** Parse JSONL text into objects, skipping blank or malformed lines. */
export function parseLines(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && typeof o === "object") out.push(o);
    } catch {
      /* partial or foreign line — skip */
    }
  }
  return out;
}

function contentBlocks(message) {
  return Array.isArray(message?.content) ? message.content : [];
}

function promptText(entry) {
  const c = entry?.message?.content;
  if (typeof c === "string") return c;
  return contentBlocks(entry?.message)
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function splitMcp(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name || "");
  return m ? { server: m[1], tool: m[2] } : null;
}

/**
 * Build spans from transcript entries.
 *
 * @param {object[]} entries     parsed transcript lines (one batch, in order)
 * @param {object}   opts
 * @param {string}   opts.sessionId
 * @param {{id?:string,type?:string,parentToolUseId?:string}} [opts.agent]  set for subagent transcripts
 * @param {Set<string>} [opts.sentMessages]  message ids already reported (dedupe across runs)
 * @param {Set<string>} [opts.sentTools]     tool_use ids already reported
 * @param {object} [opts.pending]  tool_use ids seen earlier without a result: { id: {name, ts, input} }
 * @param {boolean} [opts.recordInputs]
 * @param {boolean} [opts.recordOutputs]
 * @returns {{ spans: object[], messageIds: string[], toolIds: string[], pending: object }}
 */
export function buildSpans(entries, opts = {}) {
  const sessionId = opts.sessionId || entries.find((e) => e?.sessionId)?.sessionId || "unknown";
  const traceId = traceIdFor(sessionId);
  const sentMessages = opts.sentMessages || new Set();
  const sentTools = opts.sentTools || new Set();
  const pending = { ...(opts.pending || {}) };
  const agent = opts.agent || null;
  const parentSpanId = agent?.parentToolUseId ? toolSpanIdFor(agent.parentToolUseId) : undefined;

  const common = [attr("stratos.surface", "claude-code"), attr("session.id", sessionId)];
  if (agent) {
    common.push(attr("stratos.subagent", "true"));
    if (agent.id) common.push(attr("stratos.agent.id", agent.id));
    if (agent.type) common.push(attr("stratos.agent.type", agent.type));
  }

  // Streaming writes one line per content block, each repeating the same
  // usage — group lines by message id and report each API call once.
  const calls = new Map();
  let lastInputTs = null;
  let lastPrompt = null;

  for (const e of entries) {
    if (e?.type === "user") {
      const blocks = contentBlocks(e.message);
      const results = blocks.filter((b) => b?.type === "tool_result");
      if (!results.length) {
        lastPrompt = promptText(e);
      }
      for (const r of results) {
        const id = r.tool_use_id;
        if (id && pending[id]) pending[id].result = { ts: e.timestamp, isError: !!r.is_error, content: r.content };
      }
      if (e.timestamp) lastInputTs = e.timestamp;
      continue;
    }
    if (e?.type !== "assistant" || !e.message) continue;

    const msg = e.message;
    const key = msg.id || e.requestId || e.uuid;
    if (!key) continue;
    let call = calls.get(key);
    if (!call) {
      call = {
        id: key,
        requestId: e.requestId,
        model: msg.model,
        usage: msg.usage || {},
        stopReason: msg.stop_reason,
        startTs: lastInputTs || e.timestamp,
        endTs: e.timestamp,
        text: [],
        prompt: lastPrompt,
        version: e.version,
      };
      calls.set(key, call);
      lastPrompt = null;
    }
    call.endTs = e.timestamp || call.endTs;
    if ((msg.usage?.output_tokens || 0) >= (call.usage.output_tokens || 0)) call.usage = msg.usage || call.usage;
    if (msg.stop_reason) call.stopReason = msg.stop_reason;

    for (const b of contentBlocks(msg)) {
      if (b?.type === "text" && b.text) call.text.push(b.text);
      if (b?.type === "tool_use" && b.id && !sentTools.has(b.id) && !pending[b.id]) {
        pending[b.id] = { name: b.name || "tool", ts: e.timestamp, input: b.input };
      }
    }
  }

  const spans = [];
  const messageIds = [];

  for (const call of calls.values()) {
    if (sentMessages.has(call.id)) continue;
    if (call.model === "<synthetic>") continue; // local error placeholders, not API calls
    const u = call.usage || {};
    const input = u.input_tokens || 0;
    const output = u.output_tokens || 0;
    const cacheRead = u.cache_read_input_tokens || 0;
    const cacheWrite = u.cache_creation_input_tokens || 0;
    const start = toNano(call.startTs) || toNano(call.endTs);
    const end = toNano(call.endTs) || start;
    if (!start) continue;

    const attributes = [
      attr("traceloop.span.kind", "llm"),
      attr("traceloop.entity.name", "claude-code"),
      attr("gen_ai.system", "anthropic"),
      attr("gen_ai.request.model", call.model || "unknown"),
      attr("gen_ai.response.model", call.model || "unknown"),
      attr("gen_ai.usage.input_tokens", input),
      attr("gen_ai.usage.output_tokens", output),
      attr("gen_ai.usage.prompt_tokens", input),
      attr("gen_ai.usage.completion_tokens", output),
      attr("gen_ai.usage.cache_read_input_tokens", cacheRead),
      attr("gen_ai.usage.cache_creation_input_tokens", cacheWrite),
      attr("llm.usage.total_tokens", input + output + cacheRead + cacheWrite),
      ...common,
    ];
    if (u.output_tokens_details?.thinking_tokens != null) {
      attributes.push(attr("gen_ai.usage.thinking_tokens", u.output_tokens_details.thinking_tokens));
    }
    if (call.stopReason) attributes.push(attr("gen_ai.response.finish_reason", call.stopReason));
    if (call.requestId) attributes.push(attr("stratos.request_id", call.requestId));
    if (call.version) attributes.push(attr("claude_code.version", call.version));
    if (opts.recordInputs && call.prompt) attributes.push(attr("traceloop.entity.input", clip(call.prompt)));
    if (opts.recordOutputs && call.text.length) attributes.push(attr("traceloop.entity.output", clip(call.text.join("\n"))));

    spans.push({
      traceId,
      spanId: llmSpanIdFor(call.id),
      ...(parentSpanId ? { parentSpanId } : {}),
      name: "anthropic.chat",
      kind: 3,
      startTimeUnixNano: start,
      endTimeUnixNano: end,
      attributes,
    });
    messageIds.push(call.id);
  }

  const toolIds = [];
  for (const [id, t] of Object.entries(pending)) {
    if (!t.result || sentTools.has(id)) continue;
    const start = toNano(t.ts) || toNano(t.result.ts);
    const end = toNano(t.result.ts) || start;
    if (!start) continue;
    const attributes = [
      attr("traceloop.span.kind", "tool"),
      attr("traceloop.entity.name", t.name),
      attr("stratos.tool.is_error", t.result.isError),
      ...common,
    ];
    const mcp = splitMcp(t.name);
    if (mcp) attributes.push(attr("mcp.server", mcp.server), attr("mcp.tool", mcp.tool));
    if (opts.recordInputs) {
      attributes.push(attr("traceloop.entity.input", clip({ tool_name: t.name, arguments: t.input ?? {} })));
    }
    if (opts.recordOutputs) {
      attributes.push(attr("traceloop.entity.output", clip({ content: t.result.content, is_error: t.result.isError })));
    }
    spans.push({
      traceId,
      spanId: toolSpanIdFor(id),
      ...(parentSpanId ? { parentSpanId } : {}),
      name: `${t.name}.tool`,
      kind: 1,
      startTimeUnixNano: start,
      endTimeUnixNano: end,
      attributes,
      ...(t.result.isError ? { status: { code: 2 } } : {}),
    });
    toolIds.push(id);
    delete pending[id];
  }

  // Strip bulky inputs from what is carried over to the next run.
  for (const t of Object.values(pending)) {
    if (!opts.recordInputs) delete t.input;
    if (t.result && !opts.recordOutputs) delete t.result.content;
  }

  return { spans, messageIds, toolIds, pending };
}

/** Wrap spans in an OTLP/JSON body for POST /api/ingest. */
export function toOtlpPayload(spans, { serviceName = "claude-code", version } = {}) {
  const resource = [attr("service.name", serviceName), attr("stratos.surface", "claude-code")];
  if (version) resource.push(attr("claude_code.version", version));
  return {
    resourceSpans: [
      {
        resource: { attributes: resource },
        scopeSpans: [{ scope: { name: "stratos-sdk.claude-code" }, spans }],
      },
    ],
  };
}
