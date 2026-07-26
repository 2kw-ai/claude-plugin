#!/usr/bin/env node
// Apply (or remove) 2kw telemetry configuration in Claude Code's settings.json.
//
// Tiers — the user picks one; the difference is only how much CONTENT is
// exported. All tiers export trace structure and timings.
//   minimal   traces only. No prompt content, no tool content.
//   standard  + the user's own prompts.
//   full      + tool details and tool CONTENT (file contents Claude reads,
//               including files the user did not author).
//
// Whatever flags a tier does NOT include are actively removed, so the chosen
// tier's guarantee holds even over a previous, higher setup.
//
// Credentials are read from the active bb context via `2kw config list --json`,
// never passed as arguments, so the API key never lands in a process list or
// shell history. The key IS written into settings.json's env block — see the
// SECURITY note. Issue #228 replaces that with an otelHeadersHelper.
//
// Usage:
//   node apply-telemetry.mjs --tier <minimal|standard|full> [--dry-run] [--settings <path>]
//   node apply-telemetry.mjs --off [--dry-run] [--settings <path>]
//
// Exit codes: 0 ok/dry-run, 2 no credentials, 1 other error (incl. bad args).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const off = args.includes("--off");
const tierIdx = args.indexOf("--tier");
const tier = tierIdx !== -1 ? args[tierIdx + 1] : off ? null : "minimal";
const settingsIdx = args.indexOf("--settings");
const settingsPath =
  settingsIdx !== -1 && args[settingsIdx + 1]
    ? args[settingsIdx + 1]
    : join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");

// Base trace-export keys, common to every tier. Owned by this skill.
const BASE = (baseUrl, key) => ({
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

// Optional content/enhanced flags. Each tier enables a subset; the rest are
// removed. OTEL_LOG_ASSISTANT_RESPONSES is never enabled — it rides the logs
// signal, which 2kw does not ingest, so it is a no-op (kept here only so an
// old setup's copy gets cleaned up).
const TIER_FLAGS = {
  minimal: {},
  standard: { OTEL_LOG_USER_PROMPTS: "1" },
  full: {
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
    OTEL_LOG_USER_PROMPTS: "1",
    OTEL_LOG_TOOL_DETAILS: "1",
    OTEL_LOG_TOOL_CONTENT: "1",
  },
};
const ALL_OPTIONAL_FLAGS = [
  "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
  "OTEL_LOG_USER_PROMPTS",
  "OTEL_LOG_TOOL_DETAILS",
  "OTEL_LOG_TOOL_CONTENT",
  "OTEL_LOG_ASSISTANT_RESPONSES",
];
const BASE_KEYS = Object.keys(BASE("x", "x"));

function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

if (!off && !(tier in TIER_FLAGS)) {
  fail(1, `Unknown or missing --tier. Use one of: minimal, standard, full (or --off to remove).`);
}

function readCreds() {
  let raw;
  try {
    raw = execSync("2kw config list --json", { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  } catch (e) {
    fail(2, `Could not run "2kw config list --json". Is the 2kw CLI installed and on PATH?\n${e.message ?? e}`);
  }
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

const mask = (k) => (k.length > 11 ? `${k.slice(0, 7)}...${k.slice(-4)}` : "sk_***");

const settings = readSettings(settingsPath);
const prevEnv = settings.env ?? {};
let nextEnv;

if (off) {
  // Remove every key this skill manages; keep everything else untouched.
  nextEnv = { ...prevEnv };
  for (const k of [...BASE_KEYS, ...ALL_OPTIONAL_FLAGS]) delete nextEnv[k];
  console.log(`Target: ${settingsPath}`);
  console.log(`Action: OFF — removing all 2kw telemetry keys.`);
} else {
  const { apiKey, baseUrl } = readCreds();
  const enabled = TIER_FLAGS[tier];
  // Set base + this tier's flags; remove any optional flag not in this tier.
  nextEnv = { ...prevEnv, ...BASE(baseUrl, apiKey), ...enabled };
  for (const k of ALL_OPTIONAL_FLAGS) if (!(k in enabled)) delete nextEnv[k];

  const stripped = ALL_OPTIONAL_FLAGS.filter((k) => !(k in enabled) && k in prevEnv);
  console.log(`Target: ${settingsPath}`);
  console.log(`Tier:   ${tier} — ${describeTier(tier)}`);
  console.log(`Endpoint: ${nextEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT}`);
  console.log(`Auth:   Authorization=Bearer ${mask(apiKey)}`);
  if (stripped.length) console.log(`Note:   removed flags not in this tier: ${stripped.join(", ")}.`);
}

// If the env object is now empty, drop it entirely rather than leaving `{}`.
const next = { ...settings };
if (Object.keys(nextEnv).length === 0) delete next.env;
else next.env = nextEnv;

if (dryRun) {
  console.log("\n--dry-run — resulting env block:\n");
  console.log(JSON.stringify(next.env ?? {}, null, 2));
  process.exit(0);
}

writeAtomic(settingsPath, next);

if (off) {
  console.log("\nRemoved. RESTART Claude Code for it to stop exporting (env is read at startup).");
} else {
  console.log("\nApplied. Two things:");
  console.log("  1. RESTART Claude Code. Telemetry env is read at process start, so this");
  console.log("     session is NOT yet exporting — the change takes effect next launch.");
  console.log("  2. SECURITY: your API key is now in plaintext in settings.json. Issue #228");
  console.log("     replaces this with a headers-helper script so no token is stored.");
  if (tier === "full") {
    console.log("  3. FULL tier exports tool CONTENT — file contents Claude reads, including");
    console.log("     files you did not author. Do not use it on repos you cannot share.");
  }
}

function describeTier(t) {
  return {
    minimal: "traces only, no prompt or tool content",
    standard: "traces + your prompts, no tool content",
    full: "traces + prompts + tool content (file contents Claude reads)",
  }[t];
}
