import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { SearchIcon } from "../components/icons";
import { Spinner } from "../components/Spinner";
import { useAgents, useRunAgentsBatch } from "../hooks/useAIAgents";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { STOCKS_LIST_KEY } from "../hooks/useStockMutations";
import { extractApiError } from "../lib/apiError";
import { toast } from "../lib/toast";
import type { Stock } from "../types";

// Tournament is excluded from the default selection: it fans out into nested
// per-peer LLM calls and is the most expensive agent, so the user opts in
// explicitly rather than triggering it across a whole batch by accident.
const DEFAULT_OFF_AGENT_IDS = new Set(["tournament"]);

// After a batch the watchlist KI pills read `latest_ai_runs` off the stocks
// list, which only changes once the serial runs finish. We can't know exactly
// when that is, so we nudge a refetch a few times across the first minute.
const REFETCH_DELAYS_MS = [15_000, 35_000, 60_000];

export function BatchAnalysisPage() {
  useDocumentTitle("KI-Stapellauf");
  const queryClient = useQueryClient();

  const agentsQuery = useAgents();
  const stocksQuery = useQuery<Stock[]>({
    queryKey: STOCKS_LIST_KEY,
    queryFn: async () => (await api.get("/stocks")).data as Stock[],
    staleTime: 60_000,
  });

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const stocks = useMemo(() => stocksQuery.data ?? [], [stocksQuery.data]);

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
  const [search, setSearch] = useState("");

  const batch = useRunAgentsBatch();

  const filteredStocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stocks;
    return stocks.filter(
      (s) => s.name.toLowerCase().includes(q) || s.isin.toLowerCase().includes(q)
    );
  }, [stocks, search]);

  const visibleIsins = useMemo(() => filteredStocks.map((s) => s.isin), [filteredStocks]);
  const allVisibleSelected =
    visibleIsins.length > 0 && visibleIsins.every((isin) => selectedIsins.has(isin));

  function toggleAgent(id: string) {
    setAgentOverride((current) => {
      const next = new Set(current ?? defaultAgents);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleStock(isin: string) {
    setSelectedIsins((current) => {
      const next = new Set(current);
      if (next.has(isin)) next.delete(isin);
      else next.add(isin);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIsins((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const isin of visibleIsins) next.delete(isin);
      } else {
        for (const isin of visibleIsins) next.add(isin);
      }
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
      queryClient.invalidateQueries({ queryKey: STOCKS_LIST_KEY });
      for (const delay of REFETCH_DELAYS_MS) {
        window.setTimeout(
          () => queryClient.invalidateQueries({ queryKey: STOCKS_LIST_KEY }),
          delay
        );
      }
    } catch (error) {
      toast.error(extractApiError(error, "Stapellauf konnte nicht gestartet werden."));
    }
  }

  const loading = agentsQuery.isLoading || stocksQuery.isLoading;

  return (
    <div className="page">
      <header className="batch-page-header">
        <h1>KI-Stapellauf</h1>
        <p className="detail-card-hint">
          Wähle mehrere Unternehmen und KI-Methoden aus, um alle Analysen in
          einem Durchlauf zu starten. Die Läufe werden nacheinander im
          Hintergrund ausgeführt.
        </p>
      </header>

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
            <div className="detail-card-head">
              <h3>Unternehmen</h3>
              <span className="detail-card-hint">
                {selectedIsins.size} ausgewählt
              </span>
            </div>

            <div className="batch-stock-toolbar">
              <input
                type="search"
                className="form-input"
                placeholder="Nach Name oder ISIN filtern …"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Unternehmen filtern"
              />
              <label className="ai-peer-chip">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  disabled={visibleIsins.length === 0}
                />
                Alle sichtbaren
              </label>
            </div>

            {filteredStocks.length === 0 ? (
              <EmptyState
                icon={<SearchIcon size={20} />}
                title="Keine Unternehmen"
                description="Passe den Filter an oder lege zunächst Unternehmen in der Watchlist an."
              />
            ) : (
              <div className="ai-peer-list batch-stock-list">
                {filteredStocks.map((s) => (
                  <label key={s.isin} className="ai-peer-chip">
                    <input
                      type="checkbox"
                      checked={selectedIsins.has(s.isin)}
                      onChange={() => toggleStock(s.isin)}
                    />
                    {s.name}
                    <span className="ai-peer-chip-isin">{s.isin}</span>
                  </label>
                ))}
              </div>
            )}
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
