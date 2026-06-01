import type { DebateResult } from "./agentTypes";

const SIDE_LABEL: Record<string, string> = {
  bull: "Bull",
  bear: "Bear",
  tie: "Unentschieden",
};

const CONVICTION_LABEL: Record<string, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
};

interface Props {
  result: DebateResult;
}

export function DebateResultView({ result }: Props) {
  return (
    <div className="ai-result-debate">
      <div className="ai-result-header">
        <div>
          <span className="ai-result-stat-label">Sieger der Debatte</span>
          <span className={`ai-debate-winner ai-debate-${result.winning_side}`}>
            {SIDE_LABEL[result.winning_side] ?? result.winning_side}
          </span>
        </div>
        <div>
          <span className="ai-result-stat-label">Konviktion</span>
          <span className="ai-result-stat-value">
            {CONVICTION_LABEL[result.conviction] ?? result.conviction}
          </span>
        </div>
      </div>
      {result.summary && <p className="ai-result-summary">{result.summary}</p>}
      <div className="ai-debate-grid">
        <section className="ai-debate-col ai-debate-col-bull">
          <h4 className="ai-debate-col-title">Bull-Argumente</h4>
          <ul className="ai-debate-args">
            {result.bull_arguments.map((a, idx) => (
              <li key={idx}>{a}</li>
            ))}
          </ul>
        </section>
        <section className="ai-debate-col ai-debate-col-bear">
          <h4 className="ai-debate-col-title">Bear-Argumente</h4>
          <ul className="ai-debate-args">
            {result.bear_arguments.map((a, idx) => (
              <li key={idx}>{a}</li>
            ))}
          </ul>
        </section>
      </div>
      {result.judge_rationale && (
        <p className="ai-result-summary">
          <strong>Urteil des Richters:</strong> {result.judge_rationale}
        </p>
      )}
    </div>
  );
}
