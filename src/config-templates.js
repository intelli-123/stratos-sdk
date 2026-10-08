import { platform } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export class ConfigTemplate {
  constructor(opts = {}) {
    this.personEmail = opts.personEmail || "alice@company.com";
    this.surface = opts.surface || "claude-code"; // claude-code, claude-chat, claude-cowork
    this.token = opts.token || `sk_dev_${opts.personEmail.split("@")[0]}_${opts.surface}_${Date.now()}`;
    this.url = opts.url || "https://stratos.company.com";
    this.osType = opts.osType || platform();
    this.contentOff = opts.contentOff !== false;
    this.recordInputs = opts.recordInputs === true ? "1" : "0";
    this.recordOutputs = opts.recordOutputs === true ? "1" : "0";
  }

  toEnv() {
    return `STRATOS_TOKEN=${this.token}
STRATOS_URL=${this.url}
STRATOS_SURFACE=${this.surface}
STRATOS_RECORD_INPUTS=${this.recordInputs}
STRATOS_RECORD_OUTPUTS=${this.recordOutputs}
NODE_OPTIONS=--import @intelli-1113/stratos-sdk/register
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
`;
  }

  toSettingsJson() {
    return {
      surface: this.surface,
      owner_email: this.personEmail,
      env: {
        STRATOS_TOKEN: this.token,
        STRATOS_URL: this.url,
        STRATOS_SURFACE: this.surface,
        STRATOS_RECORD_INPUTS: this.recordInputs,
        STRATOS_RECORD_OUTPUTS: this.recordOutputs,
        NODE_OPTIONS: "--import @intelli-1113/stratos-sdk/register",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      },
      hooks: {
        PreToolUse: { enabled: true },
        PostToolUse: { enabled: true },
        SessionStart: { enabled: true },
        SessionStop: { enabled: true },
        SubagentStop: { enabled: true },
        UserPromptSubmit: { enabled: true },
      },
    };
  }

  toYaml() {
    const settings = this.toSettingsJson();
    return `# Stratos SDK Configuration
# Generated for: ${this.personEmail}
# Surface: ${this.surface}
# OS: ${this.osType}

surface: ${settings.surface}
owner_email: ${settings.owner_email}

env:
${Object.entries(settings.env)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join("\n")}

hooks:
${Object.entries(settings.hooks)
  .map(([k, v]) => `  ${k}: ${v.enabled}`)
  .join("\n")}

content_off: ${this.contentOff}
created_at: ${new Date().toISOString()}
`;
  }

  toBundle() {
    return {
      version: "1.0",
      person: this.personEmail,
      surface: this.surface,
      os: this.osType,
      config: this.toSettingsJson(),
      env_file: this.toEnv(),
      yaml_template: this.toYaml(),
      metadata: {
        created_at: new Date().toISOString(),
        sdk_version: "1.4.0",
      },
    };
  }

  save(dirPath) {
    const fileName = `stratos-config-${this.personEmail.replace(/@.*/, "")}-${this.surface}`;
    const yamlPath = join(dirPath, `${fileName}.yaml`);
    const jsonPath = join(dirPath, `${fileName}.json`);

    writeFileSync(yamlPath, this.toYaml(), "utf8");
    writeFileSync(jsonPath, JSON.stringify(this.toBundle(), null, 2), "utf8");

    return { yamlPath, jsonPath };
  }
}

export class MDMBundleGenerator {
  constructor(opts = {}) {
    this.orgUrl = opts.orgUrl || "https://stratos.company.com";
    this.adminToken = opts.adminToken;
    this.templates = [];
  }

  addTemplate(template) {
    this.templates.push(template);
  }

  generateForPerson(personEmail, surfaces = ["claude-code", "claude-chat", "claude-cowork"]) {
    const templates = [];
    for (const surface of surfaces) {
      const template = new ConfigTemplate({
        personEmail,
        surface,
        url: this.orgUrl,
      });
      templates.push(template);
    }
    return templates;
  }

  toManifest() {
    return {
      version: "1.0",
      org_url: this.orgUrl,
      bundles: this.templates.map((t) => t.toBundle()),
      metadata: {
        created_at: new Date().toISOString(),
        total_bundles: this.templates.length,
        total_people: new Set(this.templates.map((t) => t.personEmail)).size,
        total_surfaces: new Set(this.templates.map((t) => t.surface)).size,
      },
    };
  }

  async postToEnrollment(enrollmentUrl) {
    if (!this.adminToken) {
      console.error("[mdm-bundle] Admin token required to post enrollment");
      return false;
    }

    try {
      const manifest = this.toManifest();
      const res = await fetch(`${enrollmentUrl}/api/mdm/bundle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.adminToken}`,
        },
        body: JSON.stringify(manifest),
      });

      if (!res.ok) {
        console.error(`[mdm-bundle] Enrollment returned ${res.status}`);
        return false;
      }

      console.log("[mdm-bundle] Bundle posted to enrollment successfully");
      return true;
    } catch (err) {
      console.error(`[mdm-bundle] Failed to post: ${err.message}`);
      return false;
    }
  }
}

export function createDefaultMDMBundle(personEmails, orgUrl) {
  const generator = new MDMBundleGenerator({ orgUrl });

  for (const email of personEmails) {
    const templates = generator.generateForPerson(email);
    templates.forEach((t) => generator.addTemplate(t));
  }

  return generator;
}
