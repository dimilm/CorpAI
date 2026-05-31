import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client";
import type { AgentInfo, AIRun, BatchRunResult } from "../types";
import type { AIRunStatus } from "../types/run";

export const AI_AGENTS_QUERY_KEY = ["ai", "agents"] as const;
export const AI_RUNS_QUERY_KEY = (agentId: string, isin: string) =>
  ["ai", "runs", agentId, isin] as const;
export const AI_PROMPT_QUERY_KEY = (agentId: string) => ["ai", "prompt", agentId] as const;
export const RUN_AI_STATUSES_KEY = (runId: number) => ["run-logs", runId, "ai"] as const;

export function useAgents() {
  return useQuery<AgentInfo[]>({
    queryKey: AI_AGENTS_QUERY_KEY,
    queryFn: async () => (await api.get("/ai/agents")).data as AgentInfo[],
    staleTime: 10 * 60_000,
  });
}

export function useAgentPrompt(agentId: string | null) {
  return useQuery<string>({
    queryKey: AI_PROMPT_QUERY_KEY(agentId ?? ""),
    enabled: Boolean(agentId),
    queryFn: async () => {
      const res = await api.get(`/ai/agents/${agentId}/prompt`, {
        responseType: "text",
        transformResponse: [(d) => d as string],
      });
      return typeof res.data === "string" ? res.data : String(res.data);
    },
    staleTime: 60 * 60_000,
  });
}

export function useAgentRuns(agentId: string, isin: string | undefined, limit = 10) {
  return useQuery<AIRun[]>({
    queryKey: AI_RUNS_QUERY_KEY(agentId, isin ?? ""),
    enabled: Boolean(isin),
    queryFn: async () => {
      const res = await api.get(`/ai/agents/${agentId}/runs/${isin}`, {
        params: { limit },
      });
      return res.data as AIRun[];
    },
    staleTime: 30_000,
    // Poll every 2s while at least one run is still in `running` state, so
    // the UI swaps the inline spinner for the real result without a manual
    // refresh. Returning `false` when nothing is in flight stops the polling
    // loop entirely.
    refetchInterval: (query) => {
      const data = query.state.data as AIRun[] | undefined;
      const hasRunning = data?.some((r) => r.status === "running");
      return hasRunning ? 2_000 : false;
    },
  });
}

export interface RunAgentParams {
  agentId: string;
  isin: string;
  peers?: string[];
}

export function useRunAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ agentId, isin, peers }: RunAgentParams): Promise<AIRun> => {
      const body: Record<string, unknown> = {};
      if (peers && peers.length > 0) body.peers = peers;
      const res = await api.post(`/ai/agents/${agentId}/run/${isin}`, body);
      return res.data as AIRun;
    },
    onSuccess: (run, vars) => {
      // The endpoint now returns immediately with a `running` row. Prepend
      // it optimistically so the section's spinner appears without waiting
      // for the next poll, and invalidate so the eventual `done`/`error`
      // update arrives via the polling refetch.
      const key = AI_RUNS_QUERY_KEY(vars.agentId, vars.isin);
      qc.setQueryData<AIRun[]>(key, (old) => {
        if (!old) return [run];
        if (old.some((r) => r.id === run.id)) return old;
        return [run, ...old];
      });
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

export interface RunAgentsBatchParams {
  agentIds: string[];
  isins: string[];
}

/**
 * Queue a cartesian product of agents × stocks via `POST /ai/runs/batch`. The
 * backend runs them serially and returns a queued/skipped summary; callers
 * surface that (e.g. as a toast) and refetch the stocks list so the watchlist
 * KI pills pick up the finished runs.
 */
export function useRunAgentsBatch() {
  return useMutation({
    mutationFn: async ({ agentIds, isins }: RunAgentsBatchParams): Promise<BatchRunResult> => {
      const res = await api.post("/ai/runs/batch", {
        agent_ids: agentIds,
        isins,
      });
      return res.data as BatchRunResult;
    },
  });
}

// Per-run detail feed for an AI batch, mirroring `useRunJobStatuses`. Polls
// every 2s while the run is in flight; otherwise honours the 30s cache.
export function useRunAIStatuses(runId: number | undefined, polling = false) {
  return useQuery<AIRunStatus[]>({
    queryKey: RUN_AI_STATUSES_KEY(runId ?? -1),
    enabled: runId != null && runId >= 0,
    queryFn: async () => (await api.get(`/run-logs/${runId}/ai`)).data as AIRunStatus[],
    refetchInterval: polling ? 2000 : false,
    staleTime: 30_000,
  });
}

export function useCancelAIBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post("/ai/runs/batch/cancel")).data as {
        cancelled: boolean;
        run_id?: number | null;
      },
    onSettled: () => qc.invalidateQueries({ queryKey: ["run-current", "ai"] }),
  });
}
