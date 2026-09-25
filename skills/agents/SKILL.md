---
name: agents
description: This skill should be used when the user asks to use, run, call, ask or delegate to a 2kw or Backbone agent ("use backbone agent X to do Y", "ask the invoice agent to…", "let agent X handle…", "run my 2kw agent"), or to create, configure, change, version, label or export a 2kw agent ("create an agent that…", "give agent X access to knowledge base K", "change the instructions of agent X"). Also use when a `2kw agents` command exits with code 3, 4 or 5.
---

# 2kw:agents

Runs and configures agents on 2kw through the `2kw` CLI. Pass `--json` to `run`, `decide` and `apply` and branch on the exit code — never parse text output. `init` and `export` write `agent.yaml`: run them without `--json` (`export --json` writes JSON instead of YAML).

Never pass `--json` to `2kw agents list`, `2kw agents get` or `2kw agents versions …`: depending on the CLI version their JSON carries every tool's webhook secret in plaintext.

## Before anything

```bash
2kw auth status --json
```

It prints one JSON object on stdout:

- `"authenticated": true` → continue.
- `"authenticated": false` without a `failureKind` (no credentials configured), `"failureKind": "UNAUTHORIZED"`, or `"error": "session_expired"` in JSON on stderr → use the `2kw:init` skill, then retry. Never ask the user for an API key yourself.
- `"failureKind": "FORBIDDEN"` → do not use `2kw:init`. Tell the user their organization role lacks access to this.
- `"failureKind": "UNREACHABLE"` → tell the user the API at `baseUrl` cannot be reached. Stop.
- Command not found → use the `2kw:init` skill.

## Pick the agent

When the user names an agent, run it by that name directly (see Run). A label can follow the name: `invoice-checker@prod` (default `latest`). Never guess a name.

- If the run fails with a message like `Agent not found: invoice. Did you mean: invoice-checker, invoice-archiver`, show those names and ask which one. Do not pick one yourself.
- When the user gives no name, list candidates as a table — never with `--json`: `2kw agents list --search <term>` (or `2kw agents list --size 100` without a term). The table shows each agent's id, name and models. Show the names and ask which one.
- If a `2kw agents run` call fails with `unknown command`, the installed CLI is too old: tell the user to upgrade it with `npm i -g @2kw/ai`. Stop.

## Run

Write the user's task to a temporary file (avoids shell-quoting problems with quotes, `$` and backticks), then:

```bash
2kw agents run <agent> --input-file <task-file> --json
```

To continue the same thread later, add `--conversation <conversationId>` from the previous result.

The result is a run envelope: `status`, `mode`, `text`, `responseId`, `conversationId`, `toolCalls`, `pendingApprovals`, `pendingToolCalls`, `incompleteReason`, `next`.

### Conversation mode

Add `--mode plan` when the user asks the agent to look without changing anything, and `--mode ask` when the user wants to approve every call that needs approval themselves. Pass `--mode auto` only when the user names it. Never pick a mode on your own: without `--mode` the conversation keeps the mode it has. The mode is stored on the conversation, so it also applies to later runs with `--conversation` and to `decide`.

## Branch on the exit code

| Exit | Meaning | Do |
|---|---|---|
| 0 | completed | Give the user `text`. Mention the tools it used (`toolCalls`) in one line, and the mode it ran under when `mode` is not `null`. |
| 3 | paused for approval | Show each entry of `pendingApprovals`: `tool`, `policyClass`, `arguments`, and `reason` when present (why the request was escalated to a human). Ask the user to approve or reject each one. Then run `decide` (below). Never decide for the user. |
| 4 | needs client tool output | Tell the user the agent wants a tool that runs in a client application (`pendingToolCalls`), which the CLI cannot provide. Stop. |
| 5 | incomplete | Tell the user the run stopped early (`incompleteReason`, usually the tool-iteration limit) and show `text` so far. Offer to continue with `--conversation`. |
| 2 | usage or config error | Show the error line, fix the command or file, retry once. Not for `Missing environment variables` or `… both map to AGENT_…_SECRET` (follow the secret rules below), and not for `No pending approvals` (see Decide approvals). |
| 1 | API or network error | Show `message` from the JSON error on stderr. `status` 401 or `"error": "session_expired"` → use `2kw:init`, then retry; `status` 403 → tell the user their role lacks access (not `2kw:init`). A plain `error: unknown option …` or `error: required option …` line is a mistyped command: fix it and retry once. |

