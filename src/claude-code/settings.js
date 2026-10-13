// Shared Claude Code settings helpers: where Stratos keeps its own config,
// the hook block written into ~/.claude/settings.json, and a merge that never
// drops the user's own hooks.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_URL = "http://localhost:4000";
export const HOOK_EVENTS = {
  SessionStart: { arg: "session-start", timeout: 10 },
  Stop: { arg: "stop", timeout: 30, async: true },
  SubagentStop: { arg: "subagent-stop", timeout: 30, async: true },
  SessionEnd: { arg: "session-end", timeout: 15 },
};

/** ~/.stratos — token, URL, cursors and the outbox live here, not in settings.json. */
export function stratosDir() {
  return process.env.STRATOS_HOME || join(homedir(), ".stratos");
}

export function claudeSettingsPath() {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");
}

const configPath = () => join(stratosDir(), "config.json");

function flag(v, fallback = false) {
  if (v == null || v === "") return fallback;
  return !["0", "false", "off", "no"].includes(String(v).toLowerCase());
}

/** Config file, overridden by STRATOS_* environment variables when set. */
export function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    /* not set up yet */
  }
  const env = process.env;
  return {
    token: env.STRATOS_TOKEN || file.token || "",
    url: (env.STRATOS_URL || file.url || DEFAULT_URL).replace(/\/+$/, ""),
    appName: env.STRATOS_APP_NAME || file.appName || "claude-code",
    recordInputs: flag(env.STRATOS_RECORD_INPUTS, !!file.recordInputs),
    recordOutputs: flag(env.STRATOS_RECORD_OUTPUTS, !!file.recordOutputs),
  };
}

export function saveConfig(cfg) {
  const file = configPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(file, 0o600); // no-op on Windows, where the profile folder is already per-user
  } catch {
    /* ignore */
  }
  return file;
}

export function configExists() {
  return existsSync(configPath());
}

export function configFile() {
  return configPath();
}

/** Absolute path of this package's CLI entry. */
export function cliPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
}

const fwd = (p) => p.replace(/\\/g, "/");

/**
 * The command Claude Code runs for one hook event. The script path is absolute
 * (no global install needed); the program is bare `node` because a command that
 * starts with a quoted path is a parse error in PowerShell, which Claude Code
 * may use for hooks on Windows. `node "<path>" hook stop` works in bash, cmd and
 * PowerShell alike.
 */
export function hookCommand(arg, { node = "node", cli = cliPath() } = {}) {
  return `${node} "${fwd(cli)}" hook ${arg}`;
}

const OUR_HOOK = /cli\.js"?\s+hook\s+(session-start|stop|subagent-stop|session-end)\b/;

export function isStratosHook(h) {
  return !!(h && typeof h.command === "string" && OUR_HOOK.test(h.command) && /stratos/i.test(h.command));
}

/** Hook block in Claude Code's schema: { Event: [ { matcher, hooks: [ {type, command, ...} ] } ] } */
export function buildClaudeCodeHooks(opts = {}) {
  const hooks = {};
  for (const [event, spec] of Object.entries(HOOK_EVENTS)) {
    const handler = { type: "command", command: hookCommand(spec.arg, opts), timeout: spec.timeout };
    if (spec.async) handler.async = true;
    hooks[event] = [{ matcher: "*", hooks: [handler] }];
  }
  return hooks;
}

/** Remove our handlers from a hooks object, keeping everything else the user has. */
export function removeStratosHooks(hooks = {}) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks || {})) {
    if (!Array.isArray(groups)) {
      out[event] = groups;
      continue;
    }
    const kept = groups
      .map((g) => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isStratosHook(h)) } : g))
      .filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
    if (kept.length) out[event] = kept;
  }
  return out;
}

/** Add our hooks; re-running replaces our old entries instead of duplicating them. */
export function mergeStratosHooks(hooks = {}, opts = {}) {
  const out = removeStratosHooks(hooks);
  for (const [event, groups] of Object.entries(buildClaudeCodeHooks(opts))) {
    out[event] = [...(Array.isArray(out[event]) ? out[event] : []), ...groups];
  }
  return out;
}

/** Earlier setup versions wrote these into settings.env; they must go. */
export const LEGACY_ENV_KEYS = ["STRATOS_TOKEN", "STRATOS_URL", "STRATOS_RECORD_INPUTS", "STRATOS_RECORD_OUTPUTS"];

export function hasLegacyNodeOptions(env = {}) {
  return typeof env.NODE_OPTIONS === "string" && env.NODE_OPTIONS.includes("stratos-sdk/register");
}

export function cleanLegacyEnv(env = {}) {
  const out = { ...env };
  for (const k of LEGACY_ENV_KEYS) delete out[k];
  if (hasLegacyNodeOptions(out)) {
    const rest = out.NODE_OPTIONS.replace(/--import[= ]\S*stratos-sdk\/register\S*/g, "").trim();
    if (rest) out.NODE_OPTIONS = rest;
    else delete out.NODE_OPTIONS;
  }
  return out;
}

/** Managed-settings.json locations for admins deploying to every developer. */
export const MANAGED_SETTINGS_PATHS = {
  win32: "C:\\Program Files\\ClaudeCode\\managed-settings.json",
  darwin: "/Library/Application Support/ClaudeCode/managed-settings.json",
  linux: "/etc/claude-code/managed-settings.json",
};
