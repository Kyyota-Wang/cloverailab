/**
 * Deterministic signals about a response, computed without an LLM.
 *
 * These are *evidence for* the grader, never a verdict. Nothing here assigns
 * or adjusts a score: the checks are cheap, mechanical, and blind to argument
 * quality, so letting them influence the number would encode exactly the
 * shortcuts the rubric warns against. The one thing they do decide is the
 * short-circuit for responses that are empty or off-topic, which the ETS
 * guide defines mechanically at score 0.
 */

import type { Precheck, PrecheckFlag, PromptSpec } from "../types.ts";

/** Discourse markers that introduce a concession or counterargument. */
const CONCESSION = [
  "however", "although", "though", "while it is true", "admittedly",
  "granted", "critics", "opponents", "some argue", "some may argue",
  "one might object", "on the other hand", "conversely", "nevertheless",
  "nonetheless", "to be sure", "detractors", "skeptics", "concede",
  "counterargument", "despite", "in spite of", "yet",
];

/**
 * Formulaic signposting. Common in template-taught and LLM-written prose;
 * the official score-6 responses transition through content instead.
 */
const FORMULAIC = [
  "firstly", "secondly", "thirdly", "lastly", "in conclusion",
  "to conclude", "in summary", "to sum up", "this essay will",
  "i will argue", "first of all", "last but not least", "moreover",
  "furthermore", "in today's world", "in modern society", "since the dawn",
  "multifaceted", "delve into", "plays a pivotal role", "it is worth noting",
];

/** Words too common to signal topical overlap. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at",
  "for", "with", "by", "from", "as", "is", "are", "was", "were", "be", "been",
  "being", "that", "this", "these", "those", "it", "its", "they", "them",
  "their", "we", "our", "you", "your", "he", "she", "his", "her", "not",
  "no", "can", "could", "will", "would", "should", "may", "might", "must",
  "do", "does", "did", "have", "has", "had", "than", "then", "so", "such",
  "more", "most", "some", "any", "all", "there", "which", "who", "what",
  "when", "where", "how", "why", "about", "into", "through", "during",
  "own", "same", "other", "only", "also", "very", "one", "two", "people",
]);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
}

function contentWords(text: string): Set<string> {
  return new Set(words(text).filter((w) => w.length > 3 && !STOPWORDS.has(w)));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])["')\]]*\s+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z]/i.test(s));
}

function splitParagraphs(text: string): string[] {
  const byBlankLine = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (byBlankLine.length > 1) return byBlankLine;
  // Some submissions use single newlines as paragraph breaks.
  const byLine = text.split(/\n/).map((p) => p.trim()).filter(Boolean);
  return byLine.length > 1 ? byLine : byBlankLine;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((total, v) => total + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function findMarkers(haystack: string, needles: string[]): string[] {
  const lower = ` ${haystack.toLowerCase()} `;
  return needles.filter((needle) => {
    const pattern = new RegExp(`(?<![a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`);
    return pattern.test(lower);
  });
}

/**
 * Proper nouns, years and figures: a proxy for concrete, checkable examples.
 * The gap between a score 5 and a score 6 usually turns on whether examples
 * are specific, so this is worth surfacing even though it is only a proxy.
 */
