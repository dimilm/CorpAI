/**
 * Mirrors of the agent Pydantic schemas. Keep in sync with
 * `backend/app/agents/<agent>/schema.py`. We only model what the UI actually
 * renders.
 */

export type FisherVerdict = "strong" | "neutral" | "weak";

export interface FisherQuestion {
  id: string;
  question: string;
  rating: 0 | 1 | 2;
  rationale: string;
}

export interface FisherResult {
  questions: FisherQuestion[];
  total_score: number;
  verdict: FisherVerdict;
  summary: string;
}

export interface ScenarioBranch {
  assumptions: string[];
  target_price: number;
  probability: number;
}

export interface ScenarioResult {
  bull: ScenarioBranch;
  base: ScenarioBranch;
  bear: ScenarioBranch;
  expected_value: number;
  expected_return_pct: number;
  time_horizon_years: number;
  summary: string;
}

export type RedFlagCategory =
  | "accounting"
  | "leverage"
  | "regulatory"
  | "concentration"
  | "governance"
  | "market"
  | "other";

export type RedFlagSeverity = "low" | "med" | "high";

export interface RedFlag {
  category: RedFlagCategory;
  severity: RedFlagSeverity;
  title: string;
  description: string;
  evidence_hint: string;
}

export interface RedFlagResult {
  flags: RedFlag[];
  overall_risk: RedFlagSeverity;
  summary: string;
}

export interface TournamentMatchScore {
  a: number;
  b: number;
}

export interface TournamentMatch {
  a: string;
  b: string;
  category_scores: Record<string, TournamentMatchScore>;
  winner: string;
  rationale: string;
}

export interface TournamentResult {
  rounds: TournamentMatch[][];
  winner_isin: string;
  winner_rationale: string;
  summary: string;
}

export type DcfVerdict = "cheap" | "fair" | "expensive";

export interface DcfResult {
  forecast_years: number;
  discount_rate_pct: number;
  terminal_growth_pct: number;
  fair_value_low: number;
  fair_value_base: number;
  fair_value_high: number;
  current_price: number;
  upside_pct: number;
  margin_of_safety_pct: number;
  implied_growth_pct: number;
  implied_expectations: string[];
  key_assumptions: string[];
  verdict: DcfVerdict;
  summary: string;
}

export type ForceIntensity = "low" | "medium" | "high";
export type IndustryAttractiveness = "attractive" | "neutral" | "unattractive";

export interface ForceAssessment {
  force: string;
  intensity: ForceIntensity;
  rationale: string;
  drivers: string[];
}

export interface FiveForcesResult {
  forces: ForceAssessment[];
  industry_attractiveness: IndustryAttractiveness;
  summary: string;
}

export type DebateSide = "bull" | "bear" | "tie";
export type DebateConviction = "low" | "medium" | "high";

export interface DebateResult {
  bull_arguments: string[];
  bear_arguments: string[];
  winning_side: DebateSide;
  conviction: DebateConviction;
  judge_rationale: string;
  summary: string;
}
