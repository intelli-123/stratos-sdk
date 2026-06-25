#!/usr/bin/env node
/**
 * stratos-mcp-proxy (bundled in @intelli-1113/stratos-sdk) — transparent MCP
 * stdio proxy that meters tool calls for host-launched MCP servers
 * (Claude Desktop / Cursor / VS Code / Claude Code).
 *
 * It spawns the real server, forwards the JSON-RPC stream verbatim in both
 * directions, and reports each tools/call to Stratos as an OTLP/JSON span in
 * OpenLLMetry's shape (so /api/ingest treats it like a real traceloop tool span).
 * stdout is reserved for the protocol; all logging goes to stderr.
 *
 *   Host config:
 *     "weather": {
 *       "command": "stratos-mcp-proxy",
 *       "args": ["--","npx","-y","@scope/weather-mcp@latest"],
 *       "env": { "STRATOS_TOKEN":"<token>", "STRATOS_URL":"http://localhost:4000",
 *                "STRATOS_APP_NAME":"weather" }
 *     }
 */

// CRITICAL: stdout is the MCP channel — keep it clean. Route all logging to stderr.
console.log = console.info = (...a) => process.stderr.write(a.map(String).join(" ") + "\n");

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

let argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep !== -1) argv = argv.slice(sep + 1);
if (!argv.length) { process.stderr.write("[stratos-proxy] usage: stratos-mcp-proxy [--] <command> [args...]\n"); process.exit(2); }
const [cmd, ...args] = argv;
const target = [cmd, ...args].join(" ");

const TOKEN = process.env.STRATOS_TOKEN || "";
const URL = (process.env.STRATOS_URL || "http://localhost:4000").replace(/\/+$/, "");
const APP_NAME = process.env.STRATOS_APP_NAME || ("mcp:" + (args[args.length - 1] || cmd).replace(/[^a-zA-Z0-9._@/-]/g, "").slice(-40));
const HEARTBEAT_MS = Number(process.env.STRATOS_HEARTBEAT_MS || 30000);

if (!TOKEN) process.stderr.write("[stratos-proxy] STRATOS_TOKEN not set — telemetry disabled (proxying only).\n");
console.log(`[stratos-proxy] proxying "${target}" as "${APP_NAME}" → ${URL}`);

const hdr = { "Content-Type": "application/json", "x-stratos-token": TOKEN };
const hex = (n) => randomBytes(n).toString("hex");
const nano = (ms) => (BigInt(Math.round(ms)) * 1000000n).toString();

function reportTool(name, argsObj, out, isErr, startMs, endMs) {
  if (!TOKEN) return;
  const attr = (k, v) => ({ key: k, value: { stringValue: String(v) } });
  const body = {
    resourceSpans: [{
      resource: { attributes: [attr("service.name", APP_NAME)] },
      scopeSpans: [{ spans: [{
        traceId: hex(16), spanId: hex(8),
        name: `${name}.tool`,
        startTimeUnixNano: nano(startMs), endTimeUnixNano: nano(endMs),
        attributes: [
          attr("traceloop.span.kind", "tool"),
          attr("traceloop.entity.name", name),
          attr("traceloop.entity.input", JSON.stringify({ tool_name: name, arguments: argsObj || {} })),
          attr("traceloop.entity.output", JSON.stringify({ content: out, is_error: !!isErr })),
        ],
      }] }],
    }],
  };
  fetch(`${URL}/api/ingest`, { method: "POST", headers: hdr, body: JSON.stringify(body) }).catch(() => {});
}

function heartbeat() {
  if (!TOKEN) return;
  fetch(`${URL}/api/heartbeat`, { method: "POST", headers: hdr }).catch(() => {});
}
heartbeat();
const hbTimer = setInterval(heartbeat, HEARTBEAT_MS);
hbTimer.unref?.();

const pendingCalls = new Map();

const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"], shell: process.platform === "win32" });
child.on("error", (e) => { process.stderr.write(`[stratos-proxy] failed to start target: ${e.message}\n`); process.exit(1); });
child.on("exit", (code) => { try { heartbeat(); clearInterval(hbTimer); } catch {} process.exit(code == null ? 0 : code); });

linePump(process.stdin, (line) => {
  let m; try { m = JSON.parse(line); } catch { child.stdin.write(line + "\n"); return; }
  if (m && m.id != null && m.method === "tools/call") {
    const name = (m.params && m.params.name) || "tool";
    pendingCalls.set(m.id, { name, args: (m.params && m.params.arguments) || {}, start: Date.now() });
  }
  child.stdin.write(line + "\n");
});

linePump(child.stdout, (line) => {
  process.stdout.write(line + "\n");
  let m; try { m = JSON.parse(line); } catch { return; }
  if (!m || m.id == null || !pendingCalls.has(m.id)) return;
  const p = pendingCalls.get(m.id); pendingCalls.delete(m.id);
  const isErr = m.error != null;
  const out = isErr ? (m.error.message || "error") : (m.result != null ? m.result : {});
  reportTool(p.name, p.args, out, isErr, p.start, Date.now());
});

function linePump(stream, onLine) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.trim()) onLine(line);
    }
  });
  stream.on("end", () => { if (buf.trim()) onLine(buf); });
}
