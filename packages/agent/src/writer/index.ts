/**
 * The writer pipeline.
 *
 * One model call. The schema orders the plan before the essay, so the essay
 * is written against a committed position and named examples instead of being
 * discovered a sentence at a time.
 *
 * The draft -> review -> revise loop from the original design is deliberately
 * NOT wired in yet. The reviewer currently scores about half a point harsh and
 * compresses the top of the scale, so looping through it would push the writer
 * to revise against a miscalibrated target -- making the output worse in a way
 * that is hard to see. Turn the loop on once the reviewer's calibration is
 * settled; until then a generated response is judged by reading it.
 */

import { resolvePrompt } from "../kb.ts";
import { createProvider, type LLMProvider } from "../providers/index.ts";
import type { PromptSpec, TaskVariant } from "../types.ts";
import { buildSystem, buildUserContent } from "./prompt.ts";
import { WRITE_SCHEMA } from "./schema.ts";

export interface WriteOptions {
  statement: string;
  instruction?: string;
  variant?: TaskVariant;
  /** Half points from 3 to 6. Below 3 there is nothing instructive to show. */
  targetScore?: number;
  guidance?: string;
  provider?: LLMProvider;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}

export interface WritePlan {
  position: string;
  moveCoverage: Array<{ move: string; plan: string }>;
  bodyParagraphs: Array<{ claim: string; example: string; role: string }>;
  concession: string;
}

export interface WriteResult {
  plan: WritePlan;
  essay: string;
  notes: { targetScore: number; whyThisScores: string; ifAimingHigher: string };
  prompt: PromptSpec;
  wordCount: number;
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
  };
}

const VALID_TARGETS = [3, 3.5, 4, 4.5, 5, 5.5, 6];

export async function write(options: WriteOptions): Promise<WriteResult> {
  const targetScore = options.targetScore ?? 6;
  if (!VALID_TARGETS.includes(targetScore)) {
    throw new Error(
      `targetScore must be one of ${VALID_TARGETS.join(", ")}. Below 3 there is ` +
        `nothing useful to demonstrate -- those bands are defined by what is absent.`,
    );
  }

  const prompt = resolvePrompt({
    statement: options.statement,
    ...(options.instruction !== undefined ? { instruction: options.instruction } : {}),
    ...(options.variant !== undefined ? { variant: options.variant } : {}),
  });

  const provider = options.provider ?? createProvider({ role: "writer" });

  const result = await provider.complete({
    system: buildSystem(),
    userContent: buildUserContent({
      prompt,
      targetScore,
      ...(options.guidance ? { guidance: options.guidance } : {}),
    }),
    maxTokens: options.maxTokens ?? 16000,
    jsonSchema: WRITE_SCHEMA,
    effort: options.effort ?? "high",
  });

  if (result.refusal) {
    throw new Error(
      `The ${provider.name} safety classifiers declined this topic ` +
        `(category: ${result.refusal.category ?? "unspecified"}).`,
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(result.text);
  } catch (cause) {
    throw new Error(
      `Writer returned text that is not JSON. First 200 characters: ${result.text.slice(0, 200)}`,
      { cause },
    );
  }

  const essay = String(parsed.essay ?? "").trim();
  if (!essay) throw new Error("Writer returned an empty essay.");

  return {
    plan: parsed.plan,
    essay,
    notes: parsed.notes ?? {
      targetScore,
      whyThisScores: "",
      ifAimingHigher: "",
    },
    prompt,
    wordCount: (essay.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length,
    usage: {
      provider: provider.name,
      model: provider.model,
      inputTokens: result.usage.inputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      outputTokens: result.usage.outputTokens,
    },
  };
}

export { buildSystem, buildUserContent } from "./prompt.ts";
export { WRITE_SCHEMA } from "./schema.ts";
