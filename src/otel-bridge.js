#!/usr/bin/env node

import http from "node:http";
import { randomBytes } from "node:crypto";

const TOKEN = process.env.STRATOS_TOKEN || "";
const STRATOS_URL = process.env.STRATOS_URL || "http://localhost:4000";
const PORT = process.env.OTEL_EXPORTER_OTLP_PORT || 4318;
const SURFACE = process.env.STRATOS_SURFACE || "unknown";

if (!TOKEN) {
  console.warn("[otel-bridge] Warning: STRATOS_TOKEN not set. Telemetry will not be forwarded.");
}

const hdr = { "Content-Type": "application/json", "x-stratos-token": TOKEN };

function redactContent(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactContent);
  const copy = { ...obj };
  for (const key of Object.keys(copy)) {
    if (key.includes("prompt") || key.includes("request") || key.includes("response") || key.includes("content")) {
      copy[key] = null;
    } else if (typeof copy[key] === "object") {
      copy[key] = redactContent(copy[key]);
    }
  }
  return copy;
}

function otlpToStratosSpan(otlpMetric) {
  const traceId = (randomBytes(16)).toString("hex");
  const spanId = (randomBytes(8)).toString("hex");
  const now = BigInt(Date.now()) * 1000000n;

  const attributes = otlpMetric.attributes || [];
  const attrMap = {};
  for (const attr of attributes) {
    attrMap[attr.key] = attr.value?.stringValue || attr.value?.doubleValue || String(attr.value);
  }

  const redacted = redactContent(attrMap);

  return {
    traceId,
    spanId,
    name: `${SURFACE}.otel.usage`,
    startTimeUnixNano: now.toString(),
    endTimeUnixNano: now.toString(),
    attributes: [
      { key: "traceloop.span.kind", value: { stringValue: "llm" } },
      { key: "stratos.surface", value: { stringValue: SURFACE } },
      { key: "otel.bridge", value: { stringValue: "true" } },
      ...Object.entries(redacted).map(([k, v]) => ({
        key: `otel.${k}`,
        value: { stringValue: String(v) },
      })),
    ],
  };
}

function buildStratosPayload(otlpSpans) {
  const attr = (k, v) => ({ key: k, value: { stringValue: String(v) } });
  return {
    resourceSpans: [
      {
        resource: { attributes: [attr("service.name", SURFACE)] },
        scopeSpans: [
          {
            spans: otlpSpans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              name: span.name,
              startTimeUnixNano: span.startTimeUnixNano,
              endTimeUnixNano: span.endTimeUnixNano,
              attributes: span.attributes,
            })),
          },
        ],
      },
    ],
  };
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (url === "/v1/traces" && method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const otlpPayload = JSON.parse(body);
        const otlpSpans = [];

        for (const resourceSpan of otlpPayload.resourceSpans || []) {
          for (const scopeSpan of resourceSpan.scopeSpans || []) {
            for (const span of scopeSpan.spans || []) {
              otlpSpans.push(otlpToStratosSpan(span));
            }
          }
        }

        if (otlpSpans.length > 0 && TOKEN) {
          const stratosPayload = buildStratosPayload(otlpSpans);
          try {
            const fres = await fetch(`${STRATOS_URL}/api/ingest`, {
              method: "POST",
              headers: hdr,
              body: JSON.stringify(stratosPayload),
            });
            if (!fres.ok) {
              console.error(`[otel-bridge] Stratos returned ${fres.status}`);
            }
          } catch (err) {
            console.error(`[otel-bridge] Failed to forward to Stratos: ${err.message}`);
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
      } catch (err) {
        console.error(`[otel-bridge] Parse error: ${err.message}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "parse error" }));
      }
    });
    return;
  }

  if (url === "/v1/metrics" && method === "POST") {
    req.on("data", () => {}); // Drain
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({}));
    });
    return;
  }

  if (url === "/health" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", surface: SURFACE }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "localhost", () => {
  console.log(
    `[otel-bridge] listening on http://localhost:${PORT}` +
      (TOKEN ? ` (forwarding to ${STRATOS_URL})` : " (token not set; telemetry disabled)")
  );
  console.log(`[otel-bridge] surface: ${SURFACE}`);
  console.log(`[otel-bridge] Set OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:${PORT} in your app`);
});

process.on("SIGINT", () => {
  console.log("[otel-bridge] shutting down");
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  console.log("[otel-bridge] shutting down");
  server.close(() => process.exit(0));
});
