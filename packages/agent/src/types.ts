/** Shared types for the GRE Analytical Writing agents (Issue task only). */

/** The six official task-instruction variants in the ETS Issue pool. */
export type TaskVariant =
  | "statement"
  | "claim_challenge"
  | "claim_and_reason"
  | "recommendation"
  | "two_views"
  | "policy";

/** The five axes the ETS scoring guide numbers at each score point. */
export type RubricAxis =
  | "position"
  | "development"
  | "organization"
  | "language"
  | "conventions";

export const RUBRIC_AXES: readonly RubricAxis[] = [
  "position",
  "development",
  "organization",
  "language",
  "conventions",
] as const;

/** Valid GRE AWA scores. Reported in half points; the rubric defines integers. */
export type Score = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5 | 5.5 | 6;

export interface PromptSpec {
  /** The issue statement the test taker was asked to respond to. */
  statement: string;
  /** The task instruction that follows it. */
  instruction: string;
  /** Which of the six variants the instruction is. */
  variant: TaskVariant;
  /** What this variant requires a response to actually do. */
  requiredMoves: string[];
}

/** Deterministic signals computed without an LLM. Evidence, never a verdict. */
export interface Precheck {
  wordCount: number;
  paragraphCount: number;
  sentenceCount: number;
  meanSentenceWords: number;
  /** Standard deviation of sentence length -- the rubric rewards variety. */
  sentenceLengthStdev: number;
  /** Share of the prompt's content words that appear in the essay. */
  promptOverlap: number;
  /** True when the opening sentence largely restates the prompt. */
  opensByRestatingPrompt: boolean;
  /** Discourse markers that signal a concession or counterargument. */
  concessionMarkers: string[];
  /** Proper nouns, years and figures -- a proxy for concrete examples. */
  specificityMarkers: string[];
  /** Formulaic signposting ("Firstly", "In conclusion") -- an LLM/template tell. */
  formulaicMarkers: string[];
  /** Hard problems that make a score of 0 or 1 near-certain. */
  flags: PrecheckFlag[];
}

export type PrecheckFlag =
  | "empty"
  | "off_topic"
  | "extremely_short"
  | "single_paragraph"
  | "copies_prompt";

export interface AxisAssessment {
  axis: RubricAxis;
  /** Which score point's descriptor this axis best matches. */
  score: number;
  /** Quoted evidence from the essay supporting that judgement. */
  evidence: string;
  reasoning: string;
}

export interface AnchorComparison {
  /** Anchor ids from kb/anchors.json this response was weighed against. */
  comparedWith: string[];
  closestAnchorId: string;
  /** Why it sits above, below or level with that anchor. */
  reasoning: string;
  relativePosition: "above" | "level" | "below";
}

export interface ComplianceCheck {
  variant: TaskVariant;
  moves: Array<{
    move: string;
    addressed: boolean;
    evidence: string;
  }>;
}

export interface Suggestion {
  /** Ordered by how much the fix would move the score. */
  priority: 1 | 2 | 3;
  axis: RubricAxis;
  problem: string;
  fix: string;
  /** A concrete rewrite of one sentence or passage, where applicable. */
  example: string;
}

export interface Review {
  holisticScore: number;
  /** Half-point band the grader is confident the essay falls in. */
  confidenceRange: [number, number];
  axisAssessments: AxisAssessment[];
  compliance: ComplianceCheck;
  anchorComparison: AnchorComparison;
  /** Assessment in the voice of the published ETS rater commentary. */
  raterCommentary: string;
  suggestions: Suggestion[];
}

/** A full reviewer run, including the parts that never touched a model. */
export interface ReviewResult {
  review: Review;
  precheck: Precheck;
  prompt: PromptSpec;
  /** Per-sample holistic scores when self-consistency sampling is on. */
  samples: number[];
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    calls: number;
  };
}
