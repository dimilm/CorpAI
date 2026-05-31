interface RunSummaryItemProps {
  label: string;
  value: string;
  sub?: string;
  /** Status accent applied as `run-summary-<accent>` (e.g. "done", "error"). */
  accent?: string;
}

/** One KPI tile in a run-summary grid. Shared by the Runs, Jobs, and AI-batch
 *  progress views so the markup and accent classes stay in sync. */
export function RunSummaryItem({ label, value, sub, accent }: RunSummaryItemProps) {
  return (
    <div className={`run-summary-item${accent ? ` run-summary-${accent}` : ""}`}>
      <div className="run-summary-label">{label}</div>
      <div className="run-summary-value">{value}</div>
      {sub && <div className="run-summary-sub">{sub}</div>}
    </div>
  );
}
