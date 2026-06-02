import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client";
import { AIBatchProgress } from "../components/ai/AIBatchProgress";
import { AIPillRow } from "../components/ai/AIPillRow";
import { Spinner } from "../components/Spinner";
import { StockSelectList, StockSelectColumn } from "../components/StockSelectList";
import {
  useAgents,
  useCancelAIBatch,
  useImportAIRuns,
  useRunAgentsBatch,
  useRunAIStatuses,
} from "../hooks/useAIAgents";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { STOCKS_LIST_KEY } from "../hooks/useStockMutations";
import { extractApiError } from "../lib/apiError";
import { downloadBlob } from "../lib/download";
import { useCurrentRun, useInvalidateOnRunFinish } from "../lib/runProgress";
import { toast } from "../lib/toast";
import type { Stock } from "../types";

// Tournament is excluded from the default selection: it fans out into nested
// per-peer LLM calls and is the most expensive agent, so the user opts in
// explicitly rather than triggering it across a whole batch by accident.
const DEFAULT_OFF_AGENT_IDS = new Set(["tournament"]);

// Extra column on the company table: the latest AI result per method, so the
// user can pick stocks based on what has (not) been analysed yet. Pills link
// to the stock detail for that agent (they stop row-selection propagation).
const STOCK_KI_COLUMNS: StockSelectColumn[] = [
  {
    key: "ki",
    header: "Letzte KI-Analysen",
    render: (stock) => <AIPillRow stock={stock} />,
  },
];

