# Usage Guide (dsh-collab / @sessionhive/dsh-collab 0.1.0)

> Full manual for users: install → first setup → daily collaboration → board/settings → memory & learning → upgrade & troubleshooting.
> Chinese version: [使用说明.md](使用说明.md) · Main README: [../README.en.md](../README.en.md)

---

## 0. One sentence

Make several AI sessions behave like a small team: **dispatch an order → relay it → get a receipt and acceptance**, while memory lives in files so switching sessions never loses context.

## 1. Five concepts

| Term | Meaning |
|---|---|
| **Session** | One AI window; each is bound to a session profile (card/summary/memory). |
| **Owner** | Whoever receives a request owns it: decides which parts are theirs, dispatches the rest, accepts and delivers. |
| **Order** | `dhNNN` — one order per task, recording dispatch/progress/handoff/acceptance/final state. |
| **Flow** | Ordered relay legs, e.g. `[backend, testing]`; handing off wakes the next leg automatically. |
| **Handoff** | Current holder passes the order to the next leg (or sends it back); the last leg returns it to the owner. |

Three fixed actions: **dispatch** (create + wake first leg), **handoff**, **receipt** (last leg returns; owner accepts and closes).

## 2. Install

### 2.1 Standalone DSH (desktop/web)

1. Extract the package into your profile's `node_modules`:
   ```bash
   tar -xzf @sessionhive/dsh-collab-0.1.0.tgz --strip-components=1 \
     -C <DSH_HOME>/profiles/<profile>/node_modules/@sessionhive/dsh-collab
   ```
2. Add an `insert` entry to that profile's `cordis.patch.yml`:
   ```yaml
   - insert:
       - id: workbench-core
         name: '@sessionhive/dsh-collab'
         config:
           dataRoot: '/absolute/path/to/.dsh'
   ```
3. **Restart DSH** (the plugin loads at engine start).
4. Open Settings → Session Collaboration; the three tabs mean it works.

> No shell required: the plugin creates its data root, indexes, and built-in board on its own.

### 2.2 Coexistence

Multiple DSH instances can share the plugin source; give each its own `dataRoot` so data never mixes.

### 2.3 Self-check

Settings → Other → **One-click self-check** (self-contained; works in standalone DSH). Failures explain themselves; logs live in `_meta/logs/plugin.log`.

## 3. First setup

1. **Create sessions**: Settings → Session Collaboration → `+ New session`. Fill id (lowercase, e.g. `backend`), name, session (create or pick), workspace, optional group and skills.
2. **Create a group** (optional), e.g. "collab dev".
3. **Open the board**: Settings → Other → Open board, or `http://127.0.0.1:<port>/plugins/workbench-core/board`.
4. **Theme/language**: top-right `☀/🌙` and `中/EN`; choices persist.

### 3.1 The identity triplet

```
<dataRoot>/agents/<session>/
├─ card.json      identity / mission / boundaries / skills
├─ summary.md     doing / next / blockers / pointers
└─ memory/        dated conclusions with sources
```
On bind, the session receives a **seed**: read card + summary + board; reply only when there is no order; write back only after real work.

## 4. Daily collaboration (full example)

**Scenario**: command → backend → testing

1. **Ask the command session**: *"Write a small Go HTTP API, test it, and give me the test report."*
2. **The command session judges ownership**: implementation → backend, testing → testing, dispatch/acceptance → itself. It does **not** implement.
   It creates **one** order: `wb_write(task)` with `flow=[backend, testing]` and `write_scopes`.
3. **Backend**: auto-ack → implement + self-test → `submit` → `handoff` to testing (testing is woken).
4. **Testing**: auto-ack → independent verification → evidence → `handoff` back to command (no close).
5. **Command**: checks evidence (does not re-run everything) → `verify` → `close done` → reports to you.

On the board you will see one order, a relay card per leg, per-leg durations, and evidence paths.

### 4.1 Single-session use

A single session can be owner and implementer: skip flow, work directly, `note` the result, close. File memory and order discipline still pay off.

### 4.2 When it gets stuck

| Symptom | Action |
|---|---|
| Order stuck at "delivered" | Assignee never acknowledged; the owner is notified after the stale window and the assignee is woken once more |
| Assignee misunderstood | Owner adds a `comment` on the same order (do not open a new one) |
| Wrong direction | `reject` or `handoff back` |
| Session archived by host | Re-bind or hand over from the settings page (relay summary + seed) |

## 5. Tools (used by the AI)

### wb_read

| action | Purpose |
|---|---|
| `check` | three checks (data root / index / config summary) |
| `scene` | a session's card + summary + recent memory |
| `order` | an order + events + timeline + metrics |
| `board` | dashboard data |
| `search` | lightweight search (query/scope/since/limit), no vector index |

