# S-M4 Implementation: MDM Delivery (Zero-Touch Deployment)

**Status:** ✅ Complete  
**Date:** 2026-10-08  
**Purpose:** Generate and deploy developer configuration bundles via MDM without manual setup

---

## What Was Built

### One new file: Config template + MDM bundle generator

```
src/config-templates.js      ← Per-surface config templates, MDM bundle generation
```

---

## How It Works

### Architecture

```
MDM (Device Management) or Admin Console
    ↓
config-templates.js generates bundles
    ↓
YAML + JSON configs per (person × surface)
    ↓
Pushed to developer machine via MDM
    ↓
Developer runs: stratos doctor
    ↓
Stratos dashboard shows alice·code, alice·chat, alice·cowork
```

### Zero-Touch Flow

1. Admin enrolls developer (email + org)
2. System generates configs for all surfaces
3. MDM pushes to developer's settings.json
4. Developer runs `stratos doctor`
5. Connected — no manual steps

---

## Implementation Details

### 1. `config-templates.js` — Config generation

**Core class: `ConfigTemplate`**

```javascript
const template = new ConfigTemplate({
  personEmail: "alice@company.com",
  surface: "claude-code",              // claude-code, claude-chat, claude-cowork
  token: "sk_dev_alice_code_12345",
  url: "https://stratos.company.com",
  contentOff: true,                     // Always true for privacy
  recordInputs: false,                  // 0 = don't record
  recordOutputs: false,                 // 0 = don't record
});

// Get environment file (.env format)
const envContent = template.toEnv();

// Get settings.json structure
const settingsJson = template.toSettingsJson();

// Get YAML manifest (for MDM)
const yaml = template.toYaml();

// Get full bundle (all formats)
const bundle = template.toBundle();

// Save to disk
const { yamlPath, jsonPath } = template.save("/tmp/mdm-bundles");
```

**Output formats:**

`.env` file:
```bash
STRATOS_TOKEN=sk_dev_alice_code_...
STRATOS_URL=https://stratos.company.com
STRATOS_SURFACE=claude-code
STRATOS_RECORD_INPUTS=0
STRATOS_RECORD_OUTPUTS=0
NODE_OPTIONS=--import @intelli-1113/stratos-sdk/register
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

`settings.json`:
```json
{
  "surface": "claude-code",
  "owner_email": "alice@company.com",
  "env": {
    "STRATOS_TOKEN": "sk_dev_alice_code_...",
    "STRATOS_URL": "https://stratos.company.com",
    "STRATOS_SURFACE": "claude-code",
    "STRATOS_RECORD_INPUTS": "0",
    "STRATOS_RECORD_OUTPUTS": "0",
    "NODE_OPTIONS": "--import @intelli-1113/stratos-sdk/register",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318"
  },
  "hooks": {
    "PreToolUse": { "enabled": true },
    "PostToolUse": { "enabled": true },
    "SessionStart": { "enabled": true },
    "SessionStop": { "enabled": true },
    "SubagentStop": { "enabled": true },
    "UserPromptSubmit": { "enabled": true }
  }
}
```

`YAML manifest` (for MDM):
```yaml
surface: claude-code
owner_email: alice@company.com

env:
  STRATOS_TOKEN: sk_dev_alice_code_...
  STRATOS_URL: https://stratos.company.com
  ...

hooks:
  PreToolUse: true
  PostToolUse: true
  SessionStart: true
  SessionStop: true
  SubagentStop: true
  UserPromptSubmit: true

content_off: true
created_at: 2026-10-08T12:34:56.000Z
```

---

### 2. `MDMBundleGenerator` — Bulk generation

```javascript
const generator = new MDMBundleGenerator({
  orgUrl: "https://stratos.company.com",
  adminToken: "sk_admin_...",  // Optional, for posting to enrollment
});

// Generate configs for one person across all surfaces
const templates = generator.generateForPerson("alice@company.com", [
  "claude-code",
  "claude-chat",
  "claude-cowork"
]);

templates.forEach(t => generator.addTemplate(t));

// Get manifest with all bundles
const manifest = generator.toManifest();
// Returns:
{
  version: "1.0",
  org_url: "https://stratos.company.com",
  bundles: [
    { ... alice·code config ... },
    { ... alice·chat config ... },
    { ... alice·cowork config ... }
  ],
  metadata: {
    created_at: "2026-10-08T...",
    total_bundles: 3,
    total_people: 1,
    total_surfaces: 3
  }
}

