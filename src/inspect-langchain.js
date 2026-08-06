// LangChain / Stratos compatibility inspect + optional fix (client project cwd).
//
// Traceloop instrumentation peer (via @traceloop/instrumentation-langchain):
//   @langchain/core >=1.0.0 <2.0.0
//
// Usage (CLI):
//   npx stratos-inspect
//   npx stratos-inspect --fix
//   npx stratos-inspect --fix --yes

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

/** Peer range of @traceloop/instrumentation-langchain@0.27 */
export const LANGCHAIN_CORE_RANGE = {
  minInclusive: "1.0.0",
  maxExclusive: "2.0.0",
  npmInstall: "@langchain/core@^1.2.4",
};

/** Packages we may touch when --fix is used (only if present / related). */
export const LANGCHAIN_FAMILY = [
  "langchain",
  "@langchain/core",
  "@langchain/community",
  "@langchain/openai",
  "@langchain/anthropic",
  "@langchain/mistralai",
  "@langchain/google-genai",
  "@langchain/google-vertexai",
  "@langchain/tavily",
  "@langchain/langgraph",
  "@langchain/langgraph-checkpoint",
  "@langchain/classic",
  "@langchain/textsplitters",
];

/** Safe 1.x installs for a typical Stratos + LangChain agent. */
export const RECOMMENDED_INSTALL = [
  "@langchain/core@^1.2.4",
  "langchain@^1.5.4",
];

function parseSemver(v) {
  if (!v || typeof v !== "string") return null;
  const cleaned = v.replace(/^[=v^~<>]*/, "").split("-")[0].trim();
  const m = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    // package.json range like "^0.3.0" → take first numbers
    const m2 = v.match(/(\d+)\.(\d+)\.(\d+)/) || v.match(/(\d+)\.(\d+)/);
    if (!m2) return null;
    return {
      major: Number(m2[1]),
      minor: Number(m2[2]),
      patch: Number(m2[3] || 0),
      raw: v,
    };
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    raw: v,
  };
}

