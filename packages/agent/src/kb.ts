/**
 * Loader for the knowledge base under kb/.
 *
 * The files are small (235 KB total) and immutable at runtime, so they are
 * read once and cached in module scope. Everything the agents know about ETS
 * comes from here -- no ETS text is inlined anywhere else in the codebase.
 */

import type { PromptSpec, RubricAxis, TaskVariant } from "./types.ts";

export interface RubricCriterion {
  axis: RubricAxis;
  descriptor: string;
}

export interface RubricLevel {
  score: number;
  summary: string;
  criteria: RubricCriterion[];
}

export interface Rubric {
  source: string;
  task: "issue";
  scale: string;
  note: string;
  axes: Array<{ id: RubricAxis; name: string; note: string }>;
  levels: RubricLevel[];
}

export interface Anchor {
  id: string;
  task: "issue";
  score: number;
  score_type: "official";
  prompt_statement: string;
  prompt_instruction: string;
  essay: string;
  rater_commentary: string;
  source_pdf: string;
}

export interface AnchorSet {
  source: string;
  count: number;
  prompts: Array<{
    id: string;
    statement: string;
    instruction: string;
    ets_strategies: string;
  }>;
  anchors: Anchor[];
}

export interface PoolTopic {
  id: string;
  statement: string;
  instruction: string;
  variant: TaskVariant;
  variant_summary: string;
  required_moves: string[];
}

export interface PromptPool {
  source: string;
  count: number;
  variant_counts: Record<TaskVariant, number>;
  topics: PoolTopic[];
}

export interface StyleExemplars {
  task: "issue";
  note: string;
  exemplars: Array<{ anchor_id: string; score: number; role: string }>;
  contrasts: Array<{ anchor_id: string; score: number; role: string }>;
  official_length_by_score: {
    provenance: string;
    basis: string;
    bands: Array<{ score: number; n: number; word_counts: number[]; median_words: number }>;
  };
  human_corpus: {
    provenance: string;
    basis: string;
    caveat: string;
    word_count: Record<string, number>;
    paragraph_count: Record<string, number>;
  };
  anti_patterns: {
    provenance: "authored";
    status: string;
    avoid: Array<{ pattern: string; why: string }>;
    prefer: string[];
  };
}

export interface KnowledgeBase {
  rubric: Rubric;
  anchors: AnchorSet;
  pool: PromptPool;
  style: StyleExemplars;
}

let cache: KnowledgeBase | null = null;
let loader: (() => KnowledgeBase) | null = null;

/**
 * Supply the knowledge base explicitly.
 *
 * Cloudflare Workers have no filesystem, so the Worker imports the four JSON
 * files at build time and injects them here. Node callers do not need this --
 * `registerKbLoader` wires up a filesystem read on first use.
 */
export function setKb(data: KnowledgeBase): void {
  cache = data;
}

/** Register a lazy loader, used by the Node entry point. */
export function registerKbLoader(fn: () => KnowledgeBase): void {
  loader = fn;
}

export function kb(): KnowledgeBase {
  if (!cache) {
    if (!loader) {
      throw new Error(
        "The knowledge base has not been provided. Call setKb() with the kb/*.json " +
          "contents (Workers), or import kb-node.ts before using the agents (Node).",
      );
    }
    cache = loader();
  }
  return cache;
}

/** Anchors at a given integer score, newest source first. */
export function anchorsAtScore(score: number): Anchor[] {
  return kb().anchors.anchors.filter((a) => a.score === score);
}

/** Look up a pool topic by its id. */
export function topicById(id: string): PoolTopic | undefined {
  return kb().pool.topics.find((t) => t.id === id);
}

const VARIANT_PATTERNS: Array<[TaskVariant, RegExp]> = [
  ["claim_and_reason", /reason on which th(?:at|e) claim is based/i],
  ["claim_challenge", /could be used to challenge your position/i],
  ["recommendation", /adopting the recommendation/i],
  ["two_views", /which view more closely aligns/i],
  ["policy", /views on the policy/i],
  ["statement", /agree or disagree with the statement/i],
];

/**
 * Turn a raw prompt into a PromptSpec.
 *
 * Matching is by task instruction, not by topic statement: the pool
 * deliberately reuses 19 statements under more than one instruction, so the
 * statement alone does not determine the variant. Users often paste a topic
 * with the instruction reworded or missing, hence the fallbacks.
 */
export function resolvePrompt(input: {
  statement: string;
  instruction?: string;
  variant?: TaskVariant;
}): PromptSpec {
  const { topics } = kb().pool;

  const byVariant = (variant: TaskVariant): PromptSpec => {
    const template = topics.find((t) => t.variant === variant);
    if (!template) throw new Error(`no pool topic for variant ${variant}`);
    return {
      statement: input.statement,
      instruction: input.instruction?.trim() || template.instruction,
      variant,
      requiredMoves: template.required_moves,
    };
  };

  if (input.variant) return byVariant(input.variant);

  if (input.instruction) {
    for (const [variant, pattern] of VARIANT_PATTERNS) {
      if (pattern.test(input.instruction)) return byVariant(variant);
    }
  }

  // No usable instruction: fall back to an exact statement match in the pool.
  const normalised = input.statement.replace(/\s+/g, " ").trim().toLowerCase();
  const matches = topics.filter(
    (t) => t.statement.replace(/\s+/g, " ").trim().toLowerCase() === normalised,
  );
  if (matches.length === 1) {
    const only = matches[0]!;
    return {
      statement: only.statement,
      instruction: only.instruction,
      variant: only.variant,
      requiredMoves: only.required_moves,
    };
  }

  throw new Error(
    matches.length > 1
      ? `That topic appears in the pool under ${matches.length} different task ` +
        `instructions (${matches.map((m) => m.variant).join(", ")}). Pass the ` +
        `instruction text or an explicit variant -- the required moves differ.`
      : "Cannot determine the task variant. Pass the task instruction text " +
        "(the 'Write a response in which...' paragraph) or an explicit variant.",
  );
}
