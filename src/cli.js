#!/usr/bin/env node

import { parseArgs } from "node:util";
import { setupCommand } from "./cli-setup.js";
import { doctorCommand } from "./cli-doctor.js";

const VERSION = "1.3.4";

function printHelp() {
  console.log(`
stratos CLI ${VERSION}

Usage:
  stratos <command> [options]

Commands:
  setup <surface>       Configure Stratos on a surface (e.g., claude-code)
  doctor                Validate Stratos setup and connectivity
  --help, -h            Show this message
  --version, -v         Show version

Examples:
  stratos setup claude-code
  stratos doctor
`);
}

async function main() {
  const { values, positional } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.version) {
    console.log(`stratos ${VERSION}`);
    process.exit(0);
  }

  const [command, ...args] = positional;

  if (!command) {
    printHelp();
    process.exit(0);
  }

  try {
    if (command === "setup") {
      await setupCommand(...args);
    } else if (command === "doctor") {
      await doctorCommand();
    } else {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
    }
  } catch (err) {
    console.error(`[stratos] Error:`, err.message);
    process.exit(1);
  }
}

main();
