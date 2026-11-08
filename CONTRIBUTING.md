# Contributing

Thanks for taking a look at `dsh-collab`. It is a small, single-maintainer project — issues and focused pull requests are welcome.

> This is an unofficial community plugin for DeepSeek Harness (DSH). Please do not claim official affiliation in issues, docs or forks.

## Development setup

Requirements: Node.js 20+, Windows (the project is developed and tested on Windows; most suites are cross-platform but paths in tests assume Windows).

```bash
git clone https://github.com/sessionhive/dsh-collab.git
cd dsh-collab
node tests/run.mjs
```

There is no build step — `lib/` and `client/client.js` are plain ESM/JS.

## Running tests

CI runs these on `windows-latest` (Node 20 and 22):

```bash
node tests/run.mjs            # core protocol/order/memory assertions
node tests/load.mjs           # module + route loading
node tests/auto-index.mjs     # auto index behaviour
node tests/static-checks.mjs  # static invariants (i18n, tokens, no native dialogs…)
node tests/bootstrap-isolated.mjs
node tests/config-dataroot.mjs
```

The longer `tests/external-v0*.mjs` suites boot the plugin against temporary data roots and can be run individually; they are slower and are not part of CI by default.

## What to change where

| Area | Files |
|---|---|
| Host logic / tools | `lib/` (`tools/write.js`, `tools/read.js`, `runtime.js`, `collab.js`, …) |
| Client UI (settings page) | `client/client.js` |
| Board page (standalone HTML) | `lib/board-page.html` |
| UI strings | `locale/zh.json`, `locale/en.json` |
| Templates (seed / dispatch) | `lib/templates/` (override per install in `<dataRoot>/shared/templates/`) |
| Docs | `README.md` (中文), `README.en.md`, `docs/使用说明.md`, `docs/USAGE.md` |

## Guidelines

- **Keep it small.** This plugin values few concepts and few settings. A new feature should remove complexity elsewhere or be clearly worth it.
- **No hidden automation.** Anything that changes behaviour automatically must be visible, versioned and reversible. Never auto-edit user rules or the constitution.
- **Evidence first.** New write paths must require sources/refs and validate them.
- **Both languages.** Add strings to `locale/zh.json` and `locale/en.json`; missing keys fall back to Chinese.
- **Tests.** Behaviour changes need a test in `tests/` and a green run of the suites above.
- **No native dialogs.** The plugin must never use `window.confirm`/`alert` or OS dialogs.
- **Zero-AI learning only.** Learning must not call an LLM.

## Pull requests

1. Fork, branch from `main`.
2. Keep commits focused; describe *what changed and why* (with evidence/paths).
3. Update `CHANGELOG.md` under an “Unreleased” section if user-visible.
4. Ensure tests pass locally; CI must be green.

## Reporting bugs

Please include:

- Plugin version (`/plugin-info` or `package.json`)
- DSH version and profile type (desktop/web)
- What you did, what happened, what you expected
- Order ID and evidence paths if it is about collaboration
- Relevant lines from `_meta/logs/plugin.log` and `events/violations.jsonl`

## Security

Do not paste secrets, tokens or private data into issues. Redact paths if needed.

## License

By contributing you agree your changes are released under the MIT license.
