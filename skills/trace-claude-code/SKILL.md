---
name: trace-claude-code
description: This skill should be used when the user asks to "trace Claude Code", "see what Claude Code is doing", "instrument Claude Code", "export Claude Code traces to 2kw", "observe my coding agent", "send Claude Code telemetry to 2kw", or "enable 2kw tracing for Claude Code". Configures Claude Code to export OpenTelemetry traces to the user's 2kw organization at the minimal tier (structure and timings, no prompt or tool content), then verifies spans arrive.
---

# 2kw:trace-claude-code

Points Claude Code's OpenTelemetry trace export at the user's 2kw organization, so their
coding sessions show up in the 2kw trace viewer. This applies the **minimal tier**:
span structure and timings only — no prompt content, no tool content.

The flow has two phases because telemetry env is read at process start:

1. **Apply** the configuration, then the user restarts Claude Code.
2. **Verify** that spans arrive, after the restart.

## Phase 1 — Apply

### Step 1 — Confirm credentials work first

Do not instrument with broken credentials. Run:

```bash
2kw auth status --json
```

If `authenticated` is not `true`, stop and run the `2kw:init` skill (or `2kw auth login`)
first, then return here.

### Step 2 — Preview the change

This edits the user's **global** `~/.claude/settings.json` and turns on data export to
their 2kw org, so show what will change before writing it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/trace-claude-code/scripts/apply-telemetry.mjs" --dry-run
```

The script reads the active-context credentials itself (via `2kw config list --json`), so
no key needs to be passed or pasted. The dry run prints the resulting `env` block and
notes if it will replace an existing telemetry block or remove content/enhanced flags.

Show the user the target file, the endpoint, and — if the note says an existing block is
being replaced — that any prompt/tool-content capture they had will be turned **off** by
the minimal tier. Get their confirmation before Step 3.

### Step 3 — Apply

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/trace-claude-code/scripts/apply-telemetry.mjs"
```

The script merges the minimal block into `settings.json`, preserving every unrelated key,
and is safe to re-run (idempotent). It refuses to touch a `settings.json` that is not
valid JSON.

### Step 4 — Tell the user to restart

State this plainly: **the change does not take effect in this session.** Claude Code reads
telemetry configuration once, at startup. The user must **quit and relaunch Claude Code**
before any spans are exported. A reload is not enough.

## Phase 2 — Verify (after the restart)

Once the user has restarted and done a little work (a few messages or tool calls), confirm
spans are arriving:

```bash
2kw tracing list --source-service claude-code --json
```

- **Rows come back** → success. Report how many traces, and that they are attributed to
  `claude-code` (not `unknown`). The user can open them in the 2kw trace viewer.
- **Empty** → the most common causes, in order: the user has not restarted yet; the
  restarted session has not produced any activity yet; or the org's tracing settings are
  rejecting the spans. Re-run `2kw auth status --json` to confirm the base URL is the same
  org whose viewer is being checked.

## What this tier does and does not capture

- **Captured:** trace and span structure, operation names, timings, span status.
- **Not captured:** user prompts and tool/file content — the `OTEL_LOG_*` flags are
  deliberately omitted, and any that were already set are removed. Richer tiers
  (prompts, tool content) are a separate, explicitly-consented step.
- **Token and cost metrics** ride the OpenTelemetry *metrics* signal, which 2kw does not
  ingest yet (issue #222). Until then, this shows what the agent *did*, not what it spent.

## Security note

At this tier the API key is written in plaintext into `settings.json`'s
`OTEL_EXPORTER_OTLP_TRACES_HEADERS`. That is a known interim state — issue #228 replaces it
with a headers-helper script so no token is stored. Mention this to the user if they are on
a shared or synced machine.

## Why the configuration looks the way it does

Every value is forced by the 2kw backend, not chosen for style — do not "simplify" them:

- **`OTEL_METRICS_EXPORTER=none`, `OTEL_LOGS_EXPORTER=none`** — 2kw exposes only a traces
  ingestion route. Leaving these on makes the SDK retry against endpoints that do not
  exist.
- **`http/protobuf`** — there is no gRPC listener, and the JSON encoder silently corrupts
  trace IDs. Never `grpc`, never `http/json`.
- **Explicit `OTEL_SERVICE_NAME` / `service.name`** — without it every span is filed under
  `unknown`.
- **The signal-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`** — the generic endpoint
  variable would also point metrics and logs at the host.
