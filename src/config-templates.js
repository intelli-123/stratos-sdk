// Config bundles for rolling Stratos out to many developers (MDM / scripts).
//
// Claude Code reports through hooks (see src/claude-code/), so a bundle is:
//   - the hook block for ~/.claude/settings.json or managed-settings.json
//   - the per-developer ~/.stratos/config.json (token + URL)
// Tokens come from Stratos enrollment; they are never invented here.

import { platform } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildClaudeCodeHooks, MANAGED_SETTINGS_PATHS } from "./claude-code/settings.js";

const SDK_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const SURFACES = ["claude-code"];

export class ConfigTemplate {
  constructor(opts = {}) {
    if (!opts.personEmail) throw new Error("ConfigTemplate: personEmail is required");
    if (!opts.token) throw new Error("ConfigTemplate: token is required (issue one from Stratos enrollment)");
    this.personEmail = opts.personEmail;
    this.surface = opts.surface || "claude-code";
    if (!SURFACES.includes(this.surface)) throw new Error(`ConfigTemplate: unsupported surface '${this.surface}'`);
    this.token = opts.token;
    this.url = (opts.url || "http://localhost:4000").replace(/\/+$/, "");
    this.osType = opts.osType || platform();
    this.recordContent = opts.recordContent === true;
    // Paths of node and the SDK on the *target* machines, if they differ from this one.
    this.hookPaths = { node: opts.nodePath, cli: opts.cliPath };
  }

  hooks() {
    const o = {};
    if (this.hookPaths.node) o.node = this.hookPaths.node;
    if (this.hookPaths.cli) o.cli = this.hookPaths.cli;
    return buildClaudeCodeHooks(o);
  }

  /** Contents of ~/.claude/settings.json additions (merge into existing hooks). */
  toSettingsJson() {
    return { hooks: this.hooks() };
  }

  /** Contents for managed-settings.json, enforced for every user on the machine. */
  toManagedSettings() {
    return { hooks: this.hooks() };
  }

  managedSettingsPath() {
    return MANAGED_SETTINGS_PATHS[this.osType] || MANAGED_SETTINGS_PATHS.linux;
  }

  /** Contents of ~/.stratos/config.json for this developer. */
  toStratosConfig() {
    return {
      token: this.token,
      url: this.url,
      appName: `claude-code:${this.personEmail.split("@")[0]}`,
      recordInputs: this.recordContent,
      recordOutputs: this.recordContent,
    };
  }

  toBundle() {
    return {
      version: "2.0",
      person: this.personEmail,
      surface: this.surface,
      os: this.osType,
      claude_settings: this.toSettingsJson(),
      managed_settings: { path: this.managedSettingsPath(), content: this.toManagedSettings() },
      stratos_config: { path: "~/.stratos/config.json", content: this.toStratosConfig() },
      metadata: { created_at: new Date().toISOString(), sdk_version: SDK_VERSION },
    };
  }

  save(dirPath) {
    const name = `stratos-config-${this.personEmail.replace(/@.*/, "")}-${this.surface}.json`;
    const jsonPath = join(dirPath, name);
    writeFileSync(jsonPath, JSON.stringify(this.toBundle(), null, 2), { encoding: "utf8", mode: 0o600 });
    return { jsonPath };
  }
}

export class MDMBundleGenerator {
  constructor(opts = {}) {
    this.orgUrl = opts.orgUrl || "http://localhost:4000";
    this.adminToken = opts.adminToken;
    this.templates = [];
  }

  addTemplate(template) {
    this.templates.push(template);
  }

  /** @param {Record<string,string>} tokens  surface → enrollment token for this person */
  generateForPerson(personEmail, tokens, opts = {}) {
    return Object.entries(tokens).map(
      ([surface, token]) => new ConfigTemplate({ ...opts, personEmail, surface, token, url: this.orgUrl })
    );
  }

  toManifest() {
    return {
      version: "2.0",
      org_url: this.orgUrl,
      bundles: this.templates.map((t) => t.toBundle()),
      metadata: {
        created_at: new Date().toISOString(),
        sdk_version: SDK_VERSION,
        total_bundles: this.templates.length,
        total_people: new Set(this.templates.map((t) => t.personEmail)).size,
      },
    };
  }

  async postToEnrollment(enrollmentUrl) {
    if (!this.adminToken) {
      console.error("[mdm-bundle] Admin token required to post enrollment");
      return false;
    }
    try {
      const res = await fetch(`${enrollmentUrl.replace(/\/+$/, "")}/api/mdm/bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.adminToken}` },
        body: JSON.stringify(this.toManifest()),
        signal: AbortSignal.timeout(10000),
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

/** @param {Record<string,string>} tokensByEmail  email → claude-code enrollment token */
export function createDefaultMDMBundle(tokensByEmail, orgUrl) {
  const generator = new MDMBundleGenerator({ orgUrl });
  for (const [email, token] of Object.entries(tokensByEmail)) {
    generator.generateForPerson(email, { "claude-code": token }).forEach((t) => generator.addTemplate(t));
  }
  return generator;
}
