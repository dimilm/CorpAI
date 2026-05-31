# ADR 0003: Run concurrency contract (market vs. jobs vs. AI)

Status: Accepted

## Context

Three kinds of long-running background work share the same `RunLog` machinery and
the in-process `RefreshWorker` thread, but they must not interfere with each other.
The rules were implicit in the code (lock names, lack of locks); this ADR makes the
contract explicit so future features reuse it correctly.

## Decision

- **Market refresh and Jobs scrape run in parallel.** Each owns a distinct
  `JobLock` domain — `daily_market_refresh` vs. `daily_jobs_refresh` — so acquiring
  one never blocks the other. A second run of the *same* type is rejected while one
  is in flight (the lock is held), which is why the UI disables the trigger buttons
  during an active run of that type.
- **Within a type, runs are serial.** The conditional-`UPDATE` lock acquisition in
  `lock_manager` is atomic under SQLite isolation, so only one market (or one jobs)
  run exists at a time. A heartbeat (renewed each item, 5-minute TTL) lets startup
  recovery reclaim a lock orphaned by a crash.
- **AI batch runs are serial and lock-free.** They execute on the in-process
  background-task path and rely on in-process coordination rather than a `JobLock`;
  each run is still bracketed by a `RunLog` (`run_type='ai'`) so the same progress UI
  applies.
- **Crash recovery on startup** finalizes anything left dangling:
  `recover_stale_locks` (market), `recover_stale_jobs_locks` (jobs), and
  `recover_dangling_ai_runs` (AI) — the last now backed by the `ix_ai_runs_status`
  index (migration 0006) so the status scan is cheap.

## Consequences

- New long-running features should pick a **fresh lock-name domain** if they must run
  alongside the existing pipelines, or reuse an existing one to be mutually exclusive
  with it — never share a lock name by accident.
- The serial-within-type guarantee depends on single-process operation; see
  [ADR 0001](0001-single-process-backend.md). Under horizontal scaling the SQLite
  lock would need to move to shared infrastructure.
- The `RunLog.stocks_*` counters are reused across types (for jobs they count
  *sources*, not stocks) — see [ADR 0002](0002-jobs-pipeline-integration.md).
