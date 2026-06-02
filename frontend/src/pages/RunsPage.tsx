import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import { FilterPills, FilterPillOption } from "../components/FilterPills";
import { Modal } from "../components/Modal";
import { RunSummaryItem } from "../components/RunSummaryItem";
import { Spinner } from "../components/Spinner";
import { StatusBadge } from "../components/StatusBadge";
import { StockSelectList } from "../components/StockSelectList";
import { RunStocksMobileList } from "../components/runs/RunStocksMobileList";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useIsMobile } from "../hooks/useBreakpoint";
import {
  STOCKS_LIST_KEY,
  useCancelRefreshAll,
  useTriggerRefreshAll,
} from "../hooks/useStockMutations";
import { extractApiError } from "../lib/apiError";
import { formatDateTime, formatDuration } from "../lib/format";
import { toast } from "../lib/toast";
import {
  liveRunSeconds,
  liveStockSeconds,
  nextPollInterval,
  phaseLabel,
  runStatusLabel,
  useCurrentRun,
} from "../lib/runProgress";
import type { Stock } from "../types";
import {
  RunStep,
  RunStockStatus,
  RunSummary,
  StepStatus,
} from "../types/run";

type StockFilter = "all" | StepStatus;

const STEP_LABELS: Record<keyof Pick<RunStockStatus, "symbol" | "quote" | "metrics">, string> = {
  symbol: "Symbol",
  quote: "Kurs",
  metrics: "Kennzahlen",
};

function StepCell({ step, label }: { step: RunStep; label: string }) {
  return (
    <div className="run-step-cell" title={step.error ?? undefined}>
      <span className="run-step-label">{label}</span>
      <StatusBadge status={step.status as StepStatus} />
      {step.error && <span className="run-step-error">{step.error}</span>}
    </div>
  );
}

function formatStockDuration(s: RunStockStatus): string {
  return formatDuration(liveStockSeconds(s));
}

