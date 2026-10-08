# Stratos SDK Plan Implementation Roadmap

## Current State vs. Plan Requirements

### ✅ Already Implemented
```
src/register.js              ← NODE_OPTIONS entry point (S-M0)
src/index.js                ← OpenLLMetry initialization + heartbeat (S-M0)
src/enforcement.js          ← Network guard + budget blocking (S-M0) [JUST FIXED: P1-01,P1-02,P1-03]
src/vercel-ai.js            ← Vercel AI telemetry (S-M0)
src/vercel-ai-inject.js     ← Content-off flags (S-M0) [JUST FIXED: P1-04]
src/mcp-proxy.js            ← MCP tool metering (S-M0) [JUST FIXED: P1-05,P1-06]
src/inspect-langchain.js    ← LangChain compatibility (S-M0) [JUST FIXED: P1-07]
src/cli-inspect.js          ← stratos-inspect command (S-M0)
package.json bin            ← stratos-mcp-proxy, stratos-inspect
```

### ❌ Missing for Developer Capture (S-M1 → S-M4)

```
MISSING                      REQUIRED BY       PRIORITY
─────────────────────────────────────────────────────────
stratos setup claude-code    S-M1 (Usage)      🔴 HIGH
stratos doctor               S-M1/S-M4 (Verify) 🔴 HIGH
OTEL bridge (localhost)      S-M2 (Raw OTEL)   🟡 MED
Hooks system                 S-M3 (Execution)  🟡 MED
Claude Code plugin/mod       S-M3 (Execution)  🟡 MED (external)
MDM config templates         S-M4 (Delivery)   🟡 MED
```

---

## Implementation Plan (Detailed)

### **Phase 1: S-M1 Implementation** (stratos setup + stratos doctor)

#### 1.1 Create CLI infrastructure
**File: `src/cli-setup.js`**
```javascript
Purpose: stratos setup claude-code command
- Detect OS + Claude Code installation path
- Detect capture tier: OpenLLMetry injection vs native OTEL
- Write ~/.claude/settings.json with hooks
- Write ~/.claude/.env with STRATOS_* vars
- Set content-off flags (STRATOS_RECORD_INPUTS=0/1)
```

#### 1.2 Create doctor command
**File: `src/cli-doctor.js`**
```javascript
Purpose: Validate Stratos setup
- Ping STRATOS_URL (heartbeat endpoint)
- Validate STRATOS_TOKEN format
- Check NODE_OPTIONS register in Claude Code
- Check ~/.claude/settings.json hooks
- Verify content-off flags are set
- Test exporter connectivity (if setup complete)
- Print pass/fail + remediation steps
```

#### 1.3 Update package.json bin
```json
{
  "bin": {
    "stratos-mcp-proxy": "./src/cli-mcp-proxy.js",
    "stratos-inspect": "./src/cli-inspect.js",
    "stratos": "./src/cli.js",
    "stratos-setup": "./src/cli-setup.js",
    "stratos-doctor": "./src/cli-doctor.js"
  }
}
```

#### 1.4 Create main CLI entry
**File: `src/cli.js`**
```javascript
Purpose: Root CLI dispatcher
Usage: stratos [command] [options]
- stratos setup claude-code
- stratos doctor
- stratos-inspect (backward compat)
```

---

### **Phase 2: S-M2 Implementation** (OTEL Bridge)

#### 2.1 Create OTEL bridge
**File: `src/otel-bridge.js`**
```javascript
Purpose: Localhost OTEL receiver → Stratos forwarder
- Listen on http://localhost:4318 (standard OTEL exporter)
- Receive OTLP metrics/logs/traces
- Map OTEL attributes to Stratos usage spans
- Attach x-stratos-token header
- Forward to STRATOS_URL/api/ingest
- Handle content-off redaction (strip prompts/outputs)

Key: Surface provides standard OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

#### 2.2 Harness in SDK
**File: `src/otel-bridge-harness.js`**
```javascript
Purpose: Reuse mcp-proxy pattern for OTEL bridge
- spawn() bridge as subprocess
- Share token via env var (not URL)
- Forward shutdown signals
- Monitor bridge health
- Restart on failure
```

---

### **Phase 3: S-M3 Implementation** (Hooks + Execution Plane)

#### 3.1 Execution span schema
**File: `src/execution-spans.js`**
```javascript
Purpose: Generate content-free execution spans
- skill: skill/prompt was invoked
- subagent: child agent spawned
- hook: claude code hook fired
- cmd: CLI command executed
- plugin: plugin loaded/called
- mcp: MCP resource accessed

Each span carries:
- surface token (alice.code, alice.chat, alice.cowork)
- execution type + name
- start/end timestamps
- status (success/failure)
- NO: prompt/response/context
```

#### 3.2 Claude Code integration (external)
**Requires: Claude Code team**
```
~/.claude/settings.json hooks:
  PreToolUse    → POST skill/tool execution
  PostToolUse   → POST tool result (no content)
  SessionStart  → POST session began
  SessionStop   → POST session ended
  SubagentStop  → POST subagent finished
  UserPromptSubmit → POST user message (no content)
