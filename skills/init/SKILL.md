---
name: init
description: This skill should be used when the user asks to "set up 2kw", "connect to 2kw", "log in to 2kw", "configure 2kw", "check my 2kw connection", "am I authenticated to 2kw", or "install the 2kw CLI". Also use when another 2kw skill reports missing, expired, or invalid credentials. Verifies the 2kw CLI is installed at a supported version and that stored credentials authenticate against the live API.
---

# 2kw:init

Gets this machine from nothing to a verified, working 2kw setup.

**Be fast on the happy path.** When credentials already work and the CLI is current, this
is one command and a one-line confirmation. Do not re-run setup that is already done, and
do not ask questions that inspection can answer.

## Step 1 — Is the CLI present?

```bash
2kw --version
```

- **Prints a version** → continue to Step 2.
- **Command not found** → the CLI is not installed. Offer the user a choice, and say why:

  - `npm i -g @2kw/ai` — recommended. Fast, and every later step is a direct call.
  - `npx @2kw/ai@latest` — no install, but pays startup cost on every command, which is
    noticeable in multi-step skills.

  Install, then re-run `2kw --version` to confirm. If the user declines both, stop and say
  the remaining 2kw skills cannot run without the CLI.

The binary is also available as `bb` and `backbone`. Prefer `2kw` — the aliases exist for
backwards compatibility.

## Step 2 — Is the version supported?

Minimum supported major version: **4** (the first published `@2kw/ai` release line;
everything this skill uses — `auth status --json`, `auth login`, `context` — exists from
`4.x` onward).

Compare by **major version**, not by string. The output may carry a prerelease suffix
(`4.0.0-dev.2`, `5.1.0-dev.7`) because a `@dev` channel is published, and a plain string
comparison mishandles those — `"4.0.0-dev.2" < "4.0.0"` is true, which would wrongly
reject a working dev build.

To check:

1. Take the version string from `2kw --version` (e.g. `5.1.0-dev.7`).
2. Read the leading integer before the first `.` — that is the major version.
3. Supported when the major is **4 or greater**. The `-dev.N` / `-rc.N` suffix does not
   disqualify a build whose major meets the floor.

If the major is below 4, tell the user their version and that 4.x or later is required,
and offer `npm i -g @2kw/ai@latest`.

Record the confirmed version so later 2kw skills in this session do not re-check it.

## Step 3 — Do credentials work?

```bash
2kw auth status --json
```

This already validates against the live API, so no extra verification call is needed.

Interpret the JSON:

| Output | Meaning | Action |
|---|---|---|
| `{"authenticated": true, ...}` | Working credentials | Report success with `baseUrl`, `modelCount`, and `context` if present. **Done.** |
| `{"authenticated": false}` with no `baseUrl` | No credentials configured | Go to Step 4 |
| `{"authenticated": false, "error": "Failed to validate credentials", ...}` | Credentials present but rejected | Go to Step 5 |

## Step 4 — No credentials

Run the login flow. Do not prompt for the key yourself — the CLI owns that interaction,
and it stores the result in the right place:

```bash
2kw auth login
```

This is interactive. Let the user complete it, then re-run Step 3 to confirm.

## Step 5 — Credentials present but rejected

`2kw auth status` collapses several distinct causes into one error today, so diagnose
before advising. Report which of these is most likely, based on the observable evidence:

- **Wrong or revoked key** — the stored `apiKeyPreview` does not match the key the user
  expects, or the key was rotated. Fix: `2kw auth login`.
- **Insufficient permissions for the organization** — the key is valid but lacks access.
  Fix: check the key's organization in the 2kw UI.
- **Base URL unreachable** — `baseUrl` in the output is wrong, or the host is down. Check
  it against the expected environment. `2kw context list` shows configured environments
  and `2kw context use <name>` switches between them.

Never report a generic "authentication failed". Always name the most likely cause and the
single command that fixes it.

## Where credentials live

Contexts are stored in a `conf` store, so each environment keeps its own base URL and key:

- Windows: `%APPDATA%\2kw\Config\config.json`
- Linux / macOS: `~/.config/2kw/config.json`

Resolution order is CLI flags → environment (`AI_2KW_API_KEY`, `AI_2KW_BASE_URL`) →
`.2kw` file in the working directory → the config store.

Never write credentials into these files yourself. Use `2kw auth login` and
`2kw context use`, which keep the active-context bookkeeping correct.

## Reporting

On success, one line. Include the `context` when `auth status` reports one, since a user
with several environments needs to see which org they just connected to — the `default`
and `staging` contexts point at the same dev org while production is a separate org, so
the base URL alone is not enough to tell them apart:

> Connected to 2kw at `<baseUrl>` (context `<context>`) — `<modelCount>` models available,
> CLI `<version>`.

When `auth status` reports no `context` (a single-context setup), omit that clause.

On failure, state which step failed, what was observed, and the single next command to run.
