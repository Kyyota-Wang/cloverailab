import "../src/kb-node.ts";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSystem, buildUserContent } from "../src/reviewer/prompt.ts";
import { REVIEW_SCHEMA } from "../src/reviewer/schema.ts";
import { review } from "../src/reviewer/index.ts";
import { precheck } from "../src/reviewer/precheck.ts";
import { kb, resolvePrompt } from "../src/kb.ts";
import { RUBRIC_AXES } from "../src/types.ts";
import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
} from "../src/providers/types.ts";

const ANCHOR = kb().anchors.anchors.find((a) => a.score === 5)!;
const PROMPT = resolvePrompt({
  statement: ANCHOR.prompt_statement,
  instruction: ANCHOR.prompt_instruction,
});

/** Records what it was asked, and returns whatever score it was told to. */
class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-1";
  readonly requests: CompletionRequest[] = [];
  #scores: number[];

  constructor(scores: number[]) {
    this.#scores = scores;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    const score = this.#scores[this.requests.length - 1] ?? this.#scores.at(-1) ?? 4;
    return {
      text: JSON.stringify({
        compliance: { variant: "statement", moves: [{ move: "m", addressed: true, evidence: "e" }] },
        axisAssessments: Object.fromEntries(
          RUBRIC_AXES.map((axis) => [
            axis,
            { score: Math.round(score), evidence: "quoted", reasoning: "because" },
          ]),
        ),
        anchorComparison: {
          comparedWith: [ANCHOR.id],
          closestAnchorId: ANCHOR.id,
          relativePosition: "level",
          reasoning: "similar development",
        },
        holisticScore: score,
        confidenceRange: { low: score - 0.5, high: score + 0.5 },
        raterCommentary: `commentary for ${score}`,
        suggestions: [
          { priority: 1, axis: "development", problem: "p", fix: "f", example: "x" },
        ],
      }),
      usage: { inputTokens: 9000, cachedInputTokens: 8500, cacheWriteTokens: 0, outputTokens: 1200 },
    };
  }
}

describe("prompt assembly: the caching invariant", () => {
  test("the system prefix is byte-identical across calls", () => {
    const a = buildSystem();
    const b = buildSystem();
    assert.deepEqual(a, b, "system prefix must not vary between requests");
  });

  test("exactly one cache breakpoint, on the final block", () => {
    const system = buildSystem();
    const marked = system.filter((block) => block.cacheable);
    assert.equal(marked.length, 1);
    assert.equal(system.at(-1)!.cacheable, true);
  });

  test("the prefix carries no request-specific content", () => {
    const joined = buildSystem().map((b) => b.text).join("\n");
    // A date, a uuid or an essay in the prefix would void the cache silently.
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(joined), "prefix contains a timestamp");
    assert.ok(
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(joined),
      "prefix contains a uuid",
    );
  });

  test("the prefix is large enough to be worth caching", () => {
    const chars = buildSystem().reduce((n, b) => n + b.text.length, 0);
    // Well past the 1024-token minimum cacheable prefix on every model used.
    assert.ok(chars > 20000, `prefix is only ${chars} characters`);
  });

  test("the prefix contains the rubric and all 18 anchors", () => {
    const joined = buildSystem().map((b) => b.text).join("\n");
    for (const level of kb().rubric.levels) {
      assert.ok(joined.includes(`SCORE ${level.score}`), `missing score ${level.score}`);
    }
    for (const anchor of kb().anchors.anchors) {
      assert.ok(joined.includes(anchor.id), `missing anchor ${anchor.id}`);
      assert.ok(joined.includes(anchor.rater_commentary.slice(0, 60)), `missing commentary for ${anchor.id}`);
    }
  });

  test("user content carries the essay and the required moves", () => {
    const content = buildUserContent({
      essay: "The essay body.",
      prompt: PROMPT,
      precheckResult: precheck("The essay body.", PROMPT),
    });
    assert.ok(content.includes("The essay body."));
    assert.ok(content.includes(PROMPT.statement));
    for (const move of PROMPT.requiredMoves) assert.ok(content.includes(move));
  });
});

