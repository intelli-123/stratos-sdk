// `stratos hook <event>` — short-lived Claude Code hook handler.
//
// Claude Code runs this at SessionStart / Stop / SubagentStop / SessionEnd and
// passes the event as JSON on stdin. It reads only the transcript lines added
// since the last run, turns them into spans, posts them to Stratos and exits.
// Nothing keeps running between hooks — developer machines restart, so there
// is deliberately no background process.
//
// Rules: never write to stdout, always exit 0. A hook that fails must not get
// in the way of Claude Code; problems go to ~/.stratos/hook.log instead.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  appendFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseLines, buildSpans, toOtlpPayload } from "./transcript.js";
import { stratosDir, loadConfig } from "./settings.js";

const MAX_IDS = 5000;
const OUTBOX_MAX_FILES = 200;
const OUTBOX_MAX_BYTES = 20 * 1024 * 1024;
const LOG_MAX_BYTES = 1024 * 1024;
const SPANS_PER_POST = 200;
const LOCK_STALE_MS = 60_000;

const paths = () => {
  const root = stratosDir();
  return {
    root,
    state: join(root, "state"),
    outbox: join(root, "outbox"),
    log: join(root, "hook.log"),
    status: join(root, "status.json"),
  };
};

export function log(msg) {
  try {
    const p = paths();
    mkdirSync(p.root, { recursive: true });
    if (existsSync(p.log) && statSync(p.log).size > LOG_MAX_BYTES) renameSync(p.log, p.log + ".1");
    appendFileSync(p.log, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* logging must never fail the hook */
  }
}

function writeJsonAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function updateStatus(patch) {
  const p = paths();
  writeJsonAtomic(p.status, { ...readJson(p.status, {}), ...patch });
}

async function post(cfg, path, body) {
  const res = await fetch(`${cfg.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-stratos-token": cfg.token },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res;
}

// ---- outbox: payloads that could not be delivered, retried by later hooks ----

function saveToOutbox(payload) {
  const { outbox } = paths();
  mkdirSync(outbox, { recursive: true });
  const name = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`;
  writeFileSync(join(outbox, name), JSON.stringify(payload));
  // Keep the outbox bounded: drop the oldest first.
  const files = readdirSync(outbox).filter((f) => f.endsWith(".json")).sort();
  let total = files.reduce((n, f) => n + statSync(join(outbox, f)).size, 0);
  while (files.length > OUTBOX_MAX_FILES || total > OUTBOX_MAX_BYTES) {
    const f = files.shift();
    total -= statSync(join(outbox, f)).size;
    rmSync(join(outbox, f), { force: true });
    log(`outbox full — dropped ${f}`);
  }
}

export async function flushOutbox(cfg) {
  const { outbox } = paths();
  if (!existsSync(outbox)) return 0;
  let sent = 0;
  for (const f of readdirSync(outbox).filter((x) => x.endsWith(".json")).sort()) {
    const file = join(outbox, f);
    try {
      await post(cfg, "/api/ingest", readFileSync(file, "utf8"));
      rmSync(file, { force: true });
      sent++;
    } catch (err) {
      log(`outbox retry failed (${err.message}) — will try again next hook`);
      break; // Stratos still unreachable; stop for now
    }
  }
  if (sent) updateStatus({ lastSendAt: new Date().toISOString(), lastError: null });
  return sent;
}

async function deliver(cfg, spans, meta) {
  for (let i = 0; i < spans.length; i += SPANS_PER_POST) {
    const payload = toOtlpPayload(spans.slice(i, i + SPANS_PER_POST), meta);
    try {
      await post(cfg, "/api/ingest", payload);
      updateStatus({ lastSendAt: new Date().toISOString(), lastError: null });
    } catch (err) {
      log(`ingest failed (${err.message}) — saved to outbox`);
      updateStatus({ lastError: `${new Date().toISOString()} ${err.message}` });
      saveToOutbox(payload);
    }
  }
}

// ---- transcript reading ----

/** Read complete lines added since `offset`. Returns { text, offset }. */
function readNew(file, offset) {
  const size = statSync(file).size;
  if (size < offset) offset = 0; // file was rewritten
  if (size === offset) return { text: "", offset };
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl === -1) return { text: "", offset }; // line still being written
    return { text: buf.subarray(0, lastNl + 1).toString("utf8"), offset: offset + lastNl + 1 };
  } finally {
    closeSync(fd);
  }
}

