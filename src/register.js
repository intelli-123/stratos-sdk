// Side-effect entry so telemetry starts before your app code loads.
//   node --import @intelli-1113/stratos-sdk/register server.js   (zero code changes)
//   import "@intelli-1113/stratos-sdk/register";                 (first line of entrypoint)
import { start } from "./index.js";
start();