export function RunsPage() {
  useDocumentTitle("Marktdaten");
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const triggerRefresh = useTriggerRefreshAll();
  const cancelRefresh = useCancelRefreshAll();

  const startRefresh = () =>
    triggerRefresh.mutate(undefined, {
      onError: (err) =>
        toast.error(extractApiError(err, "Refresh-All konnte nicht gestartet werden.")),
    });
  const stopRefresh = () =>
    cancelRefresh.mutate(undefined, {
      onSuccess: (res) => {
        if (res?.cancelled) toast.success("Lauf wird abgebrochen.");
        else toast.info(res?.reason ?? "Lauf konnte nicht abgebrochen werden.");
      },
      onError: (err) =>
        toast.error(extractApiError(err, "Abbruch fehlgeschlagen.")),
    });
  const [showHistory, setShowHistory] = useState(false);
  const [filter, setFilter] = useState<StockFilter>("all");

  // Subset refresh: pick specific stocks to reload instead of the whole list.
  const [subsetOpen, setSubsetOpen] = useState(false);
  const [subsetSel, setSubsetSel] = useState<Set<string>>(new Set());

  const { data: current, isLoading: isLoadingCurrent } = useCurrentRun();
  const runId = current?.id ?? null;
  const isRunning = current?.phase !== "finished" && current != null;

  // Full watchlist, loaded only while the subset picker is open.
  const allStocksQuery = useQuery<Stock[]>({
    queryKey: STOCKS_LIST_KEY,
    queryFn: async () => (await api.get("/stocks")).data as Stock[],
    enabled: subsetOpen,
    staleTime: 60_000,
  });

  const startSubsetRefresh = () =>
    triggerRefresh.mutate(Array.from(subsetSel), {
      onSuccess: () => {
        setSubsetOpen(false);
        setSubsetSel(new Set());
      },
      onError: (err) =>
        toast.error(extractApiError(err, "Aktualisierung konnte nicht gestartet werden.")),
    });

  // Per-stock query owns its own backoff counter; the previous shared tickRef
  // entangled with the inline summary query, which we now get from the shared
  // useCurrentRun() hook.
  const stocksTickRef = useRef(0);
  const stocksQuery = useQuery<RunStockStatus[]>({
    queryKey: ["run-stocks", runId],
    queryFn: async () =>
      runId == null ? [] : (await api.get(`/run-logs/${runId}/stocks`)).data,
    enabled: runId != null,
    refetchInterval: () => {
      if (!isRunning) {
        stocksTickRef.current = 0;
        return false;
      }
      const next = nextPollInterval(stocksTickRef.current);
      stocksTickRef.current += 1;
      return next;
    },
    placeholderData: keepPreviousData,
  });

  const [historyType, setHistoryType] = useState<"all" | "market" | "jobs">("market");
  const historyQuery = useQuery<RunSummary[]>({
    queryKey: ["run-logs", historyType],
    queryFn: async () => {
      const params = historyType === "all" ? {} : { run_type: historyType };
      return (await api.get("/run-logs", { params })).data;
    },
    enabled: showHistory,
  });

  const lastPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!current) return;
    if (lastPhaseRef.current !== "finished" && current.phase === "finished") {
      queryClient.invalidateQueries({ queryKey: ["stocks"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // The per-stock backoff stops the moment phase=finished, so the last
      // poll usually still shows steps as `running`/`not_started`. Force a
      // final refetch so the UI matches what a manual reload would show.
      queryClient.invalidateQueries({ queryKey: ["run-stocks", current.id] });
    }
    lastPhaseRef.current = current.phase;
  }, [current?.phase, current, queryClient]);

  const stocks = useMemo(() => stocksQuery.data ?? [], [stocksQuery.data]);
  const counters = useMemo(() => {
    const c: Record<StepStatus, number> = {
      not_started: 0,
      running: 0,
      done: 0,
      error: 0,
      cancelled: 0,
    };
    for (const s of stocks) c[s.overall_status as StepStatus] = (c[s.overall_status as StepStatus] ?? 0) + 1;
    return c;
  }, [stocks]);

  const filteredStocks = useMemo(() => {
    if (filter === "all") return stocks;
    return stocks.filter((s) => s.overall_status === filter);
  }, [stocks, filter]);

  const filterOptions: FilterPillOption<StockFilter>[] = [
    { value: "all", label: "Alle", count: stocks.length },
    { value: "running", label: "Läuft", count: counters.running, accent: "running" },
    { value: "done", label: "Fertig", count: counters.done, accent: "done" },
    { value: "error", label: "Fehler", count: counters.error, accent: "error" },
    { value: "not_started", label: "Wartet", count: counters.not_started, accent: "not_started" },
    {
      value: "cancelled",
      label: "Abgebrochen",
      count: counters.cancelled,
      accent: "cancelled",
      hidden: counters.cancelled === 0,
    },
  ];

  // Shared across all three render branches so the subset picker is reachable
  // whether or not a run exists.
  const subsetButton = (
    <button
      type="button"
      className="btn-secondary"
      onClick={() => setSubsetOpen(true)}
      disabled={isRunning || triggerRefresh.isPending}
      title={isRunning ? "Es läuft bereits ein Update" : "Bestimmte Aktien aktualisieren"}
    >
      Auswahl aktualisieren…
    </button>
  );

  const subsetModal = (
    <Modal
      open={subsetOpen}
      onClose={() => setSubsetOpen(false)}
      title="Auswahl aktualisieren"
      subtitle="Wähle die Aktien, die neu geladen werden sollen."
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setSubsetOpen(false)}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={subsetSel.size === 0 || triggerRefresh.isPending}
            onClick={startSubsetRefresh}
          >
            {subsetSel.size > 0 ? `${subsetSel.size} aktualisieren` : "Aktualisieren"}
          </button>
        </>
      }
    >
      {allStocksQuery.isLoading ? (
        <Spinner label="Lade Unternehmen…" />
      ) : (
        <StockSelectList
          stocks={allStocksQuery.data ?? []}
          selectedIsins={subsetSel}
          onChange={setSubsetSel}
          title={null}
          maxListHeight="50vh"
        />
      )}
    </Modal>
  );

  if (isLoadingCurrent && !current) {
    return (
      <div className="page">
        <Spinner label="Lade Laufstatus…" />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="page">
        <header className="page-header">
          <div className="page-header-title">
            <h2>Marktdaten</h2>
          </div>
          <div className="page-header-actions">
            {subsetButton}
            <button
              type="button"
              className="btn-primary"
              onClick={() => startRefresh()}
              disabled={triggerRefresh.isPending}
            >
              Jetzt aktualisieren
            </button>
          </div>
        </header>
        <p>Es wurde noch kein Lauf gestartet.</p>
        {subsetModal}
      </div>
    );
  }

  // Single-stock refreshes share the same RunLog plumbing as the bulk job, but
  // their progress belongs on the stock detail page – here we only point at it
  // so this view stays focused on the bulk pipeline.
  if (current.stocks_total === 1) {
    const singleStock = stocks[0];
    return (
      <div className="page">
        <header className="page-header">
          <div className="page-header-title">
            <h2>Marktdaten</h2>
          </div>
          <div className="page-header-actions">
            {subsetButton}
            <button
              type="button"
              className="btn-primary"
              onClick={() => startRefresh()}
              disabled={isRunning || triggerRefresh.isPending}
              title={isRunning ? "Es läuft bereits ein Update" : "Jetzt aktualisieren"}
            >
              {isRunning ? "Läuft…" : "Jetzt aktualisieren"}
            </button>
          </div>
        </header>
        <p>
          {isRunning ? "Aktuell läuft ein Einzel-Refresh" : "Letzter Lauf war ein Einzel-Refresh"}
          {singleStock ? (
            <>
              {" für "}
              <Link to={`/stocks/${singleStock.isin}`} className="breadcrumb-link">
                {singleStock.stock_name || singleStock.isin}
              </Link>
              {". Fortschritt und Ergebnis stehen auf der Detailseite."}
            </>
          ) : (
            ". Fortschritt und Ergebnis stehen auf der Detailseite des Unternehmens."
          )}
        </p>
        {subsetModal}
      </div>
    );
  }

  const total = current.stocks_total || 0;
  const done = current.stocks_done || 0;
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header-title">
          <h2>
            Marktdaten
            <span className="muted-count">
              {" "}
              · Run #{current.id} · {phaseLabel(current.phase)}
            </span>
          </h2>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "Verlauf ausblenden" : "Verlauf anzeigen"}
          </button>
          {subsetButton}
          {isRunning && (
            <button
              type="button"
              className="btn-danger"
              onClick={() => stopRefresh()}
              disabled={cancelRefresh.isPending}
              title="Den laufenden Update-Job abbrechen"
            >
              {cancelRefresh.isPending ? "Wird abgebrochen…" : "Lauf abbrechen"}
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={() => startRefresh()}
            disabled={isRunning || triggerRefresh.isPending}
            title={isRunning ? "Es läuft bereits ein Update" : "Jetzt aktualisieren"}
          >
            {isRunning ? "Läuft…" : "Jetzt aktualisieren"}
          </button>
        </div>
      </header>

      <div className="run-summary-card">
        <div className="run-summary-grid">
          <RunSummaryItem label="Phase" value={phaseLabel(current.phase)} accent={current.phase} />
          <RunSummaryItem label="Status" value={runStatusLabel(current.status)} accent={current.status} />
          <RunSummaryItem label="Start" value={formatDateTime(current.started_at)} />
          <RunSummaryItem
            label={current.phase === "finished" ? "Ende" : "Bisher"}
            value={
              current.phase === "finished"
                ? formatDateTime(current.finished_at)
                : formatDuration(liveRunSeconds(current), { dashOnZero: false })
            }
          />
          <RunSummaryItem label="Fortschritt" value={`${done} / ${total}`} sub={`${progressPct} %`} />
          <RunSummaryItem label="Erfolge" value={String(current.stocks_success)} accent="done" />
          <RunSummaryItem
            label="Fehler"
            value={String(current.stocks_error)}
            accent={current.stocks_error ? "error" : undefined}
          />
        </div>
        <div className="run-progress-bar" aria-label={`${progressPct} %`}>
          <div className="run-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        {current.error_details && (
          <details className="run-error-details">
            <summary>Fehler-Details ({current.stocks_error})</summary>
            <pre>{current.error_details}</pre>
          </details>
        )}
      </div>

      <FilterPills
        value={filter}
        onChange={setFilter}
        options={filterOptions}
        ariaLabel="Status filtern"
      />

      {isMobile ? (
        <RunStocksMobileList stocks={filteredStocks} />
      ) : (
        <div className="run-table-wrapper">
        {filteredStocks.length === 0 ? (
          <p className="run-empty">Keine Einträge in dieser Auswahl.</p>
        ) : (
          <table className="run-table">
            <thead>
              <tr>
                <th>Unternehmen</th>
                <th>Gesamt</th>
                <th>Symbol</th>
                <th>Kurs</th>
                <th>Kennzahlen</th>
                <th>Dauer</th>
              </tr>
            </thead>
            <tbody>
              {filteredStocks.map((s) => (
                <tr key={s.isin} className={`run-row run-row-${s.overall_status}`}>
                  <td>
                    <div className="run-stock-name">{s.stock_name || s.isin}</div>
                    <div className="run-stock-meta">
                      <span className="isin-pill">{s.isin}</span>
                      {s.resolved_symbol && <span className="run-symbol">{s.resolved_symbol}</span>}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={s.overall_status as StepStatus} />
                  </td>
                  <td>
                    <StepCell step={s.symbol} label={STEP_LABELS.symbol} />
                  </td>
                  <td>
                    <StepCell step={s.quote} label={STEP_LABELS.quote} />
                  </td>
                  <td>
                    <StepCell step={s.metrics} label={STEP_LABELS.metrics} />
                  </td>
                  <td className="run-duration">{formatStockDuration(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </div>
      )}

      {showHistory && (
        <section className="run-history">
          <div className="run-history-head">
            <h3>Verlauf</h3>
            <div className="jobs-toolbar-filters">
              <button
                type="button"
                className={`run-filter-pill${historyType === "all" ? " is-active" : ""}`}
                onClick={() => setHistoryType("all")}
              >
                Alle
              </button>
              <button
                type="button"
                className={`run-filter-pill${historyType === "market" ? " is-active" : ""}`}
                onClick={() => setHistoryType("market")}
              >
                Marktdaten
              </button>
              <button
                type="button"
                className={`run-filter-pill${historyType === "jobs" ? " is-active" : ""}`}
                onClick={() => setHistoryType("jobs")}
              >
                Jobs
              </button>
            </div>
          </div>
          {historyQuery.isLoading ? (
            <Spinner label="Lade Verlauf…" />
          ) : isMobile ? (
            <div className="run-history-cards">
              {(historyQuery.data ?? []).map((r) => (
                <div key={r.id} className="run-history-card">
                  <div className="run-history-card-top">
                    <span className="run-history-card-id">#{r.id}</span>
                    <span
                      className={`badge ${r.run_type === "jobs" ? "badge-muted" : "run-badge-done"}`}
                    >
                      {r.run_type === "jobs" ? "Jobs" : "Markt"}
                    </span>
                    <span className="run-history-card-status">{runStatusLabel(r.status)}</span>
                  </div>
                  <div className="run-history-card-meta">
                    {formatDateTime(r.started_at)} · {phaseLabel(r.phase)} ·{" "}
                    {formatDuration(r.duration_seconds)}
                  </div>
                  <div className="run-history-card-counts">
                    {r.stocks_success} OK · {r.stocks_error} Fehler · {r.stocks_total} Gesamt
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <table className="run-table" aria-label="Verlauf der bisherigen Läufe">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Typ</th>
                  <th>Start</th>
                  <th>Phase</th>
                  <th>Status</th>
                  <th>Dauer</th>
                  <th>OK / Fehler / Gesamt</th>
                </tr>
              </thead>
              <tbody>
                {(historyQuery.data ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>#{r.id}</td>
                    <td>
                      <span className={`badge ${r.run_type === "jobs" ? "badge-muted" : "run-badge-done"}`}>
                        {r.run_type === "jobs" ? "Jobs" : "Markt"}
                      </span>
                    </td>
                    <td>{formatDateTime(r.started_at)}</td>
                    <td>{phaseLabel(r.phase)}</td>
                    <td>{runStatusLabel(r.status)}</td>
                    <td>{formatDuration(r.duration_seconds)}</td>
                    <td>
                      {r.stocks_success} / {r.stocks_error} / {r.stocks_total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {subsetModal}
    </div>
  );
}
