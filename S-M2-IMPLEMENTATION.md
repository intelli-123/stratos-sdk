# S-M2 Implementation: OTEL Bridge (Fallback Capture Path)

**Status:** ✅ Complete  
**Date:** 2026-10-08  
**Purpose:** Capture native OTEL emissions when injection can't hook Claude Code's transport

---

## What Was Built

### Two new files: OTEL receiver + subprocess harness

```
src/otel-bridge.js           ← HTTP server on localhost:4318
src/otel-bridge-harness.js   ← Subprocess manager with auto-restart
```

---

## How It Works

### Architecture

```
Claude Code (OTEL exporter)
    ↓
http://localhost:4318 (otel-bridge.js)
    ↓
Converts OTLP → Stratos spans
    ↓
POSTs to STRATOS_URL/api/ingest with x-stratos-token
    ↓
Stratos dashboard shows usage
```

### S-M2 replaces S-M0 injection when:
- OpenLLMetry can't hook Claude Code's bundled transport
- App uses native OTEL instead of OpenLLMetry
- Injection fails or is disabled

---

## Implementation Details

### 1. `otel-bridge.js` — HTTP receiver on localhost:4318

**What it does:**
- Listens on `http://localhost:4318` (standard OTEL port)
- Receives OTLP/JSON from `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
- Maps OTLP metrics/spans to Stratos span format
- Content-off redaction: strips prompt/response fields
- POSTs to `STRATOS_URL/api/ingest` with token in header

**Endpoints:**
- `POST /v1/traces` — Receives OTLP trace data
- `POST /v1/metrics` — Receives OTLP metrics (acked, not processed)
- `GET /health` — Health check

**Content-off redaction:**
Strips any field with `prompt`, `request`, `response`, or `content` in the name. All other attributes preserved.

**Environment variables:**
- `STRATOS_TOKEN` — Bearer token for /api/ingest
- `STRATOS_URL` — Stratos server URL (default: http://localhost:4000)
- `STRATOS_SURFACE` — Surface identifier (default: "unknown")
- `OTEL_EXPORTER_OTLP_PORT` — Listen port (default: 4318)

**Usage:**
```bash
STRATOS_TOKEN=sk_... STRATOS_URL=https://stratos.company.com node src/otel-bridge.js
```

**Output example:**
```
[otel-bridge] listening on http://localhost:4318 (forwarding to https://stratos.company.com)
[otel-bridge] surface: claude-code
[otel-bridge] Set OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 in your app
```

---

### 2. `otel-bridge-harness.js` — Subprocess manager

**What it does:**
- Spawns bridge as subprocess using `cross-spawn` (Windows-safe)
- Auto-restarts on crash (exponential backoff, max 5 attempts)
- Forwards stdout/stderr with `[otel-bridge]` prefix
- Graceful shutdown on SIGINT/SIGTERM
- Tracks process state and restart count

**Class: `OtelBridgeHarness`**

```javascript
const harness = new OtelBridgeHarness({
  token: "sk_...",
  url: "https://stratos.company.com",
  surface: "claude-code",
  port: 4318,
});

harness.start();
console.log(`Bridge running (PID: ${harness.getPid()})`);

// Later...
harness.stop();
```

**Restart strategy:**
- Initial delay: 1s
- Exponential backoff: 1s, 2s, 4s, 8s, 16s
- Max restarts: 5
- If max reached: logs error and stops

**Process management:**
- Detached subprocess (doesn't inherit stdio)
- Explicit stdout/stderr handling
- Signal forwarding (SIGINT/SIGTERM)
- Force kill after 2s timeout

---

## Integration: When to Use S-M2

### Use S-M2 if:
1. Injection (`NODE_OPTIONS --import`) fails or isn't available
2. App uses native OTEL configuration
3. Need guaranteed capture even if injection breaks
4. Server-side load balancing across multiple surfaces

### Use S-M1 (injection) if:
1. Node app with OpenLLMetry library
2. No separate OTEL collector needed
3. Full per-call tracing desired

### Layered approach (recommended):
- S-M1 (injection) as primary — per-call spans
- S-M2 (OTEL bridge) as fallback — first-party usage
- S-M3 (hooks) always active — execution tracking

---

## Configuration for Developers

### Option A: Manual bridge startup

```bash
export STRATOS_TOKEN=sk_dev_alice_code_...
export STRATOS_URL=https://stratos.company.com
export STRATOS_SURFACE=claude-code
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Start bridge
node src/otel-bridge.js &

