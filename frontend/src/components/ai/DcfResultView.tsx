import { formatCurrency, formatPercent } from "../../lib/format";
import type { DcfResult } from "./agentTypes";

const VERDICT_LABEL: Record<string, string> = {
  cheap: "Unterbewertet",
  fair: "Fair bewertet",
  expensive: "Überbewertet",
};

interface Props {
  result: DcfResult;
  currency?: string | null;
}

export function DcfResultView({ result, currency }: Props) {
  const range: { key: string; label: string; value: number; emphasis?: boolean }[] = [
    { key: "low", label: "Bear", value: result.fair_value_low },
    { key: "base", label: "Base", value: result.fair_value_base, emphasis: true },
    { key: "high", label: "Bull", value: result.fair_value_high },
    { key: "current", label: "Aktuell", value: result.current_price },
  ];

  const params: { label: string; value: string }[] = [
    { label: "Implizites Wachstum", value: formatPercent(result.implied_growth_pct, 1, { showSign: false }) },
    { label: "Diskontsatz", value: formatPercent(result.discount_rate_pct, 1, { showSign: false }) },
    { label: "Ewiges Wachstum", value: formatPercent(result.terminal_growth_pct, 1, { showSign: false }) },
    { label: "Horizont", value: `${result.forecast_years} J` },
  ];

  return (
    <div className="ai-result-dcf">
      <div className="ai-result-header">
        <div>
          <span className="ai-result-stat-label">Fairer Wert (Base)</span>
          <span className="ai-result-stat-value">
            {formatCurrency(result.fair_value_base, currency)}
          </span>
        </div>
        <div>
          <span className="ai-result-stat-label">Upside</span>
          <span className="ai-result-stat-value">{formatPercent(result.upside_pct, 1)}</span>
        </div>
        <div>
          <span className="ai-result-stat-label">Sicherheitsmarge</span>
          <span className="ai-result-stat-value">{formatPercent(result.margin_of_safety_pct, 1)}</span>
        </div>
        <span className={`ai-result-verdict ai-result-verdict-${result.verdict}`}>
          {VERDICT_LABEL[result.verdict] ?? result.verdict}
        </span>
      </div>
      {result.summary && <p className="ai-result-summary">{result.summary}</p>}

      <div className="ai-dcf-range">
        {range.map((r) => (
          <div
            key={r.key}
            className={`ai-dcf-range-item${r.emphasis ? " ai-dcf-range-base" : ""}`}
          >
            <span className="ai-result-stat-label">{r.label}</span>
            <span className="ai-result-stat-value">{formatCurrency(r.value, currency)}</span>
          </div>
        ))}
      </div>

      <dl className="ai-dcf-params">
        {params.map((p) => (
          <div key={p.label}>
            <dt>{p.label}</dt>
            <dd>{p.value}</dd>
          </div>
        ))}
      </dl>

      <div className="ai-dcf-lists">
        <section>
          <h4 className="ai-dcf-list-title">Eingepreiste Erwartungen</h4>
          <ul className="ai-dcf-list">
            {result.implied_expectations.map((e, idx) => (
              <li key={idx}>{e}</li>
            ))}
          </ul>
        </section>
        <section>
          <h4 className="ai-dcf-list-title">Annahmen</h4>
          <ul className="ai-dcf-list">
            {result.key_assumptions.map((a, idx) => (
              <li key={idx}>{a}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