describe("review schema", () => {
  test("orders evidence before the score", () => {
    const keys = Object.keys(REVIEW_SCHEMA["properties"] as object);
    const before = ["compliance", "axisAssessments", "anchorComparison"];
    for (const key of before) {
      assert.ok(
        keys.indexOf(key) < keys.indexOf("holisticScore"),
        `${key} must be generated before holisticScore`,
      );
    }
  });

  test("uses no JSON Schema keyword structured outputs rejects", () => {
    // The API returns a 400 for these, one keyword per request, which is a
    // slow way to find them. Walking the schema locally catches them all.
    const banned = ["minimum", "maximum", "multipleOf", "minLength", "maxLength", "maxItems"];
    const offences: string[] = [];

    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${path}[${i}]`));
        return;
      }
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (banned.includes(key)) offences.push(`${path}.${key}`);
        if (key === "minItems" && typeof value === "number" && value > 1) {
          offences.push(`${path}.minItems=${value} (only 0 or 1 are supported)`);
        }
        walk(value, `${path}.${key}`);
      }
    };

    walk(REVIEW_SCHEMA, "schema");
    assert.deepEqual(offences, [], `unsupported keywords: ${offences.join(", ")}`);
  });

  test("every axis is a required property, so completeness is structural", () => {
    const axes = (REVIEW_SCHEMA["properties"] as any).axisAssessments;
    assert.deepEqual([...axes.required].sort(), [...RUBRIC_AXES].sort());
    assert.equal(axes.additionalProperties, false);
  });

  test("scores are constrained to valid half points", () => {
    const holistic = (REVIEW_SCHEMA["properties"] as any).holisticScore;
    assert.deepEqual(holistic.enum.at(0), 0);
    assert.deepEqual(holistic.enum.at(-1), 6);
    assert.ok(!holistic.enum.includes(0.25), "quarter points are not valid GRE scores");
  });
});

describe("review pipeline", () => {
  test("returns a score without touching a real provider", async () => {
    const provider = new MockProvider([5]);
    const result = await review({
      essay: ANCHOR.essay,
      statement: ANCHOR.prompt_statement,
      instruction: ANCHOR.prompt_instruction,
      provider,
    });
    assert.equal(result.review.holisticScore, 5);
    assert.equal(result.usage.calls, 1);
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0]!.jsonSchema, REVIEW_SCHEMA);
  });

  test("self-consistency takes the median and keeps the matching commentary", async () => {
    const provider = new MockProvider([4, 5, 5]);
    const result = await review({
      essay: ANCHOR.essay,
      statement: ANCHOR.prompt_statement,
      instruction: ANCHOR.prompt_instruction,
      provider,
      samples: 3,
    });
    assert.deepEqual(result.samples, [4, 5, 5]);
    assert.equal(result.review.holisticScore, 5);
    assert.equal(result.review.raterCommentary, "commentary for 5");
    assert.equal(result.usage.calls, 3);
  });

  test("accumulates usage across samples", async () => {
    const result = await review({
      essay: ANCHOR.essay,
      statement: ANCHOR.prompt_statement,
      instruction: ANCHOR.prompt_instruction,
      provider: new MockProvider([4, 4]),
      samples: 2,
    });
    assert.equal(result.usage.cachedInputTokens, 17000);
    assert.equal(result.usage.outputTokens, 2400);
  });

  test("scores a mechanical zero without calling the provider at all", async () => {
    const provider = new MockProvider([6]);
    const result = await review({
      essay: ANCHOR.prompt_statement,
      statement: ANCHOR.prompt_statement,
      instruction: ANCHOR.prompt_instruction,
      provider,
    });
    assert.equal(result.review.holisticScore, 0);
    assert.equal(provider.requests.length, 0, "must not pay for a mechanical zero");
    assert.equal(result.usage.calls, 0);
  });

  test("surfaces a provider refusal rather than returning a score", async () => {
    const refusing: LLMProvider = {
      name: "mock",
      model: "mock-1",
      async complete() {
        return {
          text: "",
          usage: { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          refusal: { category: "test", explanation: "nope" },
        };
      },
    };
    await assert.rejects(
      review({
        essay: ANCHOR.essay,
        statement: ANCHOR.prompt_statement,
        instruction: ANCHOR.prompt_instruction,
        provider: refusing,
      }),
      /declined to score/,
    );
  });

  test("rejects a malformed grader response", async () => {
    const broken: LLMProvider = {
      name: "mock",
      model: "mock-1",
      async complete() {
        return {
          text: "I think this is about a 5, honestly.",
          usage: { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
        };
      },
    };
    await assert.rejects(
      review({
        essay: ANCHOR.essay,
        statement: ANCHOR.prompt_statement,
        instruction: ANCHOR.prompt_instruction,
        provider: broken,
      }),
      /not JSON/,
    );
  });
});
