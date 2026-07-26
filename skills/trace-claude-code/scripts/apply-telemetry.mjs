#!/usr/bin/env node
// Apply the MINIMAL 2kw telemetry configuration to Claude Code's settings.json.
//
// Minimal tier = trace structure and timings only. No prompt content, no tool
// content. Any content/enhanced flags left over from another setup are removed
// so the tier's "no content" guarantee actually holds.
//
// Credentials are read from the active bb context via `2kw config list --json`,
// never passed as arguments, so the API key never lands in a process list or
// shell history. The key IS written into settings.json's env block, though —
// see the SECURITY note the script prints. Issue #228 replaces that with an
// otelHeadersHelper so no plaintext token is stored.
//
// Usage:
//   node apply-telemetry.mjs [--dry-run] [--settings <path>]
//
// Exit codes: 0 applied (or dry-run), 2 no working credentials, 1 other error.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const settingsIdx = args.indexOf("--settings");
const settingsPath =
  settingsIdx !== -1 && args[settingsIdx + 1]
    ? args[settingsIdx + 1]
    : join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");

// Keys this skill owns. Set on apply.
const MANAGED = (baseUrl, key) => ({
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_METRICS_EXPORTER: "none",
  OTEL_LOGS_EXPORTER: "none",
  OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${baseUrl.replace(/\/+$/, "")}/v1/traces`,
  OTEL_EXPORTER_OTLP_TRACES_HEADERS: `Authorization=Bearer ${key}`,
  OTEL_SERVICE_NAME: "claude-code",
  OTEL_RESOURCE_ATTRIBUTES: "service.name=claude-code",
});

// Content/enhanced flags removed at the minimal tier so no prompt or tool
// content is ever exported, even if a previous setup enabled them.
const REMOVED_AT_MINIMAL = [
  "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
  "OTEL_LOG_USER_PROMPTS",
  "OTEL_LOG_TOOL_DETAILS",
  "OTEL_LOG_TOOL_CONTENT",
  "OTEL_LOG_ASSISTANT_RESPONSES",
];

function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

function readCreds() {
  let raw;
  try {
    // execSync goes through a shell, which resolves the `2kw` bin whether it is
    // a plain script (unix) or a `.cmd`/`.ps1` shim (Windows). stderr is
    // inherited so the CLI's update notice reaches the terminal without
    // polluting the captured stdout.
    raw = execSync("2kw config list --json", { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  } catch (e) {
    fail(2, `Could not run "2kw config list --json". Is the 2kw CLI installed and on PATH?\n${e.message ?? e}`);
  }
  // Defensive: extract the JSON object even if anything non-JSON slips onto
  // stdout ahead of or after it.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let creds;
  try {
    creds = JSON.parse(start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw);
  } catch {
    fail(1, `Unexpected output from "2kw config list --json":\n${raw}`);
  }
  if (!creds.apiKey || !creds.baseUrl) {
    fail(2, 'No active credentials. Run "2kw auth login" (or the 2kw:init skill) first.');
  }
  return creds;
}

function readSettings(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(1, `settings.json exists but is not valid JSON — refusing to overwrite: ${path}\n${e.message ?? e}`);
  }
}

function writeAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.2kw.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

function mask(key) {
  return key.length > 11 ? `${key.slice(0, 7)}...${key.slice(-4)}` : "sk_***";
}

const { apiKey, baseUrl } = readCreds();
const settings = readSettings(settingsPath);
const prevEnv = settings.env ?? {};

const managed = MANAGED(baseUrl, apiKey);
const removed = REMOVED_AT_MINIMAL.filter((k) => k in prevEnv);
const hadOtel = "OTEL_TRACES_EXPORTER" in prevEnv || removed.length > 0;

// Merge: preserve every unrelated key; set managed keys; drop content flags.
const nextEnv = { ...prevEnv, ...managed };
for (const k of REMOVED_AT_MINIMAL) delete nextEnv[k];
const next = { ...settings, env: nextEnv };

console.log(`Target: ${settingsPath}`);
console.log(`Tier:   minimal (traces only — no prompt or tool content)`);
console.log(`Endpoint: ${managed.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT}`);
console.log(`Auth:   Authorization=Bearer ${mask(apiKey)}`);
if (hadOtel) console.log(`Note:   replaced an existing telemetry block${removed.length ? `; removed content/enhanced flags: ${removed.join(", ")}` : ""}.`);

if (dryRun) {
  console.log("\n--dry-run — resulting env block:\n");
  console.log(JSON.stringify(nextEnv, null, 2));
  process.exit(0);
}

writeAtomic(settingsPath, next);

console.log("\nApplied. Two things:");
console.log("  1. RESTART Claude Code. Telemetry env is read at process start, so this");
console.log("     session is NOT yet exporting — the change takes effect next launch.");
console.log("  2. SECURITY: your API key is now in plaintext in settings.json. Issue #228");
console.log("     replaces this with a headers-helper script so no token is stored.");
