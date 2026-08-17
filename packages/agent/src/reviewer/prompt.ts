/**
 * Prompt assembly for the reviewer.
 *
 * The system prefix is deliberately built from constants and kb/ only. It must
 * be byte-identical on every request or prompt caching silently stops working
 * and input cost goes up ~10x. Nothing request-specific -- no essay, no
 * prompt, no timestamp, no user id -- may appear in `buildSystem()`.
 *
 * `buildUserContent()` holds everything that varies. It sits after the cache
 * breakpoint, so it is free to change.
 */

import { kb } from "../kb.ts";
import type { Precheck, PromptSpec } from "../types.ts";
import { formatPrecheck } from "./precheck.ts";
import type { SystemBlock } from "../providers/types.ts";

const ROLE = `You are an experienced GRE Analytical Writing rater scoring responses to the "Analyze an Issue" task.

You apply the official ETS scoring guide, reproduced below, and you calibrate against officially scored sample responses, also reproduced below. Your judgements must be traceable to those two things rather than to a general impression of quality.

How to score:

- Score the response as a first draft written under a 30-minute time limit, which is what it is. The guide states explicitly that even a 6 may contain minor errors. Do not grade it as though it were polished prose.
- Judge each rubric axis on its own evidence before forming an overall score.
- Quote the response when you cite evidence. Do not paraphrase and present it as a quotation.
- The first rubric criterion is scored "in accordance with the assigned task". A fluent, well-written response that does not perform the moves its task instruction requires cannot score in the top band, however good the prose is.

Calibration, in both directions:

- The top of the scale is real and is awarded regularly. Three of the anchors below carry an official score of 6 from ETS raters. Read what they actually are: strong first drafts produced in thirty minutes, with visible minor flaws. A response that does what those do is a 6. Do not reserve the top band for a quality no real test taker produces. This is the most common way a rater goes wrong, and it drags down the entire upper half of the scale.
- A 5 is not a more polite way of saying 6, and a 4 is not a more polite way of saying 5. Each score point has its own descriptor in the guide and its own anchors below. Put the response at the point whose descriptor and anchors it actually matches, not one point below out of caution.
- The same discipline applies at the bottom. A 1 and a 2 are real score points for responses that meet those descriptors, not verdicts to be softened.
- Identify the anchor the response most resembles before you settle on a number, and let that anchor's official score be your starting point. Move off it only for a difference you can name.

What must not influence the score:

- Length. Longer officially scored responses do tend to earn higher scores, but length is a symptom of development, not a criterion. A short response that fully develops a position outscores a long one that repeats itself. Never reason from word count to a score.
- Whether you agree with the position taken. Any position is available at any score point.
- Vocabulary display. The guide rewards precise and effective language, not unusual words.
- Handwriting-style surface features you cannot observe, such as formatting or presentation.

You will be given deterministic measurements of the response (length, discourse markers, topical overlap). Treat them as evidence to weigh, not as verdicts. They are computed mechanically and are blind to argument quality.`;

function renderRubric(): string {
  const { rubric } = kb();
  const axes = rubric.axes
    .map((axis) => `- ${axis.id} (${axis.name}): ${axis.note}`)
    .join("\n");

  const levels = rubric.levels
    .map((level) => {
      const criteria = level.criteria
        .map((c) => `  - [${c.axis}] ${c.descriptor}`)
        .join("\n");
      return `SCORE ${level.score}\n${level.summary}${criteria ? `\n${criteria}` : ""}`;
    })
    .join("\n\n");

  return `# Official ETS scoring guide: Analyze an Issue\n\nSource: ${rubric.source}\n\nRubric axes:\n${axes}\n\n${rubric.note}\n\n${levels}`;
}

function renderAnchors(exclude: readonly string[] = []): string {
  const { anchors } = kb();

  // Grouped by score, descending, so adjacent bands read next to each other --
  // the distinction that matters most is between neighbouring score points.
  const byScore = [...anchors.anchors]
    .filter((a) => !exclude.includes(a.id))
    .sort((a, b) => b.score - a.score);

  const rendered = byScore
    .map(
      (anchor) => `## Anchor ${anchor.id} -- officially scored ${anchor.score}

Issue statement: ${anchor.prompt_statement}
Task instruction: ${anchor.prompt_instruction}

RESPONSE:
${anchor.essay}

OFFICIAL RATER COMMENTARY:
${anchor.rater_commentary}`,
    )
    .join("\n\n---\n\n");

  return `# Officially scored anchor responses

These are real test-taker responses published by ETS with the commentary of the raters who scored them, reproduced exactly as written including any errors. Three responses are shown at each score point from 6 down to 1.

Use them for calibration: before committing to a score, identify which anchor the response under review is most similar to in quality, and say why it sits above, level with, or below it. Note that the anchors answer three different issue statements, so compare on quality of analysis and execution, never on subject matter.

The commentary also models the register your own assessment should use.

${rendered}`;
}

export interface SystemOptions {
  /**
   * Anchor ids to leave out of the grader's context. Used only by the eval
   * harness, for leave-one-out scoring: without it, grading one of the 18
   * official responses measures whether the grader can find the answer in its
   * own prompt, not whether it can judge. Excluding the item under test turns
   * all 26 gold items into genuinely held-out evaluations.
   *
   * The cost is a prompt-cache miss per item, since the prefix changes. That
   * is the right trade for an eval that runs occasionally, and the wrong one
   * for production -- leave this empty on the serving path.
   */
  excludeAnchorIds?: readonly string[];
}

/**
 * The cacheable system prefix. With no options it is identical for every
 * review, which is what makes prompt caching work.
 *
 * Roughly 9k tokens across three blocks; the breakpoint goes on the last one,
 * which caches all three together. Verify it is working by checking that
 * `usage.cachedInputTokens` is non-zero from the second request onward.
 */
export function buildSystem(options: SystemOptions = {}): SystemBlock[] {
  return [
    { text: ROLE },
    { text: renderRubric() },
    { text: renderAnchors(options.excludeAnchorIds ?? []), cacheable: true },
  ];
}

/** Everything that varies per request. Never cached. */
export function buildUserContent(input: {
  essay: string;
  prompt: PromptSpec;
  precheckResult: Precheck;
}): string {
  const { essay, prompt, precheckResult } = input;

  const moves = prompt.requiredMoves.map((move, i) => `${i + 1}. ${move}`).join("\n");

  return `# The prompt this response was written to

Issue statement:
${prompt.statement}

Task instruction:
${prompt.instruction}

Task variant: ${prompt.variant}

This variant requires the response to:
${moves}

# Deterministic measurements

${formatPrecheck(precheckResult)}

# The response to score

<response>
${essay}
</response>

Score this response against the scoring guide, calibrating against the anchors. Work in the order the output schema specifies: establish task compliance, then judge each axis on its own evidence, then compare against the anchors, and only then commit to an overall score.`;
}
