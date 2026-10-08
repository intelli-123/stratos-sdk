import spawn from "cross-spawn";
import { setTimeout as sleep } from "node:timers/promises";

export class OtelBridgeHarness {
  constructor(opts = {}) {
    this.token = opts.token || process.env.STRATOS_TOKEN;
    this.url = opts.url || process.env.STRATOS_URL || "http://localhost:4000";
    this.surface = opts.surface || process.env.STRATOS_SURFACE || "unknown";
    this.port = opts.port || 4318;
    this.child = null;
    this.restartCount = 0;
    this.maxRestarts = 5;
    this.restartDelay = 1000;
  }

  start() {
    if (this.child) {
      console.warn("[otel-bridge-harness] Already running");
      return;
    }

    const env = {
      ...process.env,
      STRATOS_TOKEN: this.token,
      STRATOS_URL: this.url,
      STRATOS_SURFACE: this.surface,
      OTEL_EXPORTER_OTLP_PORT: String(this.port),
    };

    this.child = spawn("node", [require.resolve("./otel-bridge.js")], {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      detached: false,
    });

    this.child.stdout.on("data", (data) => {
      console.log(`[otel-bridge] ${data.toString().trim()}`);
    });

    this.child.stderr.on("data", (data) => {
      console.error(`[otel-bridge] ${data.toString().trim()}`);
    });

    this.child.on("error", (err) => {
      console.error(`[otel-bridge-harness] Error: ${err.message}`);
      this.child = null;
      this._scheduleRestart();
    });

    this.child.on("exit", (code) => {
      console.warn(`[otel-bridge-harness] Bridge exited (code: ${code})`);
      this.child = null;
      if (code !== 0) {
        this._scheduleRestart();
      }
    });

    console.log(`[otel-bridge-harness] Started (PID: ${this.child.pid})`);
  }

  async _scheduleRestart() {
    if (this.restartCount >= this.maxRestarts) {
      console.error("[otel-bridge-harness] Max restarts exceeded. Giving up.");
      return;
    }

    this.restartCount++;
    const delay = this.restartDelay * Math.pow(2, this.restartCount - 1);
    console.log(`[otel-bridge-harness] Restarting in ${delay}ms (attempt ${this.restartCount}/${this.maxRestarts})`);

    await sleep(delay);
    this.start();
  }

  stop() {
    if (!this.child) return;

    console.log("[otel-bridge-harness] Stopping...");
    this.child.kill("SIGTERM");

    setTimeout(() => {
      if (this.child && !this.child.killed) {
        console.warn("[otel-bridge-harness] Force killing after timeout");
        this.child.kill("SIGKILL");
      }
    }, 2000);

    this.child = null;
  }

  isRunning() {
    return this.child != null && !this.child.killed;
  }

  getPid() {
    return this.child?.pid || null;
  }
}

export async function startOtelBridge(opts = {}) {
  const harness = new OtelBridgeHarness(opts);
  harness.start();

  process.on("SIGINT", () => {
    harness.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    harness.stop();
    process.exit(0);
  });

  return harness;
}