function transcriptFiles(input) {
  const files = [];
  const main = input.transcript_path;
  if (main && existsSync(main)) files.push({ file: main });
  const subDir = main ? join(main.replace(/\.jsonl$/i, ""), "subagents") : null;
  const seen = new Set(files.map((f) => f.file));
  const addSub = (file) => {
    if (!file || seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const meta = readJson(file.replace(/\.jsonl$/i, ".meta.json"), {});
    const id = basename(file).replace(/^agent-/, "").replace(/\.jsonl$/i, "");
    files.push({ file, agent: { id, type: meta.agentType, parentToolUseId: meta.toolUseId } });
  };
  if (subDir && existsSync(subDir)) {
    for (const f of readdirSync(subDir)) if (f.endsWith(".jsonl")) addSub(join(subDir, f));
  }
  addSub(input.agent_transcript_path);
  return files;
}

function acquireLock(file) {
  mkdirSync(dirname(file), { recursive: true });
  try {
    closeSync(openSync(file, "wx"));
    return true;
  } catch {
    try {
      if (Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS) {
        rmSync(file, { force: true });
        closeSync(openSync(file, "wx"));
        return true;
      }
    } catch {
      /* someone else got it */
    }
    return false;
  }
}

async function reportTranscripts(cfg, input, { final = false } = {}) {
  const sessionId = input.session_id;
  if (!sessionId || !input.transcript_path) return;
  const p = paths();
  const safeId = String(sessionId).replace(/[^\w.-]/g, "_");
  const stateFile = join(p.state, `${safeId}.json`);
  const lockFile = join(p.state, `${safeId}.lock`);

  // Stop and SubagentStop can overlap; whoever loses simply leaves the new
  // lines for the next hook, since the cursor has not moved.
  if (!acquireLock(lockFile)) {
    log(`session ${safeId} busy — skipping, next hook catches up`);
    return;
  }
  try {
    const state = readJson(stateFile, { files: {}, sentMessages: [], sentTools: [] });
    const sentMessages = new Set(state.sentMessages);
    const sentTools = new Set(state.sentTools);
    const allSpans = [];
    let version;

    for (const { file, agent } of transcriptFiles(input)) {
      const fs = state.files[file] || { offset: 0, pending: {} };
      const { text, offset } = readNew(file, fs.offset);
      if (!text && !final) continue;
      const entries = parseLines(text);
      version = version || entries.find((e) => e?.version)?.version;
      const r = buildSpans(entries, {
        sessionId,
        agent,
        sentMessages,
        sentTools,
        pending: fs.pending,
        recordInputs: cfg.recordInputs,
        recordOutputs: cfg.recordOutputs,
      });
      r.messageIds.forEach((id) => sentMessages.add(id));
      r.toolIds.forEach((id) => sentTools.add(id));
      allSpans.push(...r.spans);
      state.files[file] = { offset, pending: r.pending };
    }

    if (allSpans.length) await deliver(cfg, allSpans, { serviceName: cfg.appName, version });

    if (final) {
      rmSync(stateFile, { force: true });
    } else {
      state.sentMessages = [...sentMessages].slice(-MAX_IDS);
      state.sentTools = [...sentTools].slice(-MAX_IDS);
      writeJsonAtomic(stateFile, state);
    }
    log(`${input.hook_event_name || "hook"} session=${safeId} spans=${allSpans.length}`);
  } finally {
    rmSync(lockFile, { force: true });
  }
}

/**
 * Entry point used by `stratos hook <event>`.
 * @param {"session-start"|"stop"|"subagent-stop"|"session-end"} event
 * @param {string} stdinText
 */
export async function runHook(event, stdinText) {
  try {
    const cfg = loadConfig();
    if (!cfg.token) {
      log(`${event}: no token configured — run "stratos setup claude-code"`);
      return;
    }
    let input = {};
    try {
      input = JSON.parse(stdinText || "{}");
    } catch {
      log(`${event}: could not parse hook input`);
      return;
    }

    await flushOutbox(cfg);

    if (event === "session-start") {
      await post(cfg, "/api/heartbeat", {
        framework: "claude-code",
        model: input.model || null,
        tools: [],
        frameworkSupported: true,
      }).catch((err) => log(`heartbeat failed: ${err.message}`));
      return;
    }

    if (event === "stop" || event === "subagent-stop" || event === "session-end") {
      await reportTranscripts(cfg, input, { final: event === "session-end" });
      return;
    }

    log(`unknown hook event "${event}"`);
  } catch (err) {
    log(`${event}: ${err?.stack || err}`);
  }
}

/** Read all of stdin (Claude Code closes it after writing the event). */
export function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}
