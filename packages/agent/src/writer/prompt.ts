/**
 * Prompt assembly for the writer.
 *
 * The problem this prompt exists to solve is that an LLM's default essay is
 * recognisably an LLM's essay: evenly weighted paragraphs, signposting at
 * every joint, abstract examples, and a concession that concedes nothing. The
 * official score-6 responses do none of that, so they are shown in full and
 * the specific failure modes are named.
 *
 * Cache discipline is the same as the reviewer's: `buildSystem()` must be
 * byte-identical across requests. The target score varies per request, so it
 * lives in the user content -- which is also why every score band's exemplars
 * are in the stable prefix rather than only the requested one.
 */

import { kb } from "../kb.ts";
import type { PromptSpec } from "../types.ts";
import type { SystemBlock } from "../providers/types.ts";

const ROLE = `You are producing example responses to the GRE "Analyze an Issue" task, for people studying for the test.

What you are writing is a response produced by a capable test taker in thirty minutes, under exam conditions, typed into a plain text box. It is a strong first draft. It is not an essay you had a week to polish, and it should not read like one.

Two things make a response score well, and they are not the things people assume:

1. It performs the moves its specific task instruction requires. The six Issue instruction variants ask for materially different things, and the scoring guide's first criterion is scored "in accordance with the assigned task". A beautifully written response that answers a different question than the one asked cannot reach the top band.

2. Its examples are specific and load-bearing. The distance between a 5 and a 6 is usually the difference between an example that illustrates a claim and an example the argument actually rests on. Name real cases: particular events, people, works, institutions, documented situations. "A certain company" and "studies have shown" are what a 4 does.

Write the plan before the essay, and then write the essay the plan describes.`;

const ANTI_PATTERNS = `# Write like a person, not like a language model

These are the tells that mark a response as machine-written. Avoid all of them.

- Even paragraphs. Real strong responses are lopsided: the best idea gets the most room. Do not produce three body paragraphs of similar length.
- Signposting at every joint: "Firstly", "Moreover", "Furthermore", "In conclusion". The official score-6 responses transition through content -- the next idea follows from the last one, and nothing announces it.
- Announcing the essay: "This essay will argue that..." Just argue it.
- Abstract examples: "a certain study", "many organisations", "throughout history". Name the case or drop it.
- Register inflation: "multifaceted", "delve into", "plays a pivotal role", "in today's rapidly evolving world", "navigate the complexities of". These read as vocabulary display, which the guide does not reward.
- A concession that concedes nothing and is dismissed in the next clause. If the objection is not genuinely strong, it is not worth raising.
- Opening by restating the prompt. The published rater commentary names this as a low-score signal.
- Flawless mechanics across six hundred words. Even officially scored 6s contain minor errors -- the guide says so. Do not manufacture errors, but do not sand every sentence to a uniform polish either.
- A closing paragraph that only summarises. Land somewhere the essay had not already been.

Vary sentence length deliberately. A short sentence after a long one carries weight. Uniform sentence rhythm is one of the strongest machine tells there is.`;

function renderRubric(): string {
  const { rubric } = kb();
  const levels = rubric.levels
    .filter((level) => level.score >= 3)
    .map((level) => {
      const criteria = level.criteria.map((c) => `  - [${c.axis}] ${c.descriptor}`).join("\n");
      return `SCORE ${level.score}\n${level.summary}${criteria ? `\n${criteria}` : ""}`;
    })
    .join("\n\n");

  return `# What each score point means\n\nSource: ${rubric.source}\n\n${levels}`;
}

/**
 * Officially scored responses at 6, 5, 4 and 3.
 *
 * All bands are included regardless of the requested target, so that the
 * cached prefix does not change when the target does. The 6s are the model to
 * imitate; the lower bands show what falling short actually looks like, which
 * matters when the request is for a deliberately imperfect response.
 */
function renderExemplars(): string {
  const { anchors } = kb();
  const shown = anchors.anchors
    .filter((anchor) => anchor.score >= 3)
    .sort((a, b) => b.score - a.score);

  const rendered = shown
    .map(
      (anchor) => `## ${anchor.id} -- officially scored ${anchor.score}

Issue statement: ${anchor.prompt_statement}
Task instruction: ${anchor.prompt_instruction}

RESPONSE:
${anchor.essay}

WHAT THE ETS RATERS SAID:
${anchor.rater_commentary}`,
    )
    .join("\n\n---\n\n");

  return `# Real responses, with the official rater commentary

These are actual test-taker responses published by ETS, reproduced exactly as written, errors included. Read them for register and shape, not for content -- they answer different prompts.

Note what the 6s do and do not do. They are not flawless. They commit early, they develop one idea properly rather than three superficially, and their examples are specific.

${rendered}`;
}

function renderLengthGuidance(): string {
  const { style } = kb();
  const bands = style.official_length_by_score.bands
    .filter((band) => band.score >= 3)
    .map((band) => `- Score ${band.score}: median ${band.median_words} words (observed: ${band.word_counts.join(", ")})`)
    .join("\n");

  const corpus = style.human_corpus;
  return `# Length, as observed rather than prescribed

Officially scored responses, by score point:
${bands}

Across ${corpus.basis}: median ${corpus.word_count["median"]} words, with the middle half between ${corpus.word_count["p25"]} and ${corpus.word_count["p75"]}. Paragraph count: median ${corpus.paragraph_count["median"]}.

Length correlates with score because developed arguments take room, but it is not itself a criterion. Do not pad to hit a number. A response that says what it needs to in 480 words is better than the same argument stretched to 700.`;
}

/** The cacheable system prefix. Identical for every request. */
export function buildSystem(): SystemBlock[] {
  return [
    { text: ROLE },
    { text: renderRubric() },
    { text: ANTI_PATTERNS },
    { text: renderLengthGuidance() },
    { text: renderExemplars(), cacheable: true },
  ];
}

export interface WriteRequest {
  prompt: PromptSpec;
  targetScore: number;
  /** Optional steer, e.g. "argue against" or "use an example from science". */
  guidance?: string;
}

/** Everything that varies per request. Never cached. */
export function buildUserContent(request: WriteRequest): string {
  const { prompt, targetScore, guidance } = request;
  const moves = prompt.requiredMoves.map((move, i) => `${i + 1}. ${move}`).join("\n");

  const targetNote =
    targetScore >= 6
      ? `Write a response that would earn a 6. Match what the score-6 exemplars actually do.`
      : `Write a response that would earn a ${targetScore}, not higher.

This is for study, so the shortfall must be real and instructive: the response should fall short the way real responses at this band fall short, according to the scoring guide's descriptors for score ${targetScore}. Look at the officially scored ${Math.floor(targetScore)} exemplars above and match that level of development, specificity and control.

Do not simulate a weaker response by making it shorter, by inserting deliberate typos, or by writing badly on purpose. A ${targetScore} is a competent response with identifiable limits -- thinner development, more generic examples, a position that is stated but less fully defended -- not a mangled one.`;

  return `# The task

Issue statement:
${prompt.statement}

Task instruction:
${prompt.instruction}

Task variant: ${prompt.variant}

This variant requires the response to:
${moves}

# What to produce

${targetNote}
${guidance ? `\nAdditional direction from the person requesting this: ${guidance}\n` : ""}
Plan first, then write. The plan must name the specific examples the essay will use before the essay is written, and the essay must use them.`;
}
