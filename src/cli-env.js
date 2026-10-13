#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

class EnvError extends Error {}

function isNodeProject() {
  return existsSync(join(process.cwd(), "package.json"));
}

function envPath() {
  return join(process.cwd(), ".env");
}

function readEnvFile(path) {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function backup(path) {
  if (!existsSync(path)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${path}.stratos-backup-${stamp}`;
  try {
    copyFileSync(path, dest);
    return dest;
  } catch {
    return null;
  }
}

function parseEnvFile(content) {
  const lines = content.split("\n");
  const vars = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (key) vars.set(key, valueParts.join("="));
  }
  return vars;
}

function buildEnvContent(vars) {
  return Array.from(vars.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
}

export async function envAddCommand(...varStrings) {
  try {
    // Check if in a Node.js project
    if (!isNodeProject()) {
      throw new EnvError(
        "Not a Node.js project. Run this command from your project root (where package.json is)."
      );
    }

    // Validate we have at least one var
    if (varStrings.length === 0) {
      throw new EnvError("Invalid format. Use: stratos env add KEY=value [KEY2=value2 ...]");
    }

    // Parse and validate all variables
    const newVars = new Map();
    for (const varString of varStrings) {
      if (!varString || !varString.includes("=")) {
        throw new EnvError(`Invalid format: ${varString}. Use: KEY=value`);
      }

      const [key, ...valueParts] = varString.split("=");
      if (!key || !key.match(/^[A-Z_][A-Z0-9_]*$/i)) {
        throw new EnvError(`Invalid variable name: ${key}`);
      }

      newVars.set(key, valueParts.join("="));
    }

    const path = envPath();

    // Read existing .env if it exists
    const existingContent = readEnvFile(path);
    const vars = parseEnvFile(existingContent);

    // Create directory if needed
    const dir = process.cwd();
    await mkdir(dir, { recursive: true });

    // Backup existing .env if present
    let backupPath = null;
    if (existsSync(path)) {
      backupPath = backup(path);
    }

    // Process each new variable
    for (const [key, value] of newVars.entries()) {
      if (vars.has(key)) {
        const oldValue = vars.get(key);
        if (oldValue === value) {
          console.log(`✓ ${key}=${value} already set`);
        } else {
          console.log(`✓ Updated ${key} (was: ${oldValue})`);
          vars.set(key, value);
        }
      } else {
        console.log(`✓ Added ${key}=${value}`);
        vars.set(key, value);
      }
    }

    // Show backup message if one was created
    if (backupPath) {
      console.log(`  backup: ${backupPath}`);
    }

    // Write new .env file
    const newContent = buildEnvContent(vars);
    writeFileSync(path, newContent, "utf8");
    console.log(`✓ Updated .env`);
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(`[stratos] ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