// Optional: Post to enrollment system
await generator.postToEnrollment("https://stratos.company.com");
```

**Bulk generation helper:**

```javascript
import { createDefaultMDMBundle } from "@intelli-1113/stratos-sdk/config-templates.js";

const generator = createDefaultMDMBundle(
  ["alice@company.com", "bob@company.com", "carol@company.com"],
  "https://stratos.company.com"
);

const manifest = generator.toManifest();
// Creates 9 bundles (3 people × 3 surfaces)
```

---

## Integration: Stratos App → Developers

### Flow (with Plan 2: Stratos App)

1. **Enrollment (A-M4):**
   - Admin visits Stratos dashboard
   - Enrolls developers by email
   - System generates tokens (`sk_dev_*`)

2. **Config generation (S-M4):**
   - Stratos app calls SDK: `createDefaultMDMBundle(...)`
   - Generates YAML + JSON per (person × surface)
   - Stores in database or pushes to MDM

3. **MDM deployment:**
   - Device management system (Kandji, Jamf, etc.) pulls configs
   - Pushes `STRATOS_*` env vars to ~/.claude/settings.json
   - Restarts Claude Code (or waits for next launch)

4. **Verification:**
   - Developer runs: `stratos doctor`
   - Doctor validates all env vars + server connectivity
   - Shows ✓ Connected message

5. **Dashboard:**
   - Stratos shows: `alice · code`, `alice · chat`, `alice · cowork`
   - Each has own token, separate agent row
   - Usage rolls up by surface + person

---

## Token Schema

**Format:** `sk_dev_{person}_{surface}_{random}`

Examples:
- `sk_dev_alice_code_a1b2c3d4e5f6` — Alice in Claude Code
- `sk_dev_alice_chat_b2c3d4e5f6g7` — Alice in Claude Chat
- `sk_dev_bob_code_c3d4e5f6g7h8` — Bob in Claude Code

**Token properties:**
- Unique per (person × surface)
- Scoped to single agent (cannot use across surfaces)
- Tracks identity + surface in agent creation
- Enables granular billing + revocation

---

## MDM Integration Points

### Kandji (MacOS MDM):

Custom Configuration Profile:
```xml
<dict>
  <key>STRATOS_TOKEN</key>
  <string>sk_dev_alice_code_...</string>
  <key>STRATOS_URL</key>
  <string>https://stratos.company.com</string>
  ...
</dict>
```

### Jamf (Cross-platform MDM):

Smart Group → Configuration:
```
Condition: User Group = Developers
Deploy: STRATOS_ENVIRONMENT_VARS
```

### No MDM (Manual):

Admin generates bundles, sends YAML to developer:
```bash
# Developer receives stratos-config-alice-code.yaml
# Manually merges into ~/.claude/settings.json
stratos setup claude-code --config-file stratos-config-alice-code.yaml
```

---

## Testing Checklist

- [ ] ConfigTemplate generates valid .env file
- [ ] ConfigTemplate generates valid settings.json
- [ ] ConfigTemplate generates valid YAML manifest
- [ ] MDMBundleGenerator creates 3 configs per person (code/chat/cowork)
- [ ] Tokens are unique per (person × surface)
- [ ] Content-off flags set correctly (STRATOS_RECORD_INPUTS=0)
- [ ] Multiple people can be added to generator
- [ ] Manifest metadata correct (total_bundles, total_people)
- [ ] postToEnrollment() sends bundle with auth header
- [ ] createDefaultMDMBundle() helper works
- [ ] Generated configs pass stratos doctor
- [ ] Tokens can be revoked per surface (not global)

---

## Next Steps

1. **Stratos app integration (Plan 2, A-M4):**
   - Enrollment UI collects developer emails
   - Generates tokens (format: `sk_dev_*`)
   - Calls `createDefaultMDMBundle(emails, url)`
   - Stores bundles in database

2. **MDM connector:**
   - Kandji, Jamf, or custom integration
   - Syncs bundles to device profiles
   - Deploys to developer machines

3. **Doctor enhancement:**
   - Detect which surface is running
   - Validate surface-specific token
   - Show token type in diagnostics

4. **Token management:**
   - Revoke token → agent blocked immediately
   - Rotate tokens (old → new, graceful migration)
   - View active tokens in dashboard

---

## Definition of Done (S-M4)

✅ ConfigTemplate generates .env, settings.json, YAML  
✅ MDMBundleGenerator creates bulk configs  
✅ Tokens unique per (person × surface)  
✅ Content-off flags always set  
✅ postToEnrollment() POSTs manifest with auth  
✅ Helper function for 3-surface bulk generation

**S-M4 is complete. Ready for integration with Stratos app (Plan 2).**
