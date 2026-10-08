#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export async function doctorCommand() {
  console.log("[stratos-doctor] Running diagnostics...\n");

  const checks = [];
  let passed = 0;
  let failed = 0;

  const token = process.env.STRATOS_TOKEN;
  const url = process.env.STRATOS_URL || "https://stratos.anthropic.com";

  if (token && token.startsWith("sk_")) {
    console.log("✓ STRATOS_TOKEN set");
    passed++;
  } else {
    console.log("✗ STRATOS_TOKEN missing or invalid (must start with sk_)");
    checks.push("Set STRATOS_TOKEN environment variable with your enrollment token");
    failed++;
  }

  if (url && url.startsWith("https://")) {
    console.log(`✓ STRATOS_URL configured: ${url}`);
    passed++;
  } else {
    console.log("✗ STRATOS_URL missing or invalid (must be https://)");
    checks.push("Set STRATOS_URL environment variable");
    failed++;
  }

  if (process.env.NODE_OPTIONS?.includes("stratos-sdk/register")) {
    console.log("✓ NODE_OPTIONS includes stratos-sdk/register");
    passed++;
  } else {
    console.log("✗ NODE_OPTIONS not set to include stratos-sdk/register");
    checks.push(
      "Add to NODE_OPTIONS: --import @intelli-1113/stratos-sdk/register"
    );
    failed++;
  }

  if (process.env.STRATOS_RECORD_INPUTS === "0") {
    console.log("✓ STRATOS_RECORD_INPUTS=0 (content-off)");
    passed++;
  } else {
    console.log("⚠ STRATOS_RECORD_INPUTS not set to 0 (prompts may be recorded)");
    checks.push("Set STRATOS_RECORD_INPUTS=0 to disable prompt recording");
  }

  if (process.env.STRATOS_RECORD_OUTPUTS === "0") {
    console.log("✓ STRATOS_RECORD_OUTPUTS=0 (content-off)");
    passed++;
  } else {
    console.log(
      "⚠ STRATOS_RECORD_OUTPUTS not set to 0 (responses may be recorded)"
    );
    checks.push("Set STRATOS_RECORD_OUTPUTS=0 to disable response recording");
  }

  const claudeDir = join(homedir(), ".claude");
  const settingsPath = join(claudeDir, "settings.json");
  const envPath = join(claudeDir, ".env");

  if (existsSync(settingsPath)) {
    console.log(`✓ Settings file exists: ${settingsPath}`);
    passed++;
  } else {
    console.log(`✗ Settings file missing: ${settingsPath}`);
    checks.push("Run: stratos setup claude-code");
    failed++;
  }

  if (existsSync(envPath)) {
    console.log(`✓ Environment file exists: ${envPath}`);
    passed++;
  } else {
    console.log(`⚠ Env file missing: ${envPath}`);
    checks.push("Run: stratos setup claude-code");
  }

  if (token && url && failed === 0) {
    try {
      console.log("\n[stratos-doctor] Testing connectivity...");
      const response = await fetch(`${url}/api/health`, {
        method: "GET",
        headers: {
          "x-stratos-token": token,
          "user-agent": "stratos-sdk-doctor",
        },
        timeout: 5000,
      });

      if (response.ok) {
        console.log("✓ Connected to Stratos server");
        passed++;
      } else if (response.status === 401 || response.status === 403) {
        console.log(`✗ Stratos server rejected token (${response.status})`);
        checks.push("Verify STRATOS_TOKEN is correct");
        failed++;
      } else {
        console.log(`✗ Stratos server returned ${response.status}`);
        checks.push(`Check STRATOS_URL (got ${response.status})`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ Could not connect to Stratos server: ${err.message}`);
      checks.push(
        `Check STRATOS_URL is reachable: ${url}\n` +
          `Common issues:\n` +
          `  - Network connectivity\n` +
          `  - Firewall blocking\n` +
          `  - Invalid URL`
      );
      failed++;
    }
  }

  console.log("\n" + "=".repeat(60));
  if (failed === 0) {
    console.log("✓ stratos-doctor: All checks passed");
    console.log(
      "\nYou are connected to Stratos. Your Claude usage will now be tracked."
    );
  } else {
    console.log(`✗ stratos-doctor: ${failed} check(s) failed\n`);
    if (checks.length > 0) {
      console.log("Remediation steps:");
      checks.forEach((check, i) => {
        console.log(`  ${i + 1}. ${check}`);
      });
    }
    process.exit(1);
  }
  console.log("=".repeat(60) + "\n");
}

doctorCommand().catch((err) => {
  console.error("[stratos-doctor] Fatal error:", err.message);
  process.exit(1);
});
