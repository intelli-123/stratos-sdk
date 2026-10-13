// `stratos setup claude-code` — connect Claude Code to Stratos.
//
// Claude Code is a compiled binary, so the Node SDK cannot be loaded into it
// (NODE_OPTIONS only leaks into every Node command Claude runs). Instead we add
// four short-lived hooks to ~/.claude/settings.json; they read the session
// transcript and post usage to Stratos. No background process, nothing to
// restart after a reboot. The token stays in ~/.stratos/config.json.

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import spawn from "cross-spawn";
import {
  DEFAULT_URL,
  MANAGED_SETTINGS_PATHS,
  buildClaudeCodeHooks,
  claudeSettingsPath,
  cleanLegacyEnv,
  configFile,
  hasLegacyNodeOptions,
  loadConfig,
  mergeStratosHooks,
  removeStratosHooks,
  saveConfig,
  LEGACY_ENV_KEYS,
} from "./claude-code/settings.js";

class SetupError extends Error {}

function detectClaudeCode() {
  // cross-spawn resolves npm's claude.cmd shim on Windows without going through a shell.
  const r = spawn.sync("claude", ["--version"], { encoding: "utf8", timeout: 10000 });
  return r.status === 0 && r.stdout ? r.stdout.trim() : null;
}

/** Read settings.json; refuse to continue if it exists but is not valid JSON. */
export function readSettings(path = claudeSettingsPath()) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
    return parsed;
  } catch (err) {
    throw new SetupError(
      `${path} is not valid JSON (${err.message}). Fix or move it, then re-run setup. Nothing was changed.`
    );
  }
}

function backup(path) {
  if (!existsSync(path)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${path}.stratos-backup-${stamp}`;
  copyFileSync(path, dest);
  return dest;
}

function writeSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

/** Pure: apply our changes to a settings object. Exported for tests. */
export function applySetup(settings) {
  const next = { ...settings };
  next.hooks = mergeStratosHooks(settings.hooks || {});
  if (settings.env) {
    next.env = cleanLegacyEnv(settings.env);
    if (!Object.keys(next.env).length) delete next.env;
  }
  return next;
}

/** Pure: remove our changes from a settings object. Exported for tests. */
export function applyRemove(settings) {
  const next = { ...settings };
  if (settings.hooks) {
    next.hooks = removeStratosHooks(settings.hooks);
    if (!Object.keys(next.hooks).length) delete next.hooks;
  }
  if (settings.env) {
    next.env = cleanLegacyEnv(settings.env);
    if (!Object.keys(next.env).length) delete next.env;
  }
  return next;
}

function printManaged() {
  const snippet = { hooks: buildClaudeCodeHooks() };
  console.log("Add this to managed-settings.json (merge with any existing hooks):\n");
  console.log(JSON.stringify(snippet, null, 2));
  console.log("\nLocations:");
  for (const [os, p] of Object.entries(MANAGED_SETTINGS_PATHS)) console.log(`  ${os.padEnd(7)} ${p}`);
  console.log(
    "\nThe paths above point at this machine's node and SDK install; adjust them for the target machines." +
      "\nEach developer still needs ~/.stratos/config.json (token + URL): run `stratos setup claude-code --config-only`."
  );
}

export async function setupCommand(surface, opts = {}) {
  try {
    if (opts["print-managed"]) return printManaged();

    if (surface !== "claude-code") {
      throw new SetupError(
        surface ? `Unsupported surface '${surface}'. Currently supported: claude-code` : "Usage: stratos setup claude-code [--url URL] [--token TOKEN]"
      );
    }

    const settingsPath = claudeSettingsPath();

    if (opts.remove) {
      const settings = readSettings(settingsPath);
      const saved = backup(settingsPath);
      writeSettings(settingsPath, applyRemove(settings));
      rmSync(configFile(), { force: true });
      console.log(`✓ Removed Stratos hooks from ${settingsPath}`);
      if (saved) console.log(`  backup: ${saved}`);
      console.log(`✓ Deleted ${configFile()}`);
      return;
    }

    console.log("[stratos-setup] Configuring Stratos for Claude Code…\n");

    const version = detectClaudeCode();
    if (version) console.log(`✓ Claude Code ${version}`);
    else console.warn("⚠ `claude` not found on PATH — continuing (the desktop app also reads ~/.claude/settings.json)");

    const current = loadConfig();
    const token = opts.token || current.token;
    if (!token) throw new SetupError("No token. Pass --token <enrollment token> or set STRATOS_TOKEN.");
    const url = (opts.url || current.url || DEFAULT_URL).replace(/\/+$/, "");
    if (!/^https?:\/\//.test(url)) throw new SetupError(`Invalid --url '${url}'`);
    if (url.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url)) {
      console.warn(`⚠ ${url} is plain http — the token will travel unencrypted`);
    }

    const cfgPath = saveConfig({
      token,
      url,
      appName: opts["app-name"] || current.appName || "claude-code",
      recordInputs: !!opts["record-prompts"],
      recordOutputs: !!opts["record-prompts"],
    });
    console.log(`✓ Saved token and URL to ${cfgPath} (not in settings.json)`);
    console.log(`✓ Stratos server: ${url}`);
    console.log(`✓ Prompt/response text: ${opts["record-prompts"] ? "RECORDED (--record-prompts)" : "not recorded (default)"}`);

    if (opts["config-only"]) return;

    const settings = readSettings(settingsPath);
    const hadLegacy = hasLegacyNodeOptions(settings.env) || LEGACY_ENV_KEYS.some((k) => settings.env?.[k] != null);
    const saved = backup(settingsPath);
    writeSettings(settingsPath, applySetup(settings));
    console.log(`✓ Added Stratos hooks (SessionStart, Stop, SubagentStop, SessionEnd) to ${settingsPath}`);
    if (saved) console.log(`  backup: ${saved}`);
    if (hadLegacy) console.log("✓ Removed NODE_OPTIONS / STRATOS_* entries left by an older setup");
    console.log("\nNew Claude Code sessions will report usage. Running doctor…\n");

    const { doctorCommand } = await import("./cli-doctor.js");
    await doctorCommand();
  } catch (err) {
    if (err instanceof SetupError) {
      console.error(`[stratos-setup] ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
