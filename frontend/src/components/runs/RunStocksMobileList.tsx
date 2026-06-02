import { StatusBadge } from "../StatusBadge";
import { formatDuration } from "../../lib/format";
import { liveStockSeconds } from "../../lib/runProgress";
import type { RunStep, RunStockStatus, StepStatus } from "../../types/run";

const STEPS: { key: "symbol" | "quote" | "metrics"; label: string }[] = [
  { key: "symbol", label: "Symbol" },
  { key: "quote", label: "Kurs" },
  { key: "metrics", label: "Kennzahlen" },
];

interface Props {
  stocks: RunStockStatus[];
}

/**
 * Mobile card view of the per-stock Marktdaten run status — the phone-width
 * counterpart to `.run-table`. One card per stock: identity + overall status,
 * the three pipeline steps as labelled badges, any step errors, and duration.
 */
export function RunStocksMobileList({ stocks }: Props) {
  if (stocks.length === 0) {
    return <p className="run-empty">Keine Einträge in dieser Auswahl.</p>;
  }

  return (
    <div className="run-mobile-list">
      {stocks.map((s) => {
        const steps = STEPS.map((st) => ({ ...st, step: s[st.key] as RunStep }));
        const errors = steps.filter((st) => st.step.error);

        return (
          <div key={s.isin} className={`run-mobile-card run-row-${s.overall_status}`}>
            <header className="run-mobile-card-header">
              <div className="run-mobile-card-name-block">
                <div className="run-mobile-card-name">{s.stock_name || s.isin}</div>
                <div className="run-mobile-card-meta">
                  <span className="isin-pill">{s.isin}</span>
                  {s.resolved_symbol && <span className="run-symbol">{s.resolved_symbol}</span>}
                </div>
              </div>
              <StatusBadge status={s.overall_status as StepStatus} />
            </header>

            <div className="run-mobile-card-steps">
              {steps.map((st) => (
                <div
                  key={st.key}
                  className="run-mobile-card-step"
                  title={st.step.error ?? undefined}
                >
                  <span className="run-mobile-card-step-label">{st.label}</span>
                  <StatusBadge status={st.step.status as StepStatus} />
                </div>
              ))}
            </div>

            {errors.map((st) => (
              <p key={st.key} className="run-step-error run-mobile-card-error">
                {st.label}: {st.step.error}
              </p>
            ))}

            <footer className="run-mobile-card-footer">
              <span className="run-mobile-card-footer-label">Dauer</span>
              <span>{formatDuration(liveStockSeconds(s))}</span>
            </footer>
          </div>
        );
      })}
    </div>
  );
}

export default RunStocksMobileList;
