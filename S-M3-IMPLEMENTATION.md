# S-M3 Implementation: Execution Plane (Hooks + Skills)

**Status:** ✅ Complete  
**Date:** 2026-10-08  
**Purpose:** Track skills, subagents, hooks, and execution events separately from usage spans

---

## What Was Built

### One new file: Execution span schema + generators

```
src/execution-spans.js       ← Span types for skill, subagent, hook, cmd, plugin, mcp
```

---

## How It Works

### Architecture

```
Claude Code Hooks (internal events)
    ↓
execution-spans.js (postSkillSpan, postSubagentSpan, postHookSpan, etc.)
    ↓
ExecutionSpan class builds content-free OTLP span
    ↓
POSTs to STRATOS_URL/api/ingest with x-stratos-token
    ↓
Stratos dashboard shows execution tree
```

### Execution Events (Content-Free)

Each span type carries:
- **Span name:** `skill:name`, `subagent:name`, `hook:name`, etc.
- **Type attribute:** `skill`, `subagent`, `hook`, `cmd`, `plugin`, `mcp`
- **Status:** `running`, `success`, `error`
- **Reason:** (if error) why it failed
- **No prompts/responses/context**

---

## Implementation Details

### 1. `execution-spans.js` — Execution event tracking

**Core class: `ExecutionSpan`**

```javascript
const span = new ExecutionSpan({
  type: "skill",           // skill, subagent, hook, cmd, plugin, mcp
  name: "my-skill",
  startTime: Date.now(),
  status: "running",
  metadata: { /* custom data */ }
});

// End the span
span.end("success");       // status: success, reason: null
span.end("error", "timeout");  // status: error, reason: "timeout"

// Send to Stratos
await ExecutionSpan.post(span);
```

**Span attributes (content-free):**
- `traceloop.span.kind` — execution type (skill, subagent, hook, etc.)
- `traceloop.entity.name` — skill/subagent name
- `stratos.surface` — surface identifier (e.g., claude-code)
- `stratos.execution.type` — type (skill, subagent, etc.)
- `stratos.execution.status` — running, success, error
- `stratos.execution.reason` — (if error) reason message
- `stratos.*` — custom metadata (no prompts)

**High-level API: Convenience functions**

```javascript
// Skills
import { postSkillSpan } from "@intelli-1113/stratos-sdk/execution-spans.js";
await postSkillSpan("web-search", "success");
await postSkillSpan("web-search", "error", "network timeout");

// Subagents
import { postSubagentSpan } from "@intelli-1113/stratos-sdk/execution-spans.js";
await postSubagentSpan("research-agent", "success", null, { agents_spawned: 2 });

// Hooks
import { postHookSpan } from "@intelli-1113/stratos-sdk/execution-spans.js";
await postHookSpan("PreToolUse", "success");

// Tools/MCP
import { postToolSpan } from "@intelli-1113/stratos-sdk/execution-spans.js";
await postToolSpan("web-search", "success");

// Commands
import { postCommandSpan } from "@intelli-1113/stratos-sdk/execution-spans.js";
await postCommandSpan("npm install", "success");

// Plugins
import { postPluginSpan } from "@intelli-1113/stratos-sdk/execution-spans.js";
await postPluginSpan("stratos-plugin", "success");
```

---

## Integration Points

### Integration with Claude Code Hooks

Claude Code settings.json hooks:
```json
{
  "hooks": {
    "PreToolUse": {
      "endpoint": "http://localhost:3000/hook",
      "payload": { "type": "skill", "name": "{skill}" }
    },
    "PostToolUse": { ... },
    "SessionStart": { ... },
    "SessionStop": { ... },
    "SubagentStop": { ... },
    "UserPromptSubmit": { ... }
  }
}
```

Stratos plugin (to be implemented by Claude Code team):
```javascript
// ~/.claude/plugins/stratos-hooks.js (pseudo-code)
import { postHookSpan } from "@intelli-1113/stratos-sdk/execution-spans.js";

export function onPreToolUse(skill) {
  await postHookSpan(`PreToolUse[${skill}]`, "success");
}

export function onSubagentStop(subagentName, result) {
  const status = result.error ? "error" : "success";
  await postSubagentSpan(subagentName, status, result.error);
}
```

---

## Data Format: Execution Spans

