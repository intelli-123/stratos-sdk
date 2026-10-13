// `stratos doctor` — check the Claude Code ↔ Stratos connection.
// Reads the files setup writes (not this shell's environment), so it gives the
// same answer no matter where it is run from.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import spawn from "cross-spawn";
import {
  HOOK_EVENTS,
  claudeSettingsPath,
  configExists,
  configFile,
  hasLegacyNodeOptions,
  isStratosHook,
  loadConfig,
  stratosDir,
} from "./claude-code/settings.js";

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Paths quoted in a hook command, e.g. node "C:/…/cli.js" hook stop */
const quotedPaths = (cmd) => [...cmd.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

export async function doctorCommand() {
  console.log("[stratos-doctor] Checking Claude Code → Stratos…\n");
  let failed = 0;
  const fixes = [];
  const ok = (m) => console.log(`✓ ${m}`);
  const warn = (m, fix) => {
    console.log(`⚠ ${m}`);
    if (fix) fixes.push(fix);
  };
  const fail = (m, fix) => {
    console.log(`✗ ${m}`);
    failed++;
    if (fix) fixes.push(fix);
  };

  const cfg = loadConfig();
  if (configExists()) ok(`Config: ${configFile()}`);
  else if (cfg.token) warn("No config file — using STRATOS_* environment variables", "Run: stratos setup claude-code");
  else fail("No Stratos config", "Run: stratos setup claude-code --token <token> --url <url>");

  // The token format is the server's business; whether it is valid is checked below against Stratos itself.
  if (cfg.token) ok("Token present");
  else fail("Token missing", "Run: stratos setup claude-code --token <token>");

  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(cfg.url);
  if (cfg.url.startsWith("https://") || local) ok(`Server: ${cfg.url}`);
  else warn(`Server ${cfg.url} is plain http — token is sent unencrypted`);

  const settingsPath = claudeSettingsPath();
  const settings = existsSync(settingsPath) ? readJson(settingsPath) : null;
  if (!settings) {
    fail(`Cannot read ${settingsPath}`, "Run: stratos setup claude-code");
  } else {
    for (const event of Object.keys(HOOK_EVENTS)) {
      const handlers = (settings.hooks?.[event] || []).flatMap((g) => g?.hooks || []);
      const ours = handlers.find(isStratosHook);
      if (!ours) {
        fail(`Hook ${event} missing`, "Run: stratos setup claude-code");
        continue;
      }
      const missing = quotedPaths(ours.command).filter((p) => !existsSync(p));
      if (missing.length) fail(`Hook ${event} points at missing file: ${missing.join(", ")}`, "Re-run: stratos setup claude-code");
      else ok(`Hook ${event}`);
    }
    const nodeOnPath = spawn.sync("node", ["--version"], { encoding: "utf8", timeout: 5000 });
    if (nodeOnPath.status === 0) ok(`node on PATH (${nodeOnPath.stdout.trim()}) — hooks can start`);
    else fail("`node` is not on PATH, so the hooks cannot start", "Add Node.js to PATH, then restart Claude Code");
    if (hasLegacyNodeOptions(settings.env)) {
      fail(
        "settings.json env still sets NODE_OPTIONS=--import …stratos-sdk/register (breaks Node commands Claude runs)",
        "Re-run: stratos setup claude-code (removes it)"
      );
    }
    if (settings.env?.STRATOS_TOKEN) {
      warn("settings.json env contains STRATOS_TOKEN — visible to every command Claude runs", "Re-run: stratos setup claude-code (moves it)");
    }
  }

  const status = readJson(join(stratosDir(), "status.json")) || {};
  if (status.lastSendAt) ok(`Last successful send: ${status.lastSendAt}`);
  else console.log("· No usage sent yet (expected until a Claude Code session finishes a turn)");
  if (status.lastError) warn(`Last error: ${status.lastError}`);

  const outbox = join(stratosDir(), "outbox");
  if (existsSync(outbox)) {
    const files = readdirSync(outbox).filter((f) => f.endsWith(".json"));
    if (files.length) {
      const kb = Math.round(files.reduce((n, f) => n + statSync(join(outbox, f)).size, 0) / 1024);
      warn(`${files.length} undelivered batch(es) waiting in outbox (${kb} KB) — sent on the next hook once Stratos is reachable`);
    }
  }

  if (cfg.token) {
    try {
      const res = await fetch(`${cfg.url}/api/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-stratos-token": cfg.token },
        body: JSON.stringify({ framework: "claude-code", model: null, tools: [], doctor: true }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) ok("Stratos accepted the token");
      else if (res.status === 401 || res.status === 403) fail(`Stratos rejected the token (${res.status})`, "Check the token in Stratos > Add agent");
      else fail(`Stratos returned ${res.status}`, `Check the URL: ${cfg.url}`);
    } catch (err) {
      fail(`Cannot reach ${cfg.url}: ${err.cause?.code || err.message}`, "Check network, VPN or firewall, and the URL");
    }
  }

  console.log("\n" + "=".repeat(60));
  if (!failed) {
    console.log("✓ All checks passed — new Claude Code sessions report usage to Stratos.");
  } else {
    console.log(`✗ ${failed} check(s) failed`);
    [...new Set(fixes)].forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exitCode = 1;
  }
  console.log("=".repeat(60));
}
