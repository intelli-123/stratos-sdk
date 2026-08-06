#!/usr/bin/env node
// Runs after `npm install @intelli-1113/stratos-sdk`.
// Warns only — never auto-uninstalls (use: npx stratos-inspect --fix).
//
// npm sets INIT_CWD to the project where the user ran `npm install`
// (not node_modules/@intelli-1113/stratos-sdk).

import { inspectLangChain, printInspectReport } from "./inspect-langchain.js";

try {
  if (process.env.STRATOS_SKIP_POSTINSTALL === "1") process.exit(0);

  // Prefer the consumer project root
  const cwd = process.env.INIT_CWD || process.cwd();
  const report = inspectLangChain({ cwd });
  if (!report.hasLangChain) process.exit(0);
  if (report.compatible) process.exit(0);

  console.warn(
    "\n[stratos] ⚠ LangChain version is not compatible with Stratos auto-metrics."
  );
  printInspectReport(report);
  console.warn(
    "[stratos] In your project, run:\n  npx stratos-inspect --fix\n"
  );
} catch {
  // Never fail the host install
  process.exit(0);
}