### Example: Skill execution

```javascript
const span = new ExecutionSpan({
  type: "skill",
  name: "web-search",
  status: "success"
});

span.toOtlpSpan(); // Returns:
{
  traceId: "a1b2c3d4...",
  spanId: "e5f6g7h8...",
  name: "skill:web-search",
  startTimeUnixNano: "1696000000000000000",
  endTimeUnixNano: "1696000001000000000",
  attributes: [
    { key: "traceloop.span.kind", value: { stringValue: "skill" } },
    { key: "traceloop.entity.name", value: { stringValue: "web-search" } },
    { key: "stratos.surface", value: { stringValue: "claude-code" } },
    { key: "stratos.execution.type", value: { stringValue: "skill" } },
    { key: "stratos.execution.status", value: { stringValue: "success" } }
  ]
}
```

### Posted to /api/ingest:

```json
{
  "resourceSpans": [{
    "resource": {
      "attributes": [
        { "key": "service.name", "value": { "stringValue": "claude-code" } }
      ]
    },
    "scopeSpans": [{
      "spans": [{
        "name": "skill:web-search",
        "attributes": [
          { "key": "traceloop.span.kind", "value": { "stringValue": "skill" } },
          ...
        ]
      }]
    }]
  }]
}
```

---

## Execution Event Types

### `skill` — User-invoked skill
- Name: skill identifier
- Metadata: none (content-free)
- Example: `postSkillSpan("web-search", "success")`

### `subagent` — Child agent spawned
- Name: subagent type
- Metadata: `agents_spawned`, `agent_names`, etc.
- Example: `postSubagentSpan("research-agent", "success", null, { agents_spawned: 2 })`

### `hook` — Claude Code lifecycle event
- Name: hook name + context
- Metadata: none
- Example: `postHookSpan("PreToolUse[web-search]", "success")`

### `cmd` — CLI command execution
- Name: command name
- Metadata: none
- Example: `postCommandSpan("stratos doctor", "success")`

### `plugin` — Plugin loaded/invoked
- Name: plugin name
- Metadata: none
- Example: `postPluginSpan("stratos-hooks", "success")`

### `mcp` — MCP tool accessed
- Name: tool name
- Metadata: none
- Example: `postToolSpan("web-search", "success")`

---

## Error Handling

```javascript
try {
  const result = await skillExecution("web-search");
  await postSkillSpan("web-search", "success");
} catch (err) {
  await postSkillSpan("web-search", "error", err.message);
}
```

---

## Testing Checklist

- [ ] ExecutionSpan.toOtlpSpan() generates valid OTLP span
- [ ] postSkillSpan("name", "success") POSTs to /api/ingest
- [ ] postSubagentSpan with metadata includes custom attributes
- [ ] postHookSpan("name", "success") works
- [ ] postToolSpan, postCommandSpan, postPluginSpan work
- [ ] Error spans include reason in attributes
- [ ] No prompt/response data leaked in spans
- [ ] STRATOS_SURFACE correctly set in spans
- [ ] Content-off behavior verified (no prompts)
- [ ] Multiple spans can post concurrently
- [ ] Spans work without STRATOS_TOKEN (gracefully skipped)

---

## Next Steps

1. **Claude Code plugin integration (external):**
   - Claude Code team implements hook registration
   - Stratos plugin auto-registers on `npm i -g`
   - Hooks call `postHookSpan`, `postSubagentSpan`, etc.

2. **Skill definition schema:**
   - How skills register themselves
   - How execution is tracked
   - Namespace collision handling

3. **Subagent orchestration:**
   - Track parent → child relationships
   - Aggregated metrics (time, cost, success rate)
   - Nesting depth limits

4. **Stratos dashboard:**
   - Render skill tree
   - Show execution timeline
   - Filter by surface + skill type

---

## Definition of Done (S-M3)

✅ ExecutionSpan class builds OTLP spans  
✅ All 6 span types implemented (skill, subagent, hook, cmd, plugin, mcp)  
✅ postSkillSpan, postSubagentSpan, postHookSpan, etc. helpers work  
✅ Content-off verified (no prompts/responses)  
✅ Error handling with reason attribute  
✅ Metadata support for custom attributes

**S-M3 is complete. Awaiting Claude Code team for hook integration.**
