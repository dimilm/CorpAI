import { Link } from "react-router-dom";

import { HoverTooltip } from "../HoverTooltip";
import { parseBackendDate } from "../../lib/format";
import type {
  AIAgentId,
  AILatestRun,
  FisherPillSummary,
  RedFlagPillSummary,
  ScenarioPillSummary,
  Stock,
  TournamentPillSummary,
} from "../../types";

interface Props {
  stock: Stock;
}

const AGENT_ORDER: AIAgentId[] = ["fisher", "redflag", "scenario", "tournament"];

const AGENT_LABEL: Record<AIAgentId, string> = {
  fisher: "Fisher",
  redflag: "Risiko",
  scenario: "Szenario",
  tournament: "Turnier",
};

const RISK_LABEL: Record<RedFlagPillSummary["overall_risk"], string> = {
  low: "Niedrig",
  med: "Mittel",
  high: "Hoch",
};

const VERDICT_LABEL: Record<FisherPillSummary["verdict"], string> = {
  strong: "Stark",
  neutral: "Neutral",
  weak: "Schwach",
};

// Formats "vor 3 Tagen" / "vor 5 Stunden" / "vor 2 Min." / "gerade eben". Used
// in the tooltip head — the pill itself stays compact.
function formatRelative(iso: string): string {
  const ts = parseBackendDate(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const diffMs = Date.now() - ts;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days < 30) return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`;
  const months = Math.round(days / 30);
  return `vor ${months} ${months === 1 ? "Monat" : "Monaten"}`;
}

interface PillProps {
  agentId: AIAgentId;
  run: AILatestRun;
  isin: string;
  className: string;
  short: string;
  detail: string;
  // One-line result metric shown bold in the tooltip (e.g. "Score 22/30 · Stark").
  metric: string;
  // Free-text result summary from the agent run; omitted when empty.
  summary?: string;
}

function AIPill({ agentId, run, isin, className, short, detail, metric, summary }: PillProps) {
  return (
    <HoverTooltip
      className="ai-pill-tip"
      content={
        <span className="ai-pill-tip-body">
          <span className="ai-pill-tip-head">
            {AGENT_LABEL[agentId]} · {run.model}
          </span>
          <span className="ai-pill-tip-meta">{formatRelative(run.created_at)}</span>
          <span className="ai-pill-tip-metric">{metric}</span>
          {summary ? <span className="ai-pill-tip-summary">{summary}</span> : null}
        </span>
      }
    >
      <Link
        to={`/stocks/${isin}?agent=${agentId}`}
        className={`ai-pill ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="ai-pill-short" aria-hidden="true">
          {short}
        </span>
        <span className="ai-pill-detail">{detail}</span>
      </Link>
    </HoverTooltip>
  );
}

export function AIPillRow({ stock }: Props) {
  const runs = stock.latest_ai_runs ?? {};
  const pills: JSX.Element[] = [];

  for (const agentId of AGENT_ORDER) {
    const run = runs[agentId];
    if (!run) continue;
    const summary = run.summary as Record<string, unknown>;

    if (agentId === "fisher") {
      const s = summary as unknown as FisherPillSummary;
      pills.push(
        <AIPill
          key={agentId}
          agentId="fisher"
          run={run}
          isin={stock.isin}
          className={`ai-pill-fisher ai-pill-verdict-${s.verdict}`}
          short="F"
          detail={`${s.score}/30`}
          metric={`Score ${s.score}/30 · ${VERDICT_LABEL[s.verdict]}`}
          summary={s.summary}
        />
      );
    } else if (agentId === "redflag") {
      const s = summary as unknown as RedFlagPillSummary;
      const flagLabel = `${s.flag_count} ${s.flag_count === 1 ? "Flag" : "Flags"}`;
      pills.push(
        <AIPill
          key={agentId}
          agentId="redflag"
          run={run}
          isin={stock.isin}
          className={`ai-pill-risk ai-pill-risk-${s.overall_risk}`}
          short="R"
          detail={s.flag_count > 0 ? `${RISK_LABEL[s.overall_risk]} · ${s.flag_count}` : RISK_LABEL[s.overall_risk]}
          metric={`Risiko ${RISK_LABEL[s.overall_risk]} · ${flagLabel}`}
          summary={s.summary}
        />
      );
    } else if (agentId === "scenario") {
      const s = summary as unknown as ScenarioPillSummary;
      const positive = s.expected_return_pct >= 0;
      const detail = `${positive ? "+" : ""}${s.expected_return_pct.toFixed(1)} %`;
      const horizon = s.time_horizon_years ? ` · ${s.time_horizon_years} J.` : "";
      pills.push(
        <AIPill
          key={agentId}
          agentId="scenario"
          run={run}
          isin={stock.isin}
          className={`ai-pill-scenario ai-pill-scenario-${positive ? "pos" : "neg"}`}
          short="S"
          detail={detail}
          metric={`Erwartete Rendite ${detail}${horizon}`}
          summary={s.summary}
        />
      );
    } else if (agentId === "tournament") {
      const s = summary as unknown as TournamentPillSummary;
      const detail = s.is_winner ? "Sieger" : "Kein Sieg";
      const peerLabel = `${s.peer_count} ${s.peer_count === 1 ? "Peer" : "Peers"}`;
      pills.push(
        <AIPill
          key={agentId}
          agentId="tournament"
          run={run}
          isin={stock.isin}
          className={`ai-pill-tournament ai-pill-tournament-${s.is_winner ? "winner" : "loser"}`}
          short="T"
          detail={detail}
          metric={`${detail} · vs ${peerLabel}`}
          summary={s.summary}
        />
      );
    }
  }

  if (pills.length === 0) {
    return <span className="ai-pill-empty">–</span>;
  }
  // Pill colours carry over from the detail-view palette via the class names
  // above. The tooltip is a rich `HoverTooltip` (body portal) so the scrolling
  // table can't clip it; see `.ai-pill-tip*` in ai.css.
  return <span className="ai-pill-row">{pills}</span>;
}

export default AIPillRow;
