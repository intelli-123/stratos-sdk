#!/usr/bin/env node
/**
 * stratos-inspect — check LangChain version compatibility for Stratos metrics.
 *
 *   npx stratos-inspect
 *   npx stratos-inspect --json
 *   npx stratos-inspect --fix
 *   npx stratos-inspect --fix --yes
 *   npx stratos-inspect --fix --dry-run
 */

import {
  inspectLangChain,
  fixLangChain,
  printInspectReport,
} from "./inspect-langchain.js";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    fix: flags.has("--fix") || flags.has("--repair"),
    yes: flags.has("--yes") || flags.has("-y"),
    dryRun: flags.has("--dry-run"),
    help: flags.has("--help") || flags.has("-h"),
  };
}

function printHelp() {
  console.log(`
stratos-inspect — LangChain compatibility for @intelli-1113/stratos-sdk

Usage:
  stratos-inspect                 Inspect current project (cwd)
  stratos-inspect --json          Machine-readable report
  stratos-inspect --fix           Uninstall old LangChain (<1.0) and install 1.x
  stratos-inspect --fix --yes     Same, no confirmation prompt
  stratos-inspect --fix --dry-run Show plan only

Why:
  Stratos LangChain metrics need @langchain/core >=1.0.0 <2.0.0
  (OpenLLMetry / @traceloop/instrumentation-langchain peer range).

Exit codes:
  0  compatible (or no LangChain) / fix succeeded
  1  incompatible or fix failed / cancelled
`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const report = inspectLangChain();

  if (!opts.fix) {
    printInspectReport(report, { json: opts.json });
    process.exit(report.compatible ? 0 : 1);
  }

  if (!opts.json) {
    printInspectReport(report, { json: false });
  }

  const result = await fixLangChain({
    yes: opts.yes,
    dryRun: opts.dryRun,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.dryRun) {
    console.log("[stratos-inspect] Dry run plan:");
    console.log(JSON.stringify(result.plan, null, 2));
  } else if (result.cancelled) {
    console.log("[stratos-inspect] Cancelled — no changes made.");
  } else if (result.skipped) {
    console.log(`[stratos-inspect] Skipped (${result.reason}). ${result.message || ""}`);
  } else if (result.ok) {
    console.log("[stratos-inspect] Done. LangChain should now be on 1.x.");
    if (result.reportAfter) printInspectReport(result.reportAfter);
  } else {
    console.error(`[stratos-inspect] Fix failed: ${result.message || result.step || "unknown"}`);
  }

  process.exit(result.ok || result.skipped ? 0 : 1);
}

main().catch((err) => {
  console.error("[stratos-inspect]", err);
  process.exit(1);
});
