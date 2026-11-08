# dsh-collab

[![test](https://github.com/sessionhive/dsh-collab/actions/workflows/test.yml/badge.svg)](https://github.com/sessionhive/dsh-collab/actions/workflows/test.yml)

[中文说明](README.md) · **English**

> **Unofficial community plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).**
> Not affiliated with, endorsed by, or supported by DeepSeek. DSH is a trademark of its owner.

**Turn several AI sessions into a small, auditable team: work orders, handoff, and file-based memory.**

---

## The problem

Running many AI sessions in one workspace looks great until it doesn't:

- **Context loss** — switch or compact a session and it forgets what it was doing.
- **Write chaos** — sessions overwrite each other's notes; formats drift; nobody knows the source of truth.
- **Invisible work** — between "dispatched" and "done" there is nothing: no progress, no ack, no evidence, no idea who is blocked.
- **Silent stalls** — one session waits for another and nobody is woken up.

`dsh-collab` turns that chat-based coordination into an explicit, file-backed workflow.

## What it is (three pillars)

| Pillar | Meaning |
|---|---|
| **Memory lives in files, not in context** | Each session has an identity card, a summary (state), dated memory notes and an index. A fresh session can pick up in seconds. |
| **Writes go through tools** | AI sessions call `wb_read` / `wb_write` instead of editing state files directly. Every write is validated (sources required, size caps, own-directory-only) and derived files are refreshed automatically. |
| **Collaboration runs on work orders** | Dispatch → handoff → receipt. One order end to end, with per-leg timings, evidence refs and a board that shows exactly where each order is. |

---

## Features

### 1. Work orders (the core)

- **One task, one order.** Composite requests (implement + test + document) become **one** order with a `flow`; the same task hash cannot be opened twice while the first is open.
- **Daily IDs.** `dhNNN` resets every day (`collab/YYYY-MM-DD/dh001-<assignee>.md`); cross-day references use `YYYY-MM-DD/dhNNN`.
- **Relay by flow.** The owner decides which legs belong to whom. Each holder acknowledges, works and `handoff`s to the next leg; handing off wakes the next session automatically.
- **Takeover is implicit.** The next holder's first `progress` is recorded as a takeover; no extra call.
- **Guards against skipping.** A non-final holder cannot `close` — the plugin converts the attempt into a handoff and warns. Final holders hand the order back to the owner.
- **Owner acceptance.** The owner `verify`s (or `reject`s) evidence and closes; closing writes a receipt back to the owner, an auto-memory entry if the assignee forgot one, and updates the summary projection.
- **Comments, not new orders.** `comment` keeps follow-ups, blame-free notes and nudges inside the same order.
- **Evidence discipline.** `submit` / `handoff` / `verify` / `close` require refs; refs are checked for existence, readability, traversal (`..`) and size (≤ 20 MB).
- **Done index.** `collab/done-index.md` lists finished/cancelled orders grouped by date with time, ID, title, assignee, status and path.
- **Order metrics.** Per-leg start/submit/handoff/verify/close timestamps, durations, handoff count and total time are derived from events.

### 2. Memory

- **Per-session files.** `agents/<id>/card.json` (identity, mission, boundaries, skills), `summary.md` (doing / next / blockers / pointers), `memory/<date>/*.md` (conclusions with sources).
- **Automatic projection.** `wb_write(note)` appends a dated note, recomputes `summary.md` from the latest conclusion and keeps `memory/INDEX.md` as a compact timeline (≤ 120 lines, older months folded).
- **Size discipline & rotation.** Notes are capped (~2 KB per file); overflow rotates into `.detail*.md` without losing content.
- **Session timeline.** `sessions.jsonl` records `entry`, `handover`, `accept` and `end` events (ISO local time), so you can audit who took over when.
- **Handover.** Rebinding a session generates a relay summary (card + summary + recent memory + open orders), seeds the new session, and renames the old one to `name (handed over MM-DD HH:mm)`.
- **Entry seed.** Every binding (new / existing session / handover) sends a short seed: read your card + summary, check the board, no order → reply only, write back when real work happened.

### 3. Session lifecycle

- **Three states:** active (bound), pending (no session), archived (retired) — archived sessions are folded by default and kept out of the way.
- **Handover / unbind / archive / restore / recycle / export snapshot.**
- **Recycle bin** (`dataRoot/trash`) with item-level selection, right-click open, and a confirm-guarded empty action.
- **Auto-created skills.** Creating a session without picking a skill creates and binds a starter `SKILL.md`; editing skills from the settings page is supported.
- **Templates can be overridden** per installation: `<dataRoot>/shared/templates/{seed.md,dispatch.md}`.

### 4. Board

- **Live dashboard** (`/plugins/workbench-core/board`): sessions, in-flight orders, today's completions, event stream and a learning card.
- **Order panel & detail drawer:** click any order to see the full chain — flow legs, current owner, next hop, per-leg durations and an event timeline with evidence refs.
- **Session table:** doing / next / blockers / open orders per session, clickable into a summary drawer.
- **Themes:** auto / dark / light, persisted in config.
- **Languages:** Chinese / English UI, event labels, statuses and date formats (fallback to Chinese for missing keys).
- **Filters:** event type filter; historical events grouped and capped to keep the page fast.

### 5. Reliability & safety

- **Evidence security:** refs are resolved against workspace/scene cwd, traversal rejected, unreadable or oversized files rejected, violations recorded.
- **Wake reliability:** wake retries with backoff, an outbox, and degradation when the host session API is unavailable.
- **Stale detection:** if a delivered order receives no ack/progress within the window, it is marked stale, the owner is notified, and the assignee is woken once more.
- **Idempotency:** duplicate handoffs, acks and receipts are de-duplicated.
- **Schema migration:** `schemaVersion` on config/registry plus an idempotent, rollback-aware migration on startup; `manifest.json` SHA-256 verification.
- **Self-check:** `/ops/selfcheck` validates routes, data root, config, index consistency, templates, skills and version-vs-disk without depending on any shell scripts (works in standalone DSH).
- **Warnings, not silent failures:** write-scope overflow, missing required fields and invalid actions return actionable warnings and are logged to `events/violations.jsonl`.

### 6. Learning (zero-AI, opt-in tuning)

- **Signal collection** from failures only: rejections, stale orders, violations, interruptions and explicit user feedback.
- **Failure taxonomy** by rule ID first (missing evidence, over-reach, identity mismatch, handoff issues, timeouts) with keyword fallback.
- **Weekly report** (`_meta/learn/weekly.md`): rework rate, stale rate, average order time, top failure modes, adjustment ledger.
- **Board learning card:** current-version signals plus legacy signals for reference.
- **Guarded auto-tuning:** first candidates (≥ 3 samples and ≥ 30 % share), then a 7-day observation window, then injection — limited to plugin defaults, at most 3 per week, versioned and reversible. Constitution and user rules are never touched automatically.
- **Feedback button** on orders feeds the same loop.

### 7. Developer & portability

- **No shell required.** Works in standalone DSH profiles: set `config.dataRoot`, restart, done.
- **HTTP API** for everything the UI does (board data, sessions, orders, ops, selfcheck, i18n, config).
- **Templates & i18n** are data-driven, so forks can adapt wording without touching logic.
- **Tests:** 46 script suites covering protocol, board, learning, migration, external-profile acceptance.

---

## Quick start

```yaml
# cordis.patch.yml of your DSH profile
- insert:
    - id: workbench-core
      name: dsh-workbench-core
      config:
        dataRoot: '/absolute/path/to/.dsh'   # where collaboration data lives
```

```bash
# install the package into your profile's node_modules (release tarball or repo)
tar -xzf dsh-workbench-core-0.1.0.tgz --strip-components=1 -C <profile>/node_modules/dsh-workbench-core
```

Restart DSH → **Settings → 会话协作 / Session Collaboration**.

1. Create two or three sessions (e.g. *command*, *backend*, *testing*) and give them a group.
2. Send the *command* session a request like: *"implement a small Go API, have it tested, and give me the test report."*
3. Watch the order move: dispatch → ack → handoff → test → handoff → verify → done.

## Concepts in 30 seconds

1. **Owner** — whoever receives a request owns it, decides which parts are theirs, and dispatches the rest as one order with a `flow`.
2. **Flow** — e.g. `[backend, testing]`. Each leg acknowledges, works, then hands off; the next session is woken automatically.
3. **Receipt & acceptance** — the last leg hands back to the owner; the owner checks evidence (no re-running everything), closes and delivers.
4. **Memory** — conclusions land in dated files; summaries and indexes are derived. A new session reads three files and continues.

## Tools

| Tool | Actions |
|---|---|
| `wb_read` | `check` (three checks), `scene` (card + summary + memory), `order` (order + events + timeline), `board`, `search` |
| `wb_write` | `note`, `progress`, `comment`, `task`, `submit`, `verify`, `reject`, `handoff`, `close`, `cancel`, `reopen` |

## Configuration (`_meta/config.json`)

| Key | Default | Meaning |
|---|---|---|
| `dataRoot` | — | Collaboration data root (independent of the harness install) |
| `inject` | `auto` | Inject the core constitution into `AGENTS.md` (auto/on/off) |
| `seedOnCreate` | `true` | Send a seed message when creating a session |
| `enginePort` | auto | Manual override for the local engine port (board links) |
| `token.warn` / `token.context` | 60k / 120k | Context thresholds for reminders/handover |
| `notice.enabled` | `false` | Auto-nudge on overdue orders |
| `learn.autoApply` | `true` | Allow guarded auto-tuning of plugin defaults |
| `theme` / `lang` | `auto` / `zh` | Board theme and UI language |

## Data layout

```
<dataRoot>/
├─ agents/<session>/        card.json, summary.md, memory/<date>/, sessions.jsonl
├─ collab/<date>/           orders (dhNNN-*.md / .done.md / .cancelled.md), done-index.md
├─ events/                  events.jsonl, violations.jsonl, plugin.log
├─ _meta/                   config.json, registry.json, learn/, logs/
├─ shared/                  global rules, playbooks, templates overrides
├─ board/                   offline board page
├─ skills/<session>/        SKILL.md
└─ trash/                   recycle bin
```

## FAQ / troubleshooting

- **Board shows old data** → check `/ops/selfcheck`; the engine caches the module at startup, so a plugin update needs a restart.
- **Order stuck in “waiting”** → the assignee did not ack; after the stale window the owner is notified and the assignee is re-woken once.
- **`close` rejected: evidence unreachable** → fix refs (relative paths resolve against the workspace; prefer absolute paths), then retry.
- **A session was archived by the host** → bind or hand over to a fresh session from the settings page; archived sessions are frozen, not deleted.
- **External DSH has no shell scripts** → the plugin’s self-check, board and tools are self-contained; only the optional “one-click self-test” wrapper is shell-specific.

## Non-goals

- Not an official DeepSeek product.
- Does not switch sessions automatically, run background AI loops, or auto-edit the constitution/user rules.
- No vector search, no multi-user permission model, no onboarding wizard (yet).

## Roadmap

- Release 0.1.x: stability, external acceptance, docs.
- Later: richer board analytics, configurable policies, English-first docs, 1.0 freeze of file formats.

## Contributing

Issues and small PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
