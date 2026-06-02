import { useMemo, useRef, useState } from "react";

import { FilterPills, FilterPillOption } from "../FilterPills";
import { RunSummaryItem } from "../RunSummaryItem";
import { StatusBadge } from "../StatusBadge";
import { formatDuration, parseBackendDate } from "../../lib/format";
import {
  liveRunSeconds,
  phaseLabel,
  runStatusLabel,
  STEP_STATUS_LABEL,
} from "../../lib/runProgress";
import type { AIRunStatus, RunSummary, StepStatus } from "../../types/run";

type StatusFilter = "all" | StepStatus;

interface Props {
  run: RunSummary;
  items: AIRunStatus[];
  agentLabel: (agentId: string) => string;
  onCancel: () => void;
  cancelPending: boolean;
}

// Live timer for in-flight rows; finished rows fall back to the recorded
// duration. The growing counter re-renders on the parent's polling refetch
// (matching RunsPage), so no local interval is needed here.
function itemDuration(item: AIRunStatus): string {
  if (item.status === "running") {
    const start = parseBackendDate(item.created_at).getTime();
    return formatDuration(Math.max(0, Math.round((Date.now() - start) / 1000)), {
      dashOnZero: false,
    });
  }
  if (item.duration_ms != null) {
    return formatDuration(Math.round(item.duration_ms / 1000));
  }
  return "–";
}

export function AIBatchProgress({ run, items, agentLabel, onCancel, cancelPending }: Props) {
  const [filter, setFilter] = useState<StatusFilter>("all");

  const counters = useMemo(() => {
    const c: Record<StepStatus, number> = {
      not_started: 0,
      running: 0,
      done: 0,
      error: 0,
      cancelled: 0,
    };
    for (const item of items) c[item.status] = (c[item.status] ?? 0) + 1;
    return c;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.status === filter);
  }, [items, filter]);

  const total = run.stocks_total || 0;
  const done = run.stocks_done || 0;
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const filterOptions: FilterPillOption<StatusFilter>[] = [
    { value: "all", label: "Alle", count: items.length },
    { value: "running", label: STEP_STATUS_LABEL.running, count: counters.running, accent: "running" },
    { value: "done", label: STEP_STATUS_LABEL.done, count: counters.done, accent: "done" },
    { value: "error", label: STEP_STATUS_LABEL.error, count: counters.error, accent: "error" },
    {
      value: "cancelled",
      label: STEP_STATUS_LABEL.cancelled,
      count: counters.cancelled,
      accent: "cancelled",
      hidden: counters.cancelled === 0,
    },
  ];

  const isFinished = run.phase === "finished";

  // Ein abgeschlossener Lauf wird oben nur als schmale Zusammenfassung gezeigt
  // und standardmäßig eingeklappt, damit er die Aktientabelle nicht wegdrückt.
  // `wasRunningRef` merkt, ob wir den Lauf live gesehen haben: dann bleibt er
  // offen (kein plötzliches Zuklappen beim Fertigwerden), ein beim Laden bereits
  // fertiger Lauf startet zu. `key={run.id}` am Aufrufer setzt das pro Lauf zurück.
  const wasRunningRef = useRef(false);
  if (!isFinished) wasRunningRef.current = true;
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? wasRunningRef.current;

  const detail = (
    <>
      <div className="run-summary-card">
        <div className="run-summary-grid">
          <RunSummaryItem label="Phase" value={phaseLabel(run.phase)} accent={run.phase} />
          <RunSummaryItem label="Status" value={runStatusLabel(run.status)} accent={run.status} />
          <RunSummaryItem label="Fortschritt" value={`${done} / ${total}`} sub={`${progressPct} %`} />
          <RunSummaryItem label="Erfolge" value={String(run.stocks_success)} accent="done" />
          <RunSummaryItem
            label="Fehler"
            value={String(run.stocks_error)}
            accent={run.stocks_error ? "error" : undefined}
          />
          {run.phase !== "finished" ? (
            <RunSummaryItem
              label="Bisher"
              value={formatDuration(liveRunSeconds(run), { dashOnZero: false })}
            />
          ) : (
            run.duration_seconds != null && (
              <RunSummaryItem label="Dauer" value={formatDuration(run.duration_seconds)} />
            )
          )}
        </div>

        <div className="run-progress-bar" aria-label={`${progressPct} %`}>
          <div className="run-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>

        {run.phase !== "finished" && (
          <button
            type="button"
            className="btn-danger"
            onClick={onCancel}
            disabled={cancelPending}
            title="Den laufenden KI-Stapellauf abbrechen"
          >
            {cancelPending ? "Wird abgebrochen…" : "Lauf abbrechen"}
          </button>
        )}
      </div>

      <FilterPills
        value={filter}
        onChange={setFilter}
        options={filterOptions}
        ariaLabel="Status filtern"
      />

      <div className="run-table-wrapper">
        {filteredItems.length === 0 ? (
          <p className="run-empty">Keine Einträge in dieser Auswahl.</p>
        ) : (
          <table className="run-table">
            <thead>
              <tr>
                <th>Unternehmen</th>
                <th>Methode</th>
                <th>Status</th>
                <th>Dauer</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr
                  key={`${item.isin}-${item.agent_id}`}
                  className={`run-row run-row-${item.status}`}
                >
                  <td>
                    <div className="run-stock-name">{item.stock_name || item.isin}</div>
                    <div className="run-stock-meta">
                      <span className="isin-pill">{item.isin}</span>
                    </div>
                  </td>
                  <td>{agentLabel(item.agent_id)}</td>
                  <td title={item.error_text ?? undefined}>
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="run-duration">{itemDuration(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );

  // Aktiver/anstehender Lauf: volle Live-Ansicht wie bisher.
  if (!isFinished) return detail;

  // Abgeschlossener Lauf: kompakte, aufklappbare Zusammenfassungszeile.
  return (
    <section className="ai-batch-summary">
      <button
        type="button"
        className="ai-batch-summary-toggle"
        onClick={() => setUserExpanded((v) => !(v ?? wasRunningRef.current))}
        aria-expanded={expanded}
      >
        <span className="ai-batch-summary-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="ai-batch-summary-label">
          Letzter Lauf · {runStatusLabel(run.status)}
        </span>
        <span className="ai-batch-summary-figs">
          <span>
            {done} / {total}
          </span>
          <span className="is-ok">{run.stocks_success} ok</span>
          {run.stocks_error > 0 && (
            <span className="is-err">{run.stocks_error} Fehler</span>
          )}
          {run.duration_seconds != null && (
            <span>{formatDuration(run.duration_seconds)}</span>
          )}
        </span>
        <span className="ai-batch-summary-cta">
          {expanded ? "Details ausblenden" : "Details"}
        </span>
      </button>
      {expanded && detail}
    </section>
  );
}

export default AIBatchProgress;
