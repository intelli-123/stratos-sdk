#!/usr/bin/env node

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function printHelp() {
  console.log(`
stratos CLI ${VERSION}

Getting started:
  1. Install: npm install @intelli-1113/stratos-sdk

  2. Add to your code (app.js):
     node --import @intelli-1113/stratos-sdk/register app.js

     OR in your code:
     import Stratos from '@intelli-1113/stratos-sdk';
     Stratos.start({ token: 'sk_...', url: 'https://...' });

  3. Set up config:
     stratos env add STRATOS_TOKEN=sk_your_token
     stratos env add STRATOS_URL=https://stratos.example.com

  4. Verify connection:
     stratos doctor

Usage:
  stratos <command> [options]

Commands:
  setup <agent>                          Connect agent to Stratos (adds configuration)
      --token <token>                      Enrollment token (or STRATOS_TOKEN)
      --url <url>                          Stratos server (or STRATOS_URL; default http://localhost:4000)
      --record-prompts                     Also send prompt and response text (off by default)
      --config-only                        Only write ~/.stratos/config.json
      --remove                             Remove configuration and ~/.stratos/config.json
      --print-managed                      Print a managed-settings.json snippet for admins
  doctor                                 Check setup and connectivity
  env add <VAR>=<value> [VAR2=value2...] Add environment variable(s) to .env (project directory only)
  hook <event>                           Used by Claude Code hooks (session-start | stop | subagent-stop | session-end)
  --help, -h                             Show this message
  --version, -v                          Show version

Examples:
  stratos setup claude-code --token <your-token> --url https://stratos.example.com
  stratos doctor
  stratos env add STRATOS_RECORD_PROMPTS=1
  stratos env add STRATOS_TOKEN=sk_... STRATOS_URL=https://... STRATOS_RECORD_PROMPTS=1
`);
}

async function main() {
  const argv = process.argv.slice(2);

  // Hook path first: quiet, fast, never fails Claude Code.
  if (argv[0] === "hook") {
    try {
      const { runHook, readStdin } = await import("./claude-code/hook.js");
      await runHook(argv[1], await readStdin());
    } catch {
      /* runHook logs its own errors; nothing may reach Claude Code */
    }
    // Let fetch sockets finish closing first: exiting mid-close can trip a libuv assertion on Windows.
    await new Promise((r) => setTimeout(r, 20));
    process.exit(0);
  }

  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      token: { type: "string" },
      url: { type: "string" },
      "app-name": { type: "string" },
      "record-prompts": { type: "boolean" },
      "config-only": { type: "boolean" },
      remove: { type: "boolean" },
      "print-managed": { type: "boolean" },
    },
    allowPositionals: true,
  });

  if (values.version) return console.log(`stratos ${VERSION}`);
  const [command, ...args] = positionals;
  if (values.help || !command) return printHelp();

  if (command === "setup") {
    const { setupCommand } = await import("./cli-setup.js");
    await setupCommand(args[0], values);
  } else if (command === "doctor") {
    const { doctorCommand } = await import("./cli-doctor.js");
    await doctorCommand();
  } else if (command === "env") {
    if (args[0] === "add") {
      const { envAddCommand } = await import("./cli-env.js");
      await envAddCommand(...args.slice(1));
    } else {
      console.error(`Unknown env subcommand: ${args[0]}`);
      console.log("Usage: stratos env add <VAR>=<value> [VAR2=value2 ...]");
      process.exitCode = 1;
    }
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[stratos] Error:", err?.message || err);
  process.exit(1);
});