## Decide approvals

Every pending approval of a paused response must be decided in the same call. Ids are the `approvalId` values from `pendingApprovals`. Pass the agent exactly as the run did, with the same `@label` and `#model` (`invoice-checker@prod#gpt-5.1` if the run used `invoice-checker@prod --model gpt-5.1`); the envelope's `next` already has both. A different label continues on another version of the agent; a missing `#model` continues on the agent's default model.

```bash
2kw agents decide <agent>[@label][#model] --response <responseId> --approve-all --json
2kw agents decide <agent>[@label][#model] --response <responseId> --reject-all --reason "<user's reason>" --json
2kw agents decide <agent>[@label][#model] --response <responseId> --approve <approvalId> --reject <approvalId> --reason "<reason>" --json
```

- `--reason` is recorded on every decision in the call, approvals included. Tell the user when they give a reason for a rejection and approve something in the same call.
- `--remember` is sent only on the calls this `decide` approves: `--approve A --reject B --remember` remembers only A's tool. Use it only when the user wants to stop being asked for the approved tools in this conversation; otherwise leave it off. It is refused when an approved call is destructive.
- If `decide` fails with `code` `approval_hmac_mismatch`, `unknown_approval_id` or `invalid_approval_decision`, or with `No pending approvals`, do not retry it. See what is still open with `2kw agents approvals --agent <agent id> --status pending --json` (the agent's `id` from the `2kw agents list --search <name>` table, not its name).
- If `decide` fails with `code` `conversation_in_plan_mode`, the conversation is in plan mode, which refuses approving a call that could change something; the run is still paused. Tell the user and ask whether to leave plan mode. Only on their yes, run the same `decide` again with `--mode ask` added. Never add `--mode` to a `decide` on your own, and approving a call is not a yes to leaving plan mode.

The result is a new run envelope — branch on its exit code again; it can pause again.

## Configure an agent

Configuration lives in `agent.yaml`. Read `references/agent-yaml.md` before writing one.

New agent:

```bash
2kw agents init <name> -o agent.yaml
```

Fill in `description`, `model` (`2kw ai models --json` lists ids), `instructions` and the tools the user asked for. Then:

```bash
2kw agents apply -f agent.yaml --dry-run --json
```

Show the user the planned `action` and `changes`. Apply only after they agree:

```bash
2kw agents apply -f agent.yaml --json
```

Existing agent:

```bash
2kw agents export <agent> -o agent.yaml
```

`init` and `export` refuse to overwrite an existing file; add `--force` only when the user agrees to replace it. Edit the file, then `--dry-run`, confirm, `apply` as above. Use `--label prod` only when the user asks to promote (`--label latest` is refused: `latest` moves by itself).

Rules:
- `apply` is idempotent: `unchanged` means the agent already matches the file.
- Validation errors (exit 2) list JSON pointers such as `/tools/0/config/knowledgeBaseIds` — fix exactly those keys. `2kw agents schema` prints the full schema.
- An agent with several models exports as `models` (an ordered list, first = default). Keep the list as it is unless the user asks to change the models.

## Secrets

- Never write a webhook secret into the file. Use `${ENV_NAME}` and tell the user which variable to set.
- After `export`, relay the variable names it prints on stderr (`Secrets replaced by placeholders; set before apply: …`).
- Never pass `--include-secrets`. If `export` reports two tools that map to the same variable, tell the user to rename one of the tools instead.
- `apply` (also `--dry-run`) fails with `Missing environment variables: …` until every placeholder is set. Never delete or replace a `${…}` placeholder to get past it. One exception: when a reported name is literal text in `instructions` or a `description` (the agent should read `${ORDER_ID}` as written) and the user confirms that, write it as `$${ORDER_ID}`. Never do this in a `secret` field.
- Never ask the user for a secret value in chat, and never put one on a command line.
- The variables must be set in the environment Claude Code was started from. If they are not, the user runs `2kw agents apply -f agent.yaml --dry-run` in their own terminal first, then the same command without `--dry-run` (adding `--label <name>` if they asked to promote).
