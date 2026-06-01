import type { FiveForcesResult } from "./agentTypes";

const FORCE_LABEL: Record<string, string> = {
  new_entrants: "Neue Anbieter",
  supplier_power: "Lieferantenmacht",
  buyer_power: "Käufermacht",
  substitutes: "Substitute",
  rivalry: "Wettbewerbsrivalität",
};

const INTENSITY_LABEL: Record<string, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
};

const ATTRACTIVENESS_LABEL: Record<string, string> = {
  attractive: "Attraktiv",
  neutral: "Neutral",
  unattractive: "Unattraktiv",
};

interface Props {
  result: FiveForcesResult;
}

export function FiveForcesResultView({ result }: Props) {
  return (
    <div className="ai-result-forces">
      <div className="ai-result-header">
        <div>
          <span className="ai-result-stat-label">Branchenattraktivität</span>
          <span
            className={`ai-forces-attractiveness ai-forces-attr-${result.industry_attractiveness}`}
          >
            {ATTRACTIVENESS_LABEL[result.industry_attractiveness] ??
              result.industry_attractiveness}
          </span>
        </div>
        <div>
          <span className="ai-result-stat-label">Kräfte</span>
          <span className="ai-result-stat-value">{result.forces.length}</span>
        </div>
      </div>
      {result.summary && <p className="ai-result-summary">{result.summary}</p>}
      <ul className="ai-forces-list">
        {result.forces.map((f, idx) => (
          <li key={idx} className={`ai-forces-item ai-forces-${f.intensity}`}>
            <div className="ai-forces-head">
              <span className="ai-forces-title">{FORCE_LABEL[f.force] ?? f.force}</span>
              <span className={`ai-forces-intensity-pill ai-forces-${f.intensity}`}>
                {INTENSITY_LABEL[f.intensity] ?? f.intensity}
              </span>
            </div>
            <p className="ai-forces-desc">{f.rationale}</p>
            {f.drivers.length > 0 && (
              <ul className="ai-forces-drivers">
                {f.drivers.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
