---
name: trace-claude-code
description: This skill should be used when the user asks to "trace Claude Code", "see what Claude Code is doing", "instrument Claude Code", "export Claude Code traces to 2kw", "observe my coding agent", "send Claude Code telemetry to 2kw", "enable 2kw tracing for Claude Code", or to "turn off"/"stop"/"disable 2kw tracing". Configures Claude Code to export OpenTelemetry traces to the user's 2kw organization at a consented tier (minimal, standard, or full), verifies spans arrive, and can fully remove the configuration.
---

# 2kw:trace-claude-code

Points Claude Code's OpenTelemetry trace export at the user's 2kw organization, so their
coding sessions show up in the 2kw trace viewer. The user picks how much is captured; all
tiers export trace structure and timings.

| Tier | Captures | Does not capture |
|---|---|---|
| `minimal` | structure, timings | prompts, tool content |
| `standard` *(recommended)* | + the user's own prompts | tool content |
| `full` | + tool content — **file contents Claude reads, including files the user did not author** | — |

The flow has two phases because telemetry env is read at process start:

1. **Choose a tier and apply** the configuration, then the user restarts Claude Code.
2. **Verify** that spans arrive, after the restart.

To remove telemetry entirely, see **Uninstall** below.

## Phase 1 — Apply

### Step 1 — Confirm credentials work first

Do not instrument with broken credentials. Run:

```bash
2kw auth status --json
```

If `authenticated` is not `true`, stop and run the `2kw:init` skill (or `2kw auth login`)
first, then return here.

### Step 2 — Get consent on a tier

This edits the user's **global** `~/.claude/settings.json` — it applies to **every project
they open, including client work** — and turns on data export to their 2kw org. So this is
a consent step, and it is asked once here, not per session.

Present the three tiers from the table above and let the user choose. Recommend
`standard`. Call out the `standard` → `full` boundary explicitly, because it is the one
that matters: **prompts are the user's own words; `full` also sends the contents of files
Claude reads — a customer CSV, a colleague's source, a `.env` that happened to be open.**
Only apply `full` if the user deliberately asks for it.

Preview the exact change before writing it (this does not modify anything):

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/trace-claude-code/scripts/apply-telemetry.mjs" --tier <tier> --dry-run
```

The script reads the active-context credentials itself (via `2kw config list --json`), so
no key is passed or pasted. The dry run prints the resulting `env` block and notes any
flags it will remove (e.g. downgrading from a previous higher tier). Show the user the
target file, the endpoint, and the tier, and get their confirmation before Step 3.

### Step 3 — Apply the chosen tier

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/trace-claude-code/scripts/apply-telemetry.mjs" --tier <tier>
```

The script merges the block into `settings.json`, preserving every unrelated key, sets
exactly the chosen tier's flags (removing any from a higher tier), and is safe to re-run
(idempotent). It refuses to touch a `settings.json` that is not valid JSON.

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

## Uninstall

To stop exporting and remove the configuration entirely:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/trace-claude-code/scripts/apply-telemetry.mjs" --off
```

This removes every key the skill manages (base trace keys and all content flags),
preserving every unrelated key in `settings.json`. As with applying, it takes effect on the
next Claude Code restart — tell the user to relaunch.

## What each tier captures

- **All tiers:** trace and span structure, operation names, timings, span status.
- **`standard` adds** the user's prompts; **`full` adds** tool details and tool content
  (file contents Claude reads). `minimal` sends neither, and whatever a chosen tier omits
  is actively removed from a prior setup.
- **Token and cost metrics** ride the OpenTelemetry *metrics* signal, which 2kw does not
  ingest yet (issue #222). Until then, this shows what the agent *did*, not what it spent.

## Security note

The API key is written in plaintext into `settings.json`'s
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
