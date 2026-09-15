# agent.yaml reference

The file maps 1:1 onto an agent version. `name` is the lookup key: `apply` finds the agent by this exact name.

```yaml
# yaml-language-server: $schema=https://docs.2kw.ai/schemas/agent.v1.json
name: invoice-checker            # required, unique in the organization
description: Checks supplier invoices
model: azure/gpt-4.1             # required (or models); provider/model or a bare model id
# models: [azure/gpt-4.1, openai/gpt-4o]   # instead of model: ordered list, first = default, 1-10 unique
instructions: |
  You verify supplier invoices against purchase orders.
tools: []                        # see below
hitlPolicy: {}                   # optional, see below
skills: []                       # optional skill bindings
```

## Versions and labels

- A change to `model` or `models` (order counts), `instructions`, `tools`, `hitlPolicy`, `options` or `skills` publishes a new version and moves the `latest` label. Runs use `latest` unless a label is named (`agent@prod`). A run that paused is decided with the same label: `2kw agents decide agent@prod --response …`.
- A change to `description` alone updates the agent without a new version.
- `apply --label prod` also points `prod` at the resulting version.
- The file is the full desired state: a tool removed from the file is removed from the agent.

## Tools

The `file_search` and `backbone.*` types have no `name`; `function` tools require one.

| Type | Shape | What it does |
|---|---|---|
| `file_search` | `config: { knowledgeBaseIds: [id, …] }` (an empty list leaves the tool unused) | Searches knowledge bases (`2kw knowledge list --json` for ids) |
| `backbone.extraction` | `config: { schemaIds: [id, …], model?: id }` (an empty list leaves the tool unused) | Extracts fields with a schema (`2kw schemas list --json`) |
| `backbone.document_convert` | no config | Reads attached files as text |
| `backbone.todo` | no config | Keeps a task list while working |
| `backbone.skill` | `skills: ["name", "name@label", "name@3"]` (1–20) | Loads skills on demand (`2kw skills list --json`) |
| `function` | `name`, `endpoint` (http/https), `description?`, `parameters?` (JSON Schema), `secret?`, `annotations?` | Calls a webhook; `secret` signs the call |

Any other `type` (or none) with a `name` is a client tool: the run pauses (exit 4) for an application to answer it. Do not add one for CLI use.

Never author `backbone.tool_search`, `backbone.skill_read` or `web_search`.

`annotations: { readOnlyHint: bool, destructiveHint: bool }` — both keys required when present. They classify the call for the approval policy.

## hitlPolicy (approvals)

```yaml
hitlPolicy:
  version: 1                     # optional; must be 1
  default: approve               # allow | approve | block | deny (only tightens)
  classes:
    read: allow                  # allow | auto | approve | block | deny
    write: approve               # auto | approve | block | deny   (never allow)
    destructive: block           # block | deny                    (never allow, auto or approve)
  tools:                         # keys: exact tool names or * globs (case-sensitive); values lowercase
    "lookup_*": read             # glob → read | write | destructive (class) or approve | auto | deny (action)
    "delete_*": deny
```

`approve` pauses the run for a human (exit 3). `auto` lets the platform's auto-approver decide; until it is enabled it pauses like `approve`. `block` and `deny` refuse the call; the model is told. An `auto` rule may not match a destructive tool.

## skills (bindings)

```yaml
skills:
  - name: po-matching            # org skill name
    ref: prod                    # label or version number; default latest
```

At most 20, names unique. A name is a lowercase slug: `^[a-z0-9]+(-[a-z0-9]+)*$` (e.g. `po-matching`).

## Secrets

Write `secret: ${AGENT_UPDATE_PO_SECRET}`. `apply` resolves every `${NAME}` placeholder (uppercase letters, digits and `_`) in any string from the environment and fails listing every missing variable. `export` writes placeholders unless `--include-secrets`.

A literal `${UPPER_NAME}` in any string (instructions, descriptions, tool fields) must be written `$${UPPER_NAME}`, or `apply` treats it as a placeholder. This holds for text you write as well as exported text: `export` writes every stored `${` as `$${`; keep that escape when editing. Escape a placeholder that `apply` reported missing only when the user confirms the text is literal, and never in a `secret` field. Two function tools whose names map to the same `AGENT_<NAME>_SECRET` cannot be exported with redaction — rename one.

A resolved value is masked as `***` in `apply` output when it is used in a `secret` field, or when its placeholder name contains SECRET, TOKEN, PASSWORD, PASSWD, PASS, API_KEY/APIKEY, KEY, PRIVATE, CREDENTIAL or AUTH. Name any placeholder that carries a credential outside a `secret` field accordingly (e.g. `${ERP_API_TOKEN}` inside an endpoint URL).
