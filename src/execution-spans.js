import { randomBytes } from "node:crypto";

const TOKEN = process.env.STRATOS_TOKEN || "";
const STRATOS_URL = process.env.STRATOS_URL || "http://localhost:4000";
const SURFACE = process.env.STRATOS_SURFACE || "unknown";

const hdr = { "Content-Type": "application/json", "x-stratos-token": TOKEN };

export class ExecutionSpan {
  constructor(opts = {}) {
    this.type = opts.type; // skill, subagent, hook, cmd, plugin, mcp
    this.name = opts.name;
    this.startTime = opts.startTime || Date.now();
    this.endTime = opts.endTime || null;
    this.status = opts.status || "running"; // running, success, error
    this.reason = opts.reason || null;
    this.metadata = opts.metadata || {};
  }

  end(status = "success", reason = null) {
    this.endTime = Date.now();
    this.status = status;
    this.reason = reason;
  }

  toOtlpSpan() {
    const traceId = (randomBytes(16)).toString("hex");
    const spanId = (randomBytes(8)).toString("hex");
    const startNano = BigInt(this.startTime) * 1000000n;
    const endNano = BigInt(this.endTime || Date.now()) * 1000000n;

    const attr = (k, v) => ({
      key: k,
      value: {
        stringValue: String(v),
      },
    });

    const attributes = [
      attr("traceloop.span.kind", this.type),
      attr("traceloop.entity.name", this.name),
      attr("stratos.surface", SURFACE),
      attr("stratos.execution.type", this.type),
      attr("stratos.execution.status", this.status),
    ];

    if (this.reason) {
      attributes.push(attr("stratos.execution.reason", this.reason));
    }

    for (const [k, v] of Object.entries(this.metadata || {})) {
      if (v != null && typeof v !== "object") {
        attributes.push(attr(`stratos.${k}`, v));
      }
    }

    return {
      traceId,
      spanId,
      name: `${this.type}:${this.name}`,
      startTimeUnixNano: startNano.toString(),
      endTimeUnixNano: endNano.toString(),
      attributes,
    };
  }

  static async post(span) {
    if (!TOKEN) return;

    const otlpSpan = span.toOtlpSpan();
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: SURFACE } }],
          },
          scopeSpans: [
            {
              spans: [otlpSpan],
            },
          ],
        },
      ],
    };

    try {
      const res = await fetch(`${STRATOS_URL}/api/ingest`, {
        method: "POST",
        headers: hdr,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error(`[execution-spans] Stratos returned ${res.status}`);
      }
    } catch (err) {
      console.error(`[execution-spans] Failed to post span: ${err.message}`);
    }
  }
}

export async function postSkillSpan(skillName, status = "success", reason = null) {
  const span = new ExecutionSpan({
    type: "skill",
    name: skillName,
    status,
    reason,
  });
  span.end(status, reason);
  await ExecutionSpan.post(span);
}

export async function postSubagentSpan(subagentName, status = "success", reason = null, metadata = {}) {
  const span = new ExecutionSpan({
    type: "subagent",
    name: subagentName,
    status,
    reason,
    metadata,
  });
  span.end(status, reason);
  await ExecutionSpan.post(span);
}

export async function postHookSpan(hookName, status = "success", reason = null) {
  const span = new ExecutionSpan({
    type: "hook",
    name: hookName,
    status,
    reason,
  });
  span.end(status, reason);
  await ExecutionSpan.post(span);
}

export async function postToolSpan(toolName, status = "success", reason = null) {
  const span = new ExecutionSpan({
    type: "mcp",
    name: toolName,
    status,
    reason,
  });
  span.end(status, reason);
  await ExecutionSpan.post(span);
}

export async function postCommandSpan(cmd, status = "success", reason = null) {
  const span = new ExecutionSpan({
    type: "cmd",
    name: cmd,
    status,
    reason,
  });
  span.end(status, reason);
  await ExecutionSpan.post(span);
}

export async function postPluginSpan(pluginName, status = "success", reason = null) {
  const span = new ExecutionSpan({
    type: "plugin",
    name: pluginName,
    status,
    reason,
  });
  span.end(status, reason);
  await ExecutionSpan.post(span);
}