```

#### 3.3 Plugin/mod for Claude Code (external)
```javascript
Purpose: Auto-register hooks on `npm i -g @intelli-1113/stratos-sdk`
- Postinstall script detects Claude Code
- Writes hooks to ~/.claude/settings.json
- No user action needed (MDM handles it)
```

---

### **Phase 4: S-M4 Implementation** (MDM Delivery)

#### 4.1 Config templates
**File: `src/config-templates.js`**
```javascript
Purpose: Generate per-surface MDM bundles

For each surface (code/chat/cowork):
  - STRATOS_TOKEN (person×surface)
  - STRATOS_URL (enrolled Stratos server)
  - NODE_OPTIONS (for CLI-based surfaces)
  - OTEL_EXPORTER_OTLP_ENDPOINT (for OTEL surfaces)
  - STRATOS_RECORD_INPUTS=0/1
  - STRATOS_RECORD_OUTPUTS=0/1
  - hooks config (if CLI supports)
```

#### 4.2 MDM delivery format
```
Output: YAML manifest per person per surface
stratos-dev-bundle-alice-code.yaml
  surface: claude-code
  owner_email: alice@company.com
  token: sk_developer_...
  url: https://stratos.company.com
  os: mac|windows|linux
  env:
    STRATOS_TOKEN: sk_developer_...
    STRATOS_URL: https://stratos.company.com
    NODE_OPTIONS: --import @intelli-1113/stratos-sdk/register
  hooks:
    PreToolUse: enabled
    SessionStart: enabled
  content_off: true
```

#### 4.3 Self-check (via stratos doctor)
```
- Detect surface type from running processes
- Validate token + URL reachable
- Confirm hooks registered
- Verify exporter/bridge operational
- Print enrollment URL if not enrolled
```

---

## File Structure After Implementation

```
src/
  ├── cli.js                    (NEW)   Main CLI dispatcher
  ├── cli-setup.js             (NEW)   Setup command
  ├── cli-doctor.js            (NEW)   Doctor/validation
  ├── cli-inspect.js           (EXISTS) LangChain inspection
  ├── cli-mcp-proxy.js         (RENAME) stratos-mcp-proxy entry
  ├── index.js                 (EXISTS) Agent SDK + OpenLLMetry
  ├── register.js              (EXISTS) NODE_OPTIONS entry
  ├── enforcement.js           (EXISTS) [WITH P1-FIXES]
  ├── vercel-ai.js             (EXISTS)
  ├── vercel-ai-inject.js      (EXISTS)
  ├── mcp-proxy.js             (EXISTS) [WITH P1-FIXES]
  ├── inspect-langchain.js     (EXISTS) [WITH P1-FIXES]
  ├── execution-spans.js       (NEW)   Span schema + generators
  ├── otel-bridge.js           (NEW)   OTEL→Stratos translator
  ├── otel-bridge-harness.js   (NEW)   Bridge subprocess manager
  ├── config-templates.js      (NEW)   MDM bundle generator
  └── config-helpers.js        (NEW)   Env/settings file helpers

package.json
  ├── bin: { stratos, stratos-setup, stratos-doctor, ... }
  └── scripts: { setup: stratos setup ... }
```

---

## Implementation Sequence

### **CRITICAL PATH (ship in order):**

1. **Phase 1.1–1.4**: CLI infrastructure
   - Enables `stratos setup` + `stratos doctor`
   - Unblocks S-M1 validation
   - **Can ship standalone** ← v1.4.0 milestone

2. **Phase 2**: OTEL bridge
   - Enables non-injection capture (fallback path)
   - Fulfills "guaranteed floor"
   - **Depends on**: Phase 1 (for token delivery)

3. **Phase 3**: Hooks + execution plane
   - **Depends on**: Claude Code team coordination
   - Can be parallelized with Phase 2
   - Plugin auto-registers hooks

4. **Phase 4**: MDM delivery
   - **Depends on**: Phases 1–3
   - Part of Stratos-app (Plan 2, A-M4)
   - Not purely SDK work

---

## Risks & Dependencies

| Phase | Risk | Mitigation |
|-------|------|-----------|
| 1 | Claude Code path detection | Test on Mac/Windows/Linux; fallback to detection heuristics |
| 1 | Settings file collision | Merge strategy: preserve user hooks, add Stratos ones |
| 2 | OTEL spec variance | Test against real OTEL exporters; support both OTLP v0.18 and v0.20 |
| 3 | Hook registration | Coordination with Claude Code; may need SDK postinstall for plugin |
| 4 | MDM format disagreement | Finalize with Stratos-app team (Plan 2) before implementation |

---

## Testing Checklist

```
[ ] Phase 1: stratos setup writes config to ~/.claude/
[ ] Phase 1: stratos doctor validates all fields
[ ] Phase 2: OTEL bridge translates OTLP metrics → spans
[ ] Phase 2: Content-off redaction removes prompts
[ ] Phase 3: Hooks fire and POST execution spans
[ ] Phase 4: MDM bundle contains correct env vars
[ ] Integration: alice.code, alice.chat, alice.cowork each appear on Stratos
```

---

## Definition of Done (S-M1 Complete)

✅ Developer runs: `npm i -g @intelli-1113/stratos-sdk`  
✅ Developer runs: `stratos setup claude-code` (interactive or MDM-driven)  
✅ Developer runs: `stratos doctor` → "✓ Connected"  
✅ Stratos dashboard shows: `alice · code` with usage spans  
✅ README documents: "npm i -g → stratos setup → stratos doctor"

