#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

export async function setupCommand(surface) {
  if (!surface) {
    console.error("[stratos-setup] Error: Surface required");
    console.error("Usage: stratos setup <surface>");
    console.error("Example: stratos setup claude-code");
    process.exit(1);
  }

  if (surface !== "claude-code") {
    console.error(`[stratos-setup] Error: Unsupported surface '${surface}'`);
    console.error("Currently supported: claude-code");
    process.exit(1);
  }

  console.log(`[stratos-setup] Configuring Stratos for ${surface}...\n`);

  const claudeCodePath = detectClaudeCode();
  if (!claudeCodePath) {
    console.error("[stratos-setup] Error: Claude Code not detected on this machine");
    console.error("Install Claude Code from https://claude.ai/code before running setup.");
    process.exit(1);
  }

  console.log(`✓ Found Claude Code at: ${claudeCodePath}\n`);

  const token = process.env.STRATOS_TOKEN;
  if (!token) {
    console.error("[stratos-setup] Error: STRATOS_TOKEN environment variable not set");
    console.error("Provide your enrollment token via: export STRATOS_TOKEN=sk_...");
    process.exit(1);
  }

  const url = process.env.STRATOS_URL || "https://stratos.anthropic.com";
  console.log(`✓ Using Stratos server: ${url}\n`);

  const claudeDir = join(homedir(), ".claude");
  mkdirSync(claudeDir, { recursive: true });

  const envPath = join(claudeDir, ".env");
  const envContent = `STRATOS_TOKEN=${token}
STRATOS_URL=${url}
STRATOS_RECORD_INPUTS=0
STRATOS_RECORD_OUTPUTS=0
NODE_OPTIONS=--import @intelli-1113/stratos-sdk/register
`;

  writeFileSync(envPath, envContent, "utf8");
  console.log(`✓ Wrote config to: ${envPath}`);

  const settingsPath = join(claudeDir, "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      console.warn("[stratos-setup] Warning: Could not parse existing settings.json, will merge");
    }
  }

  settings.env = settings.env || {};
  settings.env.STRATOS_TOKEN = token;
  settings.env.STRATOS_URL = url;
  settings.env.STRATOS_RECORD_INPUTS = "0";
  settings.env.STRATOS_RECORD_OUTPUTS = "0";
  settings.env.NODE_OPTIONS = "--import @intelli-1113/stratos-sdk/register";

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  console.log(`✓ Updated: ${settingsPath}\n`);

  console.log("[stratos-setup] Setup complete. Running doctor to verify...\n");

  const { doctorCommand } = await import("./cli-doctor.js");
  await doctorCommand();
}

function detectClaudeCode() {
  const os = platform();
  const home = homedir();

  if (os === "darwin") {
    const macPath = join(home, "Applications", "Claude.app");
    if (existsSync(macPath)) return macPath;
  }

  if (os === "win32") {
    const paths = [
      join(home, "AppData", "Local", "Programs", "claude"),
      "C:\\Program Files\\Claude",
      "C:\\Program Files (x86)\\Claude",
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }

  if (os === "linux") {
    const paths = [
      join(home, ".local", "share", "applications", "claude"),
      join(home, ".config", "claude"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }

  try {
    const result = execSync("which claude 2>/dev/null || where claude 2>nul", {
      encoding: "utf8",
    }).trim();
    if (result) return result;
  } catch {}

  return null;
}