function findSpecificity(essay: string): string[] {
  const found = new Set<string>();

  for (const sentence of splitSentences(essay)) {
    // Skip the first token: sentence-initial capitals carry no information.
    const tokens = sentence.split(/\s+/).slice(1);
    for (const token of tokens) {
      const cleaned = token.replace(/[^A-Za-z'-]/g, "");
      if (cleaned.length > 2 && /^[A-Z][a-z]/.test(cleaned)) found.add(cleaned);
    }
  }
  for (const year of essay.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) ?? []) found.add(year);
  for (const figure of essay.match(/\b\d+(?:\.\d+)?\s?(?:percent|%|million|billion)\b/gi) ?? []) {
    found.add(figure.trim());
  }
  return [...found].slice(0, 25);
}

export interface PrecheckOptions {
  /**
   * Overlap below this fraction of the statement's content words reads as off
   * topic. The floor across the 18 official anchors of 50+ words is 0.25, so
   * 0.15 leaves margin while still catching genuinely unrelated prose.
   */
  offTopicThreshold?: number;
}

export function precheck(
  essay: string,
  prompt: PromptSpec,
  options: PrecheckOptions = {},
): Precheck {
  const offTopicThreshold = options.offTopicThreshold ?? 0.15;
  const trimmed = essay.trim();

  const essayWords = words(trimmed);
  const paragraphs = splitParagraphs(trimmed);
  const sentences = splitSentences(trimmed);
  const sentenceLengths = sentences.map((s) => words(s).length);

  // Measured against the issue statement only. The task instruction is fixed
  // boilerplate ("developing", "supporting", "compelling", "position") that no
  // response repeats, so including it roughly halves every reading and
  // compresses the range: across the 18 official anchors it pushed a genuine
  // score-3 response down to 0.10, below any usable off-topic threshold.
  const promptWords = contentWords(prompt.statement);
  const essayWordSet = new Set(essayWords);
  const shared = [...promptWords].filter((w) => essayWordSet.has(w));
  const promptOverlap = promptWords.size ? shared.length / promptWords.size : 0;

  // A response that opens by parroting the prompt is called out by name in the
  // published ETS commentary as a low-score signal.
  const firstSentence = sentences[0] ?? "";
  const firstWords = contentWords(firstSentence);
  const statementWords = contentWords(prompt.statement);
  const echoed = [...firstWords].filter((w) => statementWords.has(w)).length;
  const opensByRestatingPrompt =
    firstWords.size >= 4 && statementWords.size > 0 && echoed / Math.min(firstWords.size, statementWords.size) >= 0.7;

  const flags: PrecheckFlag[] = [];
  if (essayWords.length === 0) flags.push("empty");
  if (essayWords.length > 0 && essayWords.length < 50) flags.push("extremely_short");
  if (essayWords.length >= 50 && promptOverlap < offTopicThreshold) flags.push("off_topic");
  if (paragraphs.length === 1 && essayWords.length > 150) flags.push("single_paragraph");

  // "Merely copies the topic" is one of ETS's explicit score-0 conditions.
  const normalisedEssay = trimmed.replace(/\s+/g, " ").toLowerCase();
  const normalisedPrompt = prompt.statement.replace(/\s+/g, " ").toLowerCase();
  if (normalisedEssay.length > 0 && normalisedPrompt.includes(normalisedEssay.slice(0, 200))) {
    flags.push("copies_prompt");
  }

  return {
    wordCount: essayWords.length,
    paragraphCount: paragraphs.length,
    sentenceCount: sentences.length,
    meanSentenceWords: sentences.length
      ? Math.round((essayWords.length / sentences.length) * 10) / 10
      : 0,
    sentenceLengthStdev: Math.round(stdev(sentenceLengths) * 10) / 10,
    promptOverlap: Math.round(promptOverlap * 100) / 100,
    opensByRestatingPrompt,
    concessionMarkers: findMarkers(trimmed, CONCESSION),
    specificityMarkers: findSpecificity(trimmed),
    formulaicMarkers: findMarkers(trimmed, FORMULAIC),
    flags,
  };
}

/**
 * The only case where the precheck decides a score outright: ETS defines
 * score 0 mechanically (off topic, copies the topic, non-verbal), so no model
 * call is needed and none should be paid for.
 */
export function isMechanicalZero(result: Precheck): boolean {
  return result.flags.includes("empty") || result.flags.includes("copies_prompt");
}

/** Render the signals for the grader prompt, as evidence rather than verdicts. */
export function formatPrecheck(result: Precheck): string {
  const list = (items: string[]) => (items.length ? items.join(", ") : "none found");
  return [
    `Length: ${result.wordCount} words, ${result.paragraphCount} paragraph(s), ${result.sentenceCount} sentences.`,
    `Sentence length: mean ${result.meanSentenceWords} words, standard deviation ${result.sentenceLengthStdev}.`,
    `Topical overlap with the prompt: ${(result.promptOverlap * 100).toFixed(0)}% of prompt content words appear in the response.`,
    `Opens by restating the prompt: ${result.opensByRestatingPrompt ? "yes" : "no"}.`,
    `Concession/counterargument markers: ${list(result.concessionMarkers)}.`,
    `Proper nouns, dates and figures: ${list(result.specificityMarkers)}.`,
    `Formulaic signposting: ${list(result.formulaicMarkers)}.`,
    result.flags.length ? `Mechanical flags: ${result.flags.join(", ")}.` : "Mechanical flags: none.",
  ].join("\n");
}
