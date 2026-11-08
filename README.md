# dsh-collab

> **Unofficial community plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).**
> Not affiliated with or endorsed by DeepSeek.

**Multi-session collaboration for DSH: work orders, handoff, and file-based memory.**

When you run several AI sessions (a "command" session, a backend session, a testing session), they usually forget everything between turns, overwrite each other's notes, and nobody knows who is doing what. `dsh-collab` turns that ad-hoc chat into a small, auditable workflow:

- **Memory lives in files, not in the context window.** Each session has a card (identity), a summary (state) and dated memory notes. Switching sessions never loses the plot.
- **Writes go through tools, not free-form edits.** `wb_read` / `wb_write` validate every write (sources required, size limits, own-directory-only) and auto-refresh derived files.
- **Collaboration runs on work orders.** Dispatch → handoff → receipt, one order end to end, with a verifiable evidence chain and a board that shows where every order is.

## Features

| Area | What you get |
|---|---|
| **Work orders** | `wb_write(task)` creates one order; `flow` relays it through sessions (`handoff` next/back); non-final holders cannot close; closing returns a receipt to the owner |
| **Acceptance** | `verify` / `reject` with evidence refs; `close` refuses unreachable evidence; order metrics (per-leg duration, handoffs) |
| **Memory** | `note` writes dated memory + auto-projects `summary.md` + `INDEX.md`; size-capped and rotated; `sessions.jsonl` timeline (entry/handover/accept/end) |
| **Session lifecycle** | three states (active / archived), handover with relay seed, unbind, recycle bin, exports |
| **Board** | live dashboard (sessions, in-flight orders, event stream, learning card), order detail drawer with the full chain, dark/light theme, zh/en UI |
| **Guards** | one-order-per-task hash, refs security (no `..` traversal, size cap), write-scope warnings, stale detection with one retry, wake retries |
| **Learning** | zero-AI signal collection (failures, stale, violations, feedback), weekly report, board learning card, opt-in auto-tuning of plugin defaults only |
| **Portability** | works in DSH desktop/web profiles without any shell; `dataRoot` config; templates overridable in `<dataRoot>/shared/templates/` |

## Install

```bash
# from a release tarball
npm install -g ./dsh-workbench-core-0.1.0.tgz   # or extract into your profile
# extract to your DSH profile's node_modules, then add to cordis.patch.yml:
```

```yaml
- insert:
    - id: workbench-core
      name: dsh-workbench-core
      config:
        dataRoot: '/absolute/path/to/your/.dsh'
```

Restart DSH. Open **Settings → 会话协作 (Session Collaboration)**.

> `dataRoot` is where the plugin keeps `agents/`, `collab/`, `events/`, `_meta/` etc. It is independent from the harness install.

## Tools exposed to the agent

| Tool | Actions |
|---|---|
| `wb_read` | `check` / `scene` / `order` / `board` / `search` |
| `wb_write` | `note` / `progress` / `comment` / `task` / `submit` / `verify` / `reject` / `handoff` / `close` / `cancel` / `reopen` |

All writes are validated; every order keeps its own event trail and evidence refs.

## Concepts in 30 seconds

1. **Owner** — whoever receives a request owns it, decides which parts are theirs, and dispatches the rest as one order with a `flow`.
2. **Flow** — the relay order, e.g. `[backend, testing]`; each holder acknowledges, works, then `handoff`s to the next. Handing off wakes the next session automatically.
3. **Receipt & acceptance** — the last holder hands back to the owner; the owner verifies evidence (no re-running the whole test suite), closes, and delivers.
4. **Memory** — conclusions go to dated files; the summary/INDEX are derived, so a fresh session can pick up in seconds.

## Documentation

- `docs/` — usage manual, protocol, acceptance checklist
- `CHANGELOG.md` — public history (0.1.0 is the first public release)
- Samples and templates live under `lib/templates/` and can be overridden per installation

## Status

`0.1.0` — first public release. The plugin is functional and used daily by the author, but APIs and file formats may still change before `1.0`.

## License

MIT