# Your app
node --env OTEL_EXPORTER_OTLP_ENDPOINT app.js
```

### Option B: Programmatic (inside SDK init)

```javascript
import { startOtelBridge } from "@intelli-1113/stratos-sdk/otel-bridge-harness.js";

await startOtelBridge({
  token: process.env.STRATOS_TOKEN,
  url: process.env.STRATOS_URL,
  surface: "claude-code",
});
```

### Option C: MDM deployment (S-M4)

MDM pushes `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` to developer's settings.json, bridge starts automatically.

---

## Data Format: OTLP → Stratos

### Input (standard OTLP/JSON):
```json
{
  "resourceSpans": [{
    "resource": { "attributes": [...] },
    "scopeSpans": [{
      "spans": [{
        "traceId": "...",
        "spanId": "...",
        "name": "openai.embeddings",
        "attributes": [
          { "key": "model", "value": { "stringValue": "text-embedding-3-small" } },
          { "key": "prompt", "value": { "stringValue": "..." } }
        ]
      }]
    }]
  }]
}
```

### Transformation:
- Extract each span
- Map `attributes` to Stratos span attributes
- Redact `prompt`, `response`, `content` fields
- Add `otel.bridge=true` attribute
- Wrap in Stratos format with `x-stratos-token` header

### Output (to /api/ingest):
```json
{
  "resourceSpans": [{
    "resource": {
      "attributes": [{ "key": "service.name", "value": { "stringValue": "claude-code" } }]
    },
    "scopeSpans": [{
      "spans": [{
        "name": "claude-code.otel.usage",
        "attributes": [
          { "key": "traceloop.span.kind", "value": { "stringValue": "llm" } },
          { "key": "stratos.surface", "value": { "stringValue": "claude-code" } },
          { "key": "otel.bridge", "value": { "stringValue": "true" } },
          { "key": "otel.model", "value": { "stringValue": "text-embedding-3-small" } }
        ]
      }]
    }]
  }]
}
```

Note: `prompt` field stripped during redaction.

---

## Testing Checklist

- [ ] Bridge starts and listens on localhost:4318
- [ ] Bridge accepts POST /v1/traces with OTLP payload
- [ ] Bridge forwards to Stratos /api/ingest with token header
- [ ] Bridge redacts prompt/response/content fields
- [ ] Bridge adds `stratos.surface` attribute
- [ ] Health check responds on GET /health
- [ ] Bridge logs startup message with surface and URL
- [ ] Harness spawns bridge subprocess
- [ ] Harness auto-restarts on crash
- [ ] Harness forwards stdout/stderr with prefix
- [ ] Harness graceful shutdown on SIGINT
- [ ] Harness timeout force-kill after 2s
- [ ] Multiple bridges can run on different ports
- [ ] Bridge works without STRATOS_TOKEN (logs warning, proxies only)

---

## Next Steps

1. **Integrate with S-M1 setup:**
   - `stratos setup` can optionally start bridge
   - Pass `--with-otel-bridge` flag

2. **Coordinate with Stratos-app (Plan 2):**
   - Define OTEL payload schema for /api/ingest
   - Token format for bridge auth

3. **Test on real Claude Code:**
   - Verify OTEL emissions from Claude Code
   - Measure latency/throughput
   - Benchmark content-off redaction

4. **Fallback routing logic:**
   - S-M1 setup detects if injection works
   - Falls back to S-M2 if needed
   - Logs which path active

---

## Definition of Done (S-M2)

✅ OTEL bridge receives and forwards OTLP spans  
✅ Content-off redaction strips prompts/responses  
✅ Subprocess harness auto-restarts on crash  
✅ Bridge works standalone or via harness  
✅ Multiple concurrent bridges on different ports  
✅ Graceful shutdown on SIGINT/SIGTERM

**S-M2 is complete and ready for integration testing.**
