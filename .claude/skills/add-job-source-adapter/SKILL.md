---
name: add-job-source-adapter
description: Add a new Jobs-pipeline adapter that scrapes/counts open positions from a career portal. Use when the user asks to "add a job source/adapter", "support <ATS/career site> open positions", "scrape jobs from <vendor>", or to add a new way of extracting the open-position count for a stock. See ADR 0002.
---

# Add a Jobs-pipeline adapter

Job adapters live in `backend/app/providers/jobs/` and each one knows how to read the
**open-position count** for a configured job source (a career portal / ATS). The Jobs
pipeline runs as its own `RunLog` (`run_type='jobs'`) with its own lock domain
(`daily_jobs_refresh`), alongside the market refresh. See ADR 0002
(`docs/adr/0002-jobs-pipeline-integration.md`).

## The contract (`backend/app/providers/jobs/base.py`)

Subclass `BaseJobAdapter` and implement the one method:

```python
async def fetch_job_count(self, source: JobSource) -> tuple[int, dict[str, Any]]:
    # return (count, raw_meta)
```

Read configuration from `source.adapter_settings` (a JSON dict) and
`source.portal_url`. Raise `AdapterError` on missing/invalid settings; you may let a
networking exception propagate unchanged so the `jobs_service` retry layer can decide
whether to retry. Still skim the closest existing adapter and copy its shape.

## Pick the closest existing adapter to clone

HTTP (default install, no extra deps):

- `static_html.py`, `static_text_regex.py` — fetch a page, count via selector/regex
- `json_get_array_count.py` — GET a JSON endpoint, count an array
- `json_get_path_int.py` — GET JSON, read an integer at a path
- `json_post_path_int.py`, `json_post_facet_sum.py` — POST (search/facet) APIs

Playwright (need the optional extra — for JS-rendered portals):

- `playwright_api_fetch.py`, `playwright_css_count.py`, `playwright_text_regex.py`
- `playwright_pool.py` — shared browser pool; reuse it, don't launch your own browser

Most ATS portals (Greenhouse, Lever, Ashby, SmartRecruiters, Workday JSON) are an HTTP
adapter. Reach for Playwright only when the count is rendered client-side and no JSON
endpoint exists.

## Steps

1. **Create `backend/app/providers/jobs/<name>.py`** by cloning the closest adapter
   above; keep its `AdapterError` config validation (a failing source must not crash
   the run — it records a failed status for that source).
2. **Document the settings** in the module docstring (every adapter lists its
   `adapter_settings` keys — `endpoint`, `value_path`, `count_selector`, etc.); this
   is what an operator fills into the job source.
3. **Register it** in `backend/app/providers/jobs/__init__.py`: import the class and
   add a `"<adapter_type>": YourAdapter` entry to `ADAPTER_REGISTRY` (and to
   `__all__`). For a **Playwright** adapter, put the import + registry insertion inside
   the existing `try/except ImportError` block **and** add the name to
   `PLAYWRIGHT_ADAPTER_NAMES`, so a backend without Chromium surfaces a precise
   "extra not installed" error instead of "unknown adapter_type".
4. **Playwright only:** the adapter requires the optional extra —
   `pip install -e ".[playwright]" && python -m playwright install chromium`.
   Reuse `playwright_pool` for the browser; never spin up a per-call browser.
5. **Test** — add cases to `backend/tests/test_job_adapters.py` (HTTP adapters) or
   `backend/tests/test_playwright_adapters.py` (Playwright). The HTTP suite mocks the
   network with `httpx.MockTransport` via the `patch_httpx` fixture (no `respx`, no
   live portals, no `backend/data/sqlite.db`); give each adapter a happy path and a
   config-error path (`pytest.raises(AdapterError)`).
6. **Gate** from `backend/`: `pytest -k job` then the full `pytest`.

## Gotchas

- **Counters mean job *sources*, not stocks.** For a jobs run the `RunLog.stocks_*`
  counters represent the number of *job sources* processed — keep that semantics when
  reporting per-source progress (CLAUDE.md / ADR 0002).
- A single source failing (HTTP error, layout change, timeout) must degrade to a
  failed status for that source, not abort the whole jobs run.
- Default install stays slim on purpose — only the Playwright adapters pull the heavy
  extra. Don't add Playwright imports to a non-Playwright adapter.
- The shared run-progress UI already covers jobs — surface progress through the
  existing `RunLog`/polling machinery, don't build a new one.
