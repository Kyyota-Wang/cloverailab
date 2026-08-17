/**
 * The reviewer pipeline.
 *
 * Four steps, but only one model call: the deterministic precheck runs first,
 * then a single structured-output call whose schema forces the grader to work
 * through compliance -> per-axis evidence -> anchor comparison before it
 * commits to a score. Splitting those into separate calls would triple the
 * output cost, which is ~85% of the bill, for no guaranteed calibration gain.
 * Whether the split is worth it is a question for the eval harness.
 */

import { resolvePrompt } from "../kb.ts";
import { createProvider, type LLMProvider } from "../providers/index.ts";
import { RUBRIC_AXES, type Review, type ReviewResult, type TaskVariant } from "../types.ts";
import { isMechanicalZero, precheck } from "./precheck.ts";
import { buildSystem, buildUserContent } from "./prompt.ts";
import { REVIEW_SCHEMA } from "./schema.ts";

export interface ReviewOptions {
  essay: string;
  statement: string;
  instruction?: string;
  variant?: TaskVariant;
  /**
   * How many times to score, taking the median. Repeated identical calls vary
   * because current models expose no temperature control and sample by
   * default. Costs scale linearly; 1 until the eval says otherwise.
   */
  samples?: number;
  provider?: LLMProvider;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Caps thinking and output together. Too low truncates mid-review. */
  maxTokens?: number;
  /**
   * Anchor ids to withhold from the grader's context. Eval only -- see
   * SystemOptions. Costs a prompt-cache miss.
   */
  excludeAnchorIds?: readonly string[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 2) / 2;
}

/**
 * Parse the grader's JSON and normalise it to the shape the rest of the code
 * uses.
 *
 * The wire schema keys the axis judgements by axis name and expresses the
 * confidence band as {low, high}, because structured outputs cannot enforce
 * "exactly five items" or "exactly two items" on an array. Both are converted
 * back to the array/tuple forms in types.ts here, so that constraint stays a
 * detail of the schema rather than leaking into every consumer.
 */
function parseReview(text: string): Review {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `Grader returned text that is not JSON. First 200 characters: ${text.slice(0, 200)}`,
      { cause },
    );
  }

  const raw = parsed as Record<string, any>;
  if (typeof raw["holisticScore"] !== "number") {
    throw new Error("Grader response has no numeric holisticScore.");
  }

  const byAxis = raw["axisAssessments"] as
    | Record<string, { score: number; evidence: string; reasoning: string }>
    | undefined;
  if (!byAxis || typeof byAxis !== "object") {
    throw new Error("Grader response has no axisAssessments.");
  }

  const axisAssessments = RUBRIC_AXES.map((axis) => {
    const entry = byAxis[axis];
    if (!entry) throw new Error(`Grader response is missing the "${axis}" axis.`);
    return {
      axis,
      score: entry.score,
      evidence: entry.evidence,
      reasoning: entry.reasoning,
    };
  });

  const band = raw["confidenceRange"] as { low: number; high: number } | undefined;
  const confidenceRange: [number, number] = band
    ? [band.low, band.high]
    : [raw["holisticScore"], raw["holisticScore"]];

  return {
    holisticScore: raw["holisticScore"],
    confidenceRange,
    axisAssessments,
    compliance: raw["compliance"],
    anchorComparison: raw["anchorComparison"],
    raterCommentary: raw["raterCommentary"],
    suggestions: raw["suggestions"] ?? [],
  };
}

/** A review of a response that the ETS guide defines as a zero mechanically. */
function mechanicalZeroReview(reason: string): Review {
  return {
    holisticScore: 0,
    confidenceRange: [0, 0],
    axisAssessments: [],
    compliance: { variant: "statement", moves: [] },
    anchorComparison: {
      comparedWith: [],
      closestAnchorId: "",
      relativePosition: "below",
      reasoning: "Not applicable: scored 0 on mechanical grounds.",
    },
    raterCommentary:
      `This response receives a score of 0. The ETS scoring guide assigns 0 to a response that is ` +
      `off topic, written in a foreign language, merely copies the topic, consists of only keystroke ` +
      `characters, or is illegible or nonverbal. ${reason}`,
    suggestions: [
      {
        priority: 1,
        axis: "position",
        problem: "The submission does not respond to the assigned topic.",
        fix: "Write a response that takes a position on the issue statement and supports it.",
        example: "",
      },
    ],
  };
}

export async function review(options: ReviewOptions): Promise<ReviewResult> {
  const prompt = resolvePrompt({
    statement: options.statement,
    ...(options.instruction !== undefined ? { instruction: options.instruction } : {}),
    ...(options.variant !== undefined ? { variant: options.variant } : {}),
  });

  const precheckResult = precheck(options.essay, prompt);

  // ETS defines score 0 mechanically, so there is nothing for a model to judge
  // and no reason to pay for a call.
  if (isMechanicalZero(precheckResult)) {
    const reason = precheckResult.flags.includes("empty")
      ? "The submission is empty."
      : "The submission merely copies the topic.";
    return {
      review: mechanicalZeroReview(reason),
      precheck: precheckResult,
      prompt,
      samples: [0],
      usage: {
        provider: "none",
        model: "none",
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        calls: 0,
      },
    };
  }

  const provider = options.provider ?? createProvider({ role: "reviewer" });
  const sampleCount = Math.max(1, options.samples ?? 1);

  const request = {
    system: buildSystem(
      options.excludeAnchorIds ? { excludeAnchorIds: options.excludeAnchorIds } : {},
    ),
    userContent: buildUserContent({ essay: options.essay, prompt, precheckResult }),
    maxTokens: options.maxTokens ?? 16000,
    jsonSchema: REVIEW_SCHEMA,
    effort: options.effort ?? ("high" as const),
  };

  const usage = {
    provider: provider.name,
    model: provider.model,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    calls: 0,
  };

  const reviews: Review[] = [];
  for (let i = 0; i < sampleCount; i++) {
    // Sequential rather than parallel: the first call writes the prompt cache,
    // and concurrent calls would all miss it and pay full price.
    const result = await provider.complete({ ...request, sampleIndex: i });

    usage.inputTokens += result.usage.inputTokens;
    usage.cachedInputTokens += result.usage.cachedInputTokens;
    usage.cacheWriteTokens += result.usage.cacheWriteTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.calls += 1;

    if (result.refusal) {
      throw new Error(
        `The ${provider.name} safety classifiers declined to score this response ` +
          `(category: ${result.refusal.category ?? "unspecified"}). ` +
          `${result.refusal.explanation ?? ""}`.trim(),
      );
    }

    reviews.push(parseReview(result.text));
  }

  const samples = reviews.map((r) => r.holisticScore);
  const consensus = median(samples);

  // Report the sample whose score is the consensus, so the commentary and the
  // number describe the same reading rather than a blend of several.
  const chosen =
    reviews.find((r) => r.holisticScore === consensus) ??
    reviews.reduce((best, r) =>
      Math.abs(r.holisticScore - consensus) < Math.abs(best.holisticScore - consensus) ? r : best,
    );

  return {
    review: { ...chosen, holisticScore: consensus },
    precheck: precheckResult,
    prompt,
    samples,
    usage,
  };
}

export { precheck, isMechanicalZero } from "./precheck.ts";
export { buildSystem, buildUserContent } from "./prompt.ts";
export { REVIEW_SCHEMA } from "./schema.ts";
