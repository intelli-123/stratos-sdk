#!/usr/bin/env node
// Runs after `npm install @intelli-1113/stratos-sdk`.
// Warns only — never auto-uninstalls (use: npx stratos-inspect --fix).
//
// npm sets INIT_CWD to the project where the user ran `npm install`
// (not node_modules/@intelli-1113/stratos-sdk).

import { inspectLangChain, printInspectReport } from "./inspect-langchain.js";
import { readFileSync } from "node:fs";

function getSDKVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return pkg.version;
  } catch {
    return "latest";
  }
}

try {
  if (process.env.STRATOS_SKIP_POSTINSTALL === "1") process.exit(0);

  // Prefer the consumer project root
  const cwd = process.env.INIT_CWD || process.cwd();
  const report = inspectLangChain({ cwd });

  // Show LangChain warnings if needed
  if (report.hasLangChain && !report.compatible) {
    console.warn(
      "\n[stratos] ⚠ LangChain version is not compatible with Stratos auto-metrics."
    );
    printInspectReport(report);
    console.warn(
      "[stratos] In your project, run:\n  npx stratos-inspect --fix\n"
    );
  }
} catch {
  // Never fail the host install
}

// Always show welcome message
const version = getSDKVersion();
console.log(`
✨ Welcome to Stratos SDK v${version}!

Get started:
  → Run: stratos --help

This will show all available commands and a 4-step integration guide.
`);