function cmp(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * @returns {"ok"|"too_old"|"too_new"|"unknown"|"absent"}
 */
export function classifyCoreVersion(versionStr) {
  if (!versionStr) return "absent";
  const v = parseSemver(versionStr);
  if (!v) return "unknown";
  const min = parseSemver(LANGCHAIN_CORE_RANGE.minInclusive);
  const max = parseSemver(LANGCHAIN_CORE_RANGE.maxExclusive);
  if (cmp(v, min) < 0) return "too_old";
  if (cmp(v, max) >= 0) return "too_new";
  return "ok";
}

function readPkgJson(cwd) {
  const p = join(cwd, "package.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function declaredDeps(pkg) {
  return {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
    ...(pkg?.optionalDependencies || {}),
  };
}

function resolveInstalledVersion(cwd, name) {
  try {
    const req = createRequire(join(cwd, "package.json"));
    const pkgPath = req.resolve(`${name}/package.json`);
    const meta = JSON.parse(readFileSync(pkgPath, "utf8"));
    return { version: meta.version, path: pkgPath };
  } catch {
    return null;
  }
}

function detectPackageManager(cwd) {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock")))
    return "bun";
  return "npm";
}

/**
 * Inspect LangChain compatibility for a project directory (default: cwd).
 * @param {{ cwd?: string }} [opts]
 */
export function inspectLangChain(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const pkg = readPkgJson(cwd);
  const declared = pkg ? declaredDeps(pkg) : {};

  const found = [];
  for (const name of LANGCHAIN_FAMILY) {
    const declaredRange = declared[name] || null;
    const installed = resolveInstalledVersion(cwd, name);
    if (!declaredRange && !installed) continue;
    found.push({
      name,
      declared: declaredRange,
      installed: installed?.version || null,
      installPath: installed?.path || null,
    });
  }

  const core =
    found.find((f) => f.name === "@langchain/core") ||
    (declared["@langchain/core"]
      ? {
          name: "@langchain/core",
          declared: declared["@langchain/core"],
          installed: null,
          installPath: null,
        }
      : null);

  const coreVersion = core?.installed || core?.declared || null;
  const status = core
    ? classifyCoreVersion(core?.installed || core?.declared)
    : found.length
      ? "unknown"
      : "absent";

  const compatible = status === "ok" || status === "absent";
  // absent = no LangChain → Stratos still fine (other frameworks)
  // too_old / too_new / unknown with langchain present → problem for LC metrics

  const hasLangChain = found.length > 0 || !!core;
  const needsUpgrade = status === "too_old";
  const needsAttention = status === "too_old" || status === "too_new";

  return {
    cwd,
    packageManager: detectPackageManager(cwd),
    hasLangChain,
    status,
    compatible: !hasLangChain || status === "ok",
    needsUpgrade,
    needsAttention,
    core: core
      ? {
          declared: core.declared,
          installed: core.installed,
          versionForCheck: coreVersion,
          status,
        }
      : null,
    packages: found,
    required: {
      peer: `@langchain/core >=${LANGCHAIN_CORE_RANGE.minInclusive} <${LANGCHAIN_CORE_RANGE.maxExclusive}`,
      recommendedInstall: RECOMMENDED_INSTALL,
    },
    message: buildMessage(status, hasLangChain, coreVersion),
  };
}

function buildMessage(status, hasLangChain, coreVersion) {
  if (!hasLangChain || status === "absent") {
    return "No LangChain packages found — nothing to upgrade for LangChain metrics.";
  }
  if (status === "ok") {
    return `@langchain/core@${coreVersion} is compatible with Stratos LangChain auto-instrumentation.`;
  }
  if (status === "too_old") {
    return (
      `@langchain/core@${coreVersion} is too old for Stratos LangChain metrics. ` +
      `Required: >=1.0.0 <2.0.0. Uninstall old LangChain packages, then install 1.x.`
    );
  }
  if (status === "too_new") {
    return (
      `@langchain/core@${coreVersion} is newer than the current OpenLLMetry peer range (<2.0.0). ` +
      `LangChain metrics may not work until Stratos/Traceloop supports core 2.x.`
    );
  }
  return `Could not parse @langchain/core version (${coreVersion}). Expected >=1.0.0 <2.0.0.`;
}

function runPm(pm, args, cwd) {
  const cmd = pm === "npm" ? "npm" : pm;
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  return result.status === 0;
}

/**
 * Uninstall detected LangChain family packages, then install recommended 1.x set
 * (+ re-install any previously present family packages at ^1 if they were there).
 *
 * @param {{ cwd?: string, yes?: boolean, dryRun?: boolean }} [opts]
 */
export async function fixLangChain(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const report = inspectLangChain({ cwd });
  const pm = report.packageManager;

  if (!report.hasLangChain) {
    return {
      ok: true,
      skipped: true,
      reason: "no-langchain",
      report,
    };
  }

  if (report.status === "ok") {
    return {
      ok: true,
      skipped: true,
      reason: "already-compatible",
      report,
    };
  }

  if (report.status === "too_new") {
    return {
      ok: false,
      skipped: true,
      reason: "too-new",
      report,
      message:
        "Core is >=2.0.0 — automatic downgrade is not performed. Pin <2 or wait for SDK support.",
    };
  }

  if (report.status !== "too_old" && report.status !== "unknown") {
    return { ok: false, skipped: true, reason: report.status, report };
  }

  const toRemove = report.packages.map((p) => p.name);
  // Also remove declared-only names
  const pkg = readPkgJson(cwd);
  const declared = pkg ? declaredDeps(pkg) : {};
  for (const name of LANGCHAIN_FAMILY) {
    if (declared[name] && !toRemove.includes(name)) toRemove.push(name);
  }

  // Reinstall: recommended base + any extra family packages client had, on ^1
  const reinstall = new Set(RECOMMENDED_INSTALL);
  for (const name of toRemove) {
    if (name === "@langchain/core" || name === "langchain") continue;
    // keep provider packages if they were present
    if (report.packages.some((p) => p.name === name) || declared[name]) {
      reinstall.add(`${name}@^1`);
    }
  }

  const plan = {
    packageManager: pm,
    uninstall: toRemove,
    install: [...reinstall],
  };

  if (opts.dryRun) {
    return { ok: true, dryRun: true, plan, report };
  }

  if (!opts.yes) {
    const confirmed = await confirm(
      `\n[stratos-inspect] About to:\n` +
        `  1) uninstall: ${toRemove.join(", ")}\n` +
        `  2) install:   ${[...reinstall].join(", ")}\n` +
        `in ${cwd}\n\nProceed? [y/N] `
    );
    if (!confirmed) {
      return { ok: false, cancelled: true, plan, report };
    }
  }

  console.log(`\n[stratos-inspect] Using package manager: ${pm}`);
  console.log(`[stratos-inspect] Uninstalling old LangChain packages…`);

  let uninstallOk = true;
  if (toRemove.length) {
    if (pm === "npm") {
      uninstallOk = runPm("npm", ["uninstall", ...toRemove], cwd);
    } else if (pm === "pnpm") {
      uninstallOk = runPm("pnpm", ["remove", ...toRemove], cwd);
    } else if (pm === "yarn") {
      uninstallOk = runPm("yarn", ["remove", ...toRemove], cwd);
    } else if (pm === "bun") {
      uninstallOk = runPm("bun", ["remove", ...toRemove], cwd);
    }
  }

  if (!uninstallOk) {
    return {
      ok: false,
      step: "uninstall",
      plan,
      report,
      message: "Uninstall failed — fix manually and re-run stratos-inspect --fix",
    };
  }

  console.log(`[stratos-inspect] Installing LangChain 1.x packages…`);
  const installList = [...reinstall];
  let installOk = false;
  if (pm === "npm") {
    installOk = runPm("npm", ["install", ...installList], cwd);
  } else if (pm === "pnpm") {
    installOk = runPm("pnpm", ["add", ...installList], cwd);
  } else if (pm === "yarn") {
    installOk = runPm("yarn", ["add", ...installList], cwd);
  } else if (pm === "bun") {
    installOk = runPm("bun", ["add", ...installList], cwd);
  }

  const after = inspectLangChain({ cwd });
  return {
    ok: installOk && after.status === "ok",
    step: "install",
    plan,
    reportBefore: report,
    reportAfter: after,
    message: after.message,
  };
}

function confirm(question) {
  if (!process.stdin.isTTY) {
    console.warn(
      "[stratos-inspect] Non-interactive terminal — pass --yes to apply fix, or run with a TTY."
    );
    return Promise.resolve(false);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const a = String(answer || "").trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}

/** Human-readable print for CLI / postinstall */
export function printInspectReport(report, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("\n[stratos-inspect] LangChain compatibility");
  console.log(`  project:  ${report.cwd}`);
  console.log(`  pm:       ${report.packageManager}`);
  console.log(`  status:   ${report.status}`);
  console.log(`  required: ${report.required.peer}`);

  if (report.core) {
    console.log(
      `  core:     installed=${report.core.installed || "—"}  declared=${report.core.declared || "—"}`
    );
  }

  if (report.packages.length) {
    console.log("  packages:");
    for (const p of report.packages) {
      console.log(
        `    - ${p.name}: ${p.installed || p.declared || "?"}${p.installed && p.declared ? ` (declared ${p.declared})` : ""}`
      );
    }
  }

  console.log(`\n  ${report.message}`);

  if (report.needsUpgrade) {
    console.log(`
  Fix (interactive):
    npx stratos-inspect --fix

  Fix (non-interactive):
    npx stratos-inspect --fix --yes

  Or manually:
    npm uninstall ${report.packages.map((p) => p.name).join(" ")}
    npm install ${report.required.recommendedInstall.join(" ")}
`);
  }
  console.log("");
}
