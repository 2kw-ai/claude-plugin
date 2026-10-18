# 2kw for Claude Code

Observe and debug your AI workloads on [2kw.ai](https://2kw.ai) from inside your coding
agent.

## Install

```
/plugin marketplace add 2kw-ai/claude-plugin
/plugin install 2kw@2kw
```

Then run `2kw:init` to connect your account.

## Requirements

- The 2kw CLI: `npm i -g @2kw/ai`
- A 2kw account and API key

## Skills

| Skill | What it does |
|---|---|
| `2kw:init` | Verifies the CLI is installed at a supported version and that your credentials work |
| `2kw:agents` | Runs your 2kw agents on a task (with approval pauses you decide) and creates, changes, versions and exports agents from `agent.yaml` |
| `2kw:trace-claude-code` | Exports Claude Code's OpenTelemetry traces to your 2kw org so your coding sessions show up in the trace viewer, at a capture level you choose (see below) |

### Trace capture levels

`2kw:trace-claude-code` asks which level to capture. Every level exports trace structure and
timings.

| Level | Adds |
|---|---|
| `minimal` | nothing: no prompt or tool content |
| `standard` (recommended) | your own prompts |
| `full` | your prompts and tool content, including the contents of files Claude reads |

Trace export authenticates with an API key from your active 2kw context. If you signed in
through the browser, create an API key in your organization, save it in its own context
(`2kw context create claude-code-traces --manual`) and switch to it
(`2kw context use claude-code-traces`) while you set up tracing.

## Development

This directory is mirrored from a private monorepo by release CI. **Do not open pull
requests against this repository** — changes made here are overwritten on the next
release. Please file issues instead.

## License

See repository.
