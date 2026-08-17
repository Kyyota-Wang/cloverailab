/**
 * The wire types, mirroring the contract in BACKEND.md section 1.
 *
 * These are hand-written rather than imported from packages/agent because the
 * frontend builds with a different tsconfig (DOM lib, bundler resolution) and
 * the agent package assumes Node. Keeping a copy costs a little duplication and
 * buys a build that cannot break when the agent's internals move.
 */

export type TaskVariant =
  | "statement"
  | "claim_challenge"
  | "claim_and_reason"
  | "recommendation"
  | "two_views"
  | "policy";

export const VARIANTS: readonly TaskVariant[] = [
  "statement",
  "claim_challenge",
  "claim_and_reason",
  "recommendation",
  "two_views",
  "policy",
];

export type RubricAxis =
  | "position"
  | "development"
  | "organization"
  | "language"
  | "conventions";

export interface Topic {
  id: string;
  statement: string;
  instruction: string;
  variant: TaskVariant;
  variantSummary: string;
  requiredMoves: string[];
}

export interface TopicsResponse {
  topics: Topic[];
  variantCounts: Partial<Record<TaskVariant, number>>;
}

export interface ConfigResponse {
  /** Null when Turnstile is not configured, which is normal in local dev. */
  turnstileSiteKey: string | null;
}

export interface PromptSpec {
  statement: string;
  instruction: string;
  variant: TaskVariant;
  requiredMoves: string[];
}

export interface ResolveResponse {
  prompt: PromptSpec;
  variantSummary: string;
}

/** Hard problems that make a score of 0 or 1 near-certain. */
export type PrecheckFlag =
  | "empty"
  | "off_topic"
  | "extremely_short"
  | "single_paragraph"
  | "copies_prompt";

export interface Precheck {
  wordCount: number;
  paragraphCount: number;
  sentenceCount: number;
  meanSentenceWords: number;
  sentenceLengthStdev: number;
  /** 0-1: share of the prompt's content words that appear in the response. */
  promptOverlap: number;
  opensByRestatingPrompt: boolean;
  concessionMarkers: string[];
  specificityMarkers: string[];
  formulaicMarkers: string[];
  flags: PrecheckFlag[];
}

export interface PrecheckResponse {
  precheck: Precheck;
  formatted: string;
  prompt: PromptSpec;
}

export interface Usage {
  provider: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** Zero when the mechanical zero short-circuit fired: no model call, no cost. */
  calls?: number;
}

export interface ComplianceMove {
  move: string;
  addressed: boolean;
  evidence: string;
}

export interface AxisAssessment {
  axis: RubricAxis;
  score: number;
  evidence: string;
  reasoning: string;
}

export interface Suggestion {
  priority: number;
  axis: RubricAxis;
  problem: string;
  fix: string;
  example?: string;
}

export interface Review {
  compliance: { variant: TaskVariant; moves: ComplianceMove[] };
  axisAssessments: AxisAssessment[];
  anchorComparison: {
    closestAnchorId: string;
    relativePosition: "above" | "level" | "below";
    comparedWith: string[];
    reasoning: string;
  };
  holisticScore: number;
  confidenceRange: [number, number];
  raterCommentary: string;
  suggestions: Suggestion[];
}

export interface ReviewResponse {
  review: Review;
  precheck: Precheck;
  prompt: PromptSpec;
  samples: number[];
  usage: Usage;
  estimatedCostUsd: number;
}

export interface WritePlan {
  position: string;
  moveCoverage: Array<{ move: string; plan: string }>;
  bodyParagraphs: Array<{ claim: string; example: string; role: string }>;
  concession: string;
}

export interface WriteResponse {
  plan: WritePlan;
  essay: string;
  notes: { targetScore: number; whyThisScores: string; ifAimingHigher: string };
  prompt: PromptSpec;
  wordCount: number;
  usage: Usage;
  estimatedCostUsd: number;
}

export interface ChatResponse {
  answer: string;
  usage: Usage;
  estimatedCostUsd: number;
}

/** Half points from 3 to 6. Below 3 there is nothing instructive to show. */
export const TARGET_SCORES = [3, 3.5, 4, 4.5, 5, 5.5, 6] as const;