### wb_write

| action | Key params | Validation |
|---|---|---|
| `note` | text, refs | refs required, ≤2KB, own directory only |
| `progress` | orderId, text | order open; first one auto-acks |
| `comment` | orderId, text | any party, same order |
| `task` | to, task, flow/collaborators, loc, accept, forbid, write_scopes | duplicate open task hash rejected; missing fields warn |
| `submit` | orderId, note, refs | refs required |
| `verify`/`reject` | orderId, note, refs | owner only |
| `handoff` | orderId, to, kind(next/back), note, refs | target in flow or owner; non-final cannot close; duplicates deduped |
| `close` | orderId, status, note, refs | evidence reachable; done auto-writes memory |
| `cancel`/`reopen` | orderId, note | permission |

> Rules of thumb: **ack first** (one `progress` line); **hand off when there is a next leg**; **return to the owner** at the end; **never sleep/poll on another session**.

## 6. Board

| Area | Content |
|---|---|
| KPI | sessions / in-flight / done today / events+violations / 7-day rework rate / average order time / stale rate |
| Sessions | name, doing, next, blockers, open orders; click for summary drawer |
| In flight | order cards with flow step bar (done/current/todo) |
| Orders | recent orders (filterable); click for the **detail drawer** |
| Detail drawer | status/owner/total time; per-leg cards (action/time/duration/evidence); event timeline; open file / copy path |
| Events | Chinese labels (dispatch/delivered/ack/progress/submit/handoff/verify/close/comment/receipt) + filter |
| Learning | current-version signals / legacy (reference only) / adjustment ledger |
| Blackboard & rules | read-only |

## 7. Settings

| Tab | Content |
|---|---|
| Global rules | user-editable rules (built-in constitution is internal and hidden) |
| Session collaboration | session cards (edit/handover/unbind/archive/⋮), groups, search |
| Other | preflight, engine port, ops (self-check/board/event log), budget, auto-nudge, auto-index, cleanup |

> Conservative defaults: **token reminders and auto-nudge are off**; learning auto-apply is on (plugin defaults only, reversible).

## 8. Templates

| Template | Override location |
|---|---|
| Entry seed | `<dataRoot>/shared/templates/seed.md` |
| Dispatch doc | `<dataRoot>/shared/templates/dispatch.md` |
| Handover/takeover headings | generated by the plugin |

Changes apply on next use; no restart needed.

## 9. Memory, index and timeline

- Conclusions: `agents/<id>/memory/<date>/note.md` (≤2KB; overflow rotates to `note.detail.md`)
- Order memory: `memory/<date>/dhNNN.md`
- Index: `memory/INDEX.md` (timeline, ≤120 lines, older months folded)
- Session events: `sessions.jsonl` (entry/handover/accept/end)
- Order index: `collab/done-index.md`
- Rule: a session writes only its own `agents/` directory; cross-session writes go to orders/blackboard.

## 10. Learning

- Signals: failures/timeouts/violations/interruptions/feedback → `_meta/learn/signals.jsonl`
- Classification: missing evidence / over-reach / identity / handoff / timeout / environment
- Weekly report: `_meta/learn/weekly.md` (rework rate, stale rate, average order time, top modes)
- Auto-tuning: candidate (≥3 samples, ≥30%) → 7-day observation → inject; ≤3/week; versioned and reversible; **never touches the constitution**
- Disable: `config.learn.autoApply=false`

## 11. Upgrade / backup / rollback

1. Back up the whole `dataRoot` and the plugin directory
2. Upgrade: replace `node_modules/@sessionhive/dsh-collab` → **restart** → self-check
3. Rollback: restore the previous tarball; schema migrations are not guaranteed to downgrade (back up first)
4. Version truth: `/plugin-info` shows loaded vs on-disk version

## 12. Troubleshooting

| Symptom | Check |
|---|---|
| No session-collaboration UI | plugin not loaded: cordis insert, restart, `/plugin-info` |
| Board blank/stale | engine port changed? reopen via "Open board"; restart to load new code |
| Handover fails: no workspace | pick a workspace or set `config.defaultCwd` |
| close rejected: evidence unreachable | fix refs (prefer absolute paths) |
| Archived session cannot be woken | by design: re-bind or hand over |
| No one-click self-check output in standalone DSH | use the internal self-check (`/ops/selfcheck`) |

## 13. Boundaries & privacy

- Only paths are referenced; secrets/accounts/private content never enter memory
- All data stays in `dataRoot`; no telemetry
- Read-only for other sessions' memory; cross-session writes go through orders/blackboard

## 14. Non-goals

Automatic session rotation, background AI loops, vector search, multi-user permissions, onboarding wizard, auto-editing constitution/user rules.
