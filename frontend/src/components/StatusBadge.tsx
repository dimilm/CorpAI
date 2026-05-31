import { STEP_STATUS_LABEL } from "../lib/runProgress";
import type { StepStatus } from "../types/run";

interface StatusBadgeProps {
  status: StepStatus;
  /** Override the default German label from STEP_STATUS_LABEL. */
  label?: string;
}

/** Colored run/step status pill. Reuses the `.run-badge-*` styling. */
export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span className={`run-badge run-badge-${status}`}>
      {label ?? STEP_STATUS_LABEL[status]}
    </span>
  );
}