export function BatchAnalysisPage() {
  useDocumentTitle("KI-Analysen");
  const queryClient = useQueryClient();

  const agentsQuery = useAgents();
  const stocksQuery = useQuery<Stock[]>({
    queryKey: STOCKS_LIST_KEY,
    queryFn: async () => (await api.get("/stocks")).data as Stock[],
    staleTime: 60_000,
  });

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const stocks = useMemo(() => stocksQuery.data ?? [], [stocksQuery.data]);

  // Reuse the RunLog progress machinery the Marktdaten/Stellen pages use.
  // `useCurrentRun("ai")` polls `/run-logs/current?run_type=ai` and the detail
  // feed swaps spinners for results as the serial batch advances.
  const { data: aiRun } = useCurrentRun("ai");
  const isRunning = aiRun != null && aiRun.phase !== "finished";
  const aiStatuses = useRunAIStatuses(aiRun?.id, isRunning);
  const cancelBatch = useCancelAIBatch();
  useInvalidateOnRunFinish([STOCKS_LIST_KEY]);

  const agentLabel = useCallback(
    (id: string) => agents.find((a) => a.id === id)?.name ?? id,
    [agents]
  );

  // `null` means "not yet touched" → fall back to the default selection
  // (everything except the expensive Tournament agent), computed from the
  // loaded agent list. Once the user toggles anything we hold their explicit
  // set. This derives the default during render, avoiding a seed-via-effect.
  const [agentOverride, setAgentOverride] = useState<Set<string> | null>(null);
  const defaultAgents = useMemo(
    () => new Set(agents.filter((a) => !DEFAULT_OFF_AGENT_IDS.has(a.id)).map((a) => a.id)),
    [agents]
  );
  const selectedAgents = agentOverride ?? defaultAgents;

  const [selectedIsins, setSelectedIsins] = useState<Set<string>>(new Set());

  const batch = useRunAgentsBatch();

  // Export/import of the AI-run history: run Opus analyses locally, then carry
  // the results to other deployments (and keep a backup). Mirrors the
  // job-history export/import in Settings.
  const importRuns = useImportAIRuns();
  const importFileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);

  async function exportAnalyses() {
    setExporting(true);
    try {
      await downloadBlob("/ai/runs/export", "ai-analysis.json", "application/json");
      toast.success("KI-Analysen exportiert.");
    } catch (error) {
      toast.error(extractApiError(error, "Export fehlgeschlagen."));
    } finally {
      setExporting(false);
    }
  }

  async function importAnalyses(file: File) {
    try {
      const report = await importRuns.mutateAsync(file);
      const parts = [
        `${report.inserted} importiert`,
        `${report.skipped_existing} übersprungen`,
      ];
      if (report.unmapped_rows.length > 0) {
        parts.push(`${report.unmapped_rows.length} nicht zugeordnet`);
      }
      if (report.malformed_rows.length > 0) {
        parts.push(`${report.malformed_rows.length} fehlerhaft`);
      }
      const clean = report.unmapped_rows.length === 0 && report.malformed_rows.length === 0;
      const text = `Import: ${parts.join(", ")}.`;
      if (clean) toast.success(text);
      else toast.error(text);
    } catch (error) {
      toast.error(extractApiError(error, "Import fehlgeschlagen."));
    }
  }

  function toggleAgent(id: string) {
    setAgentOverride((current) => {
      const next = new Set(current ?? defaultAgents);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const runCount = selectedIsins.size * selectedAgents.size;
  const canStart = runCount > 0 && !batch.isPending;

  async function start() {
    try {
      const result = await batch.mutateAsync({
        agentIds: Array.from(selectedAgents),
        isins: Array.from(selectedIsins),
      });
      const queued = result.queued.length;
      const skipped = result.skipped.length;
      const msg =
        skipped > 0
          ? `${queued} Analyse(n) gestartet, ${skipped} übersprungen.`
          : `${queued} Analyse(n) gestartet.`;
      toast.success(msg, { title: "KI-Stapellauf" });
      setSelectedIsins(new Set());
      // Pull the finished runs into the stocks list (and thus the KI pills).
      // `useInvalidateOnRunFinish` re-fetches again once the run completes.
      queryClient.invalidateQueries({ queryKey: STOCKS_LIST_KEY });
      // Kick off the current-run poll immediately so the progress panel appears
      // without waiting for the next background tick.
      queryClient.invalidateQueries({ queryKey: ["run-current", "ai"] });
    } catch (error) {
      toast.error(extractApiError(error, "Stapellauf konnte nicht gestartet werden."));
    }
  }

  const loading = agentsQuery.isLoading || stocksQuery.isLoading;

  return (
    <div className="page">
      <header className="batch-page-header">
        <h2>KI-Analysen</h2>
        <p className="detail-card-hint">
          Wähle mehrere Unternehmen und KI-Methoden aus, um alle Analysen in
          einem Durchlauf zu starten. Die Läufe werden nacheinander im
          Hintergrund ausgeführt.
        </p>
        <div className="batch-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void exportAnalyses()}
            disabled={exporting}
          >
            {exporting ? "Exportiere …" : "Analysen exportieren"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => importFileRef.current?.click()}
            disabled={importRuns.isPending}
          >
            {importRuns.isPending ? "Importiere …" : "Analysen importieren"}
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void importAnalyses(file);
                e.target.value = "";
              }
            }}
          />
        </div>
      </header>

      {aiRun && (
        <AIBatchProgress
          key={aiRun.id}
          run={aiRun}
          items={aiStatuses.data ?? []}
          agentLabel={agentLabel}
          onCancel={() =>
            cancelBatch.mutate(undefined, {
              onSuccess: (r) => {
                if (r?.cancelled) toast.success("Lauf wird abgebrochen.");
              },
              onError: (e) => toast.error(extractApiError(e, "Abbruch fehlgeschlagen.")),
            })
          }
          cancelPending={cancelBatch.isPending}
        />
      )}

      {loading && <Spinner label="Lade Daten …" />}
      {agentsQuery.isError && (
        <p className="form-banner-error">Agenten konnten nicht geladen werden.</p>
      )}
      {stocksQuery.isError && (
        <p className="form-banner-error">Unternehmen konnten nicht geladen werden.</p>
      )}

      {!loading && agentsQuery.data && stocksQuery.data && (
        <>
          <section className="detail-card">
            <div className="detail-card-head">
              <h3>KI-Methoden</h3>
              <span className="detail-card-hint">
                {selectedAgents.size} ausgewählt
              </span>
            </div>
            <div className="ai-peer-list">
              {agents.map((a) => (
                <label key={a.id} className="ai-peer-chip" title={a.description}>
                  <input
                    type="checkbox"
                    checked={selectedAgents.has(a.id)}
                    onChange={() => toggleAgent(a.id)}
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </section>

          <section className="detail-card">
            <StockSelectList
              stocks={stocks}
              selectedIsins={selectedIsins}
              onChange={setSelectedIsins}
              extraColumns={STOCK_KI_COLUMNS}
            />
          </section>

          <div className="batch-action-bar">
            <span className="batch-action-summary">
              {selectedIsins.size} Unternehmen × {selectedAgents.size} Methoden ={" "}
              <strong>{runCount}</strong> Läufe
            </span>
            <button
              type="button"
              className="btn-primary"
              disabled={!canStart}
              onClick={() => void start()}
            >
              {batch.isPending ? "Starte …" : "KI-Analyse starten"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default BatchAnalysisPage;
