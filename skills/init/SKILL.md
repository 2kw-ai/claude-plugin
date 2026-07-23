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
- **Command not found** → the CLI is not installed. A global install is required to
  continue:

  ```bash
  npm i -g @2kw/ai
  ```

  Then re-run `2kw --version` to confirm.

  Why a global install rather than `npx`: this skill and every other 2kw skill call the
  bare `2kw` command (`2kw auth status`, `2kw context list`, …). `npx @2kw/ai@latest` does
  not put `2kw` on PATH, so the next step would hit "command not found" again. Making the
  whole flow work through npx would mean prefixing every command with
  `npx -p @2kw/ai@latest 2kw` — the `-p` form is required because the package ships three
  bins (`2kw`, `backbone`, `bb`) and none matches the package name, so a bare
  `npx @2kw/ai` cannot reliably pick one — and each call would pay npx's resolution cost.

  A one-off `npx -p @2kw/ai@latest 2kw --version` is fine to confirm connectivity, but do
  not proceed past this step on npx alone. If the user cannot install globally, stop and
  say the 2kw skills need `2kw` on PATH.

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

`2kw auth status` returns one identical error — `"Failed to validate credentials"` — for a
wrong key, insufficient org permissions, and an unreachable host alike. It exposes no HTTP
status. So this step cannot truly diagnose the cause; it can check the one thing that *is*
observable, then offer fixes in likelihood order.

**First, check the observable — the `baseUrl` in the output:**

- If `baseUrl` is wrong or points at an unexpected environment, that is the problem. Show
  the configured environments with `2kw context list` and switch with
  `2kw context use <name>`. A host being down looks the same, so also confirm the host is
  reachable if the URL looks correct.

**If `baseUrl` looks right, the key is being rejected and the CLI cannot say why.** Offer
the two fixes in order, rather than guessing which applies:

1. `2kw auth login` — re-authenticate. This resolves a wrong, expired, or rotated key,
   which is the common case.
2. If re-authenticating does not help, the key is valid but its organization lacks access.
   Direct the user to check the key's organization in the 2kw UI.

Never report a bare "authentication failed". Name what was checked (the base URL) and give
the ordered next step.

> A precise diagnosis is not possible until the CLI surfaces the failure kind (401 / 403 /
> unreachable) — tracked in issue #256. Once it does, this step should branch on that kind
> instead of offering an ordered list.

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
