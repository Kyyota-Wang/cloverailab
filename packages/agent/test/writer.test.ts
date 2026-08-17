import "../src/kb-node.ts";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSystem, buildUserContent } from "../src/writer/prompt.ts";
import { WRITE_SCHEMA } from "../src/writer/schema.ts";
import { write } from "../src/writer/index.ts";
import { kb, resolvePrompt } from "../src/kb.ts";
import type { CompletionRequest, CompletionResult, LLMProvider } from "../src/providers/types.ts";

const TOPIC = kb().pool.topics.find((t) => t.variant === "two_views")!;
const PROMPT = resolvePrompt({ statement: TOPIC.statement, instruction: TOPIC.instruction });

class MockWriter implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-1";
  readonly requests: CompletionRequest[] = [];

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    return {
      text: JSON.stringify({
        plan: {
          position: "A committed thesis.",
          moveCoverage: [{ move: "m", plan: "p" }],
          bodyParagraphs: [{ claim: "c", example: "The Wright brothers, 1903", role: "r" }],
          concession: "The strongest objection, answered.",
        },
        essay: "First paragraph here.\n\nSecond paragraph here with more words in it.",
        notes: { targetScore: 6, whyThisScores: "because", ifAimingHigher: "n/a" },
      }),
      usage: { inputTokens: 100, cachedInputTokens: 8000, cacheWriteTokens: 0, outputTokens: 900 },
    };
  }
}

describe("writer prompt assembly", () => {
  test("the system prefix is byte-identical across calls", () => {
    assert.deepEqual(buildSystem(), buildSystem());
  });

  test("exactly one cache breakpoint, on the final block", () => {
    const system = buildSystem();
    assert.equal(system.filter((b) => b.cacheable).length, 1);
    assert.equal(system.at(-1)!.cacheable, true);
  });

  test("the target score is NOT in the cached prefix", () => {
    // It varies per request; putting it in the prefix would void the cache
    // every time a user asked for a different band.
    const joined = buildSystem().map((b) => b.text).join("\n");
    assert.ok(!/would earn a 4\b/.test(joined));
    assert.ok(!/Write a response that would earn/.test(joined));
  });

  test("the prefix shows exemplars at every band from 3 up, with commentary", () => {
    const joined = buildSystem().map((b) => b.text).join("\n");
    for (const anchor of kb().anchors.anchors.filter((a) => a.score >= 3)) {
      assert.ok(joined.includes(anchor.id), `missing ${anchor.id}`);
      assert.ok(joined.includes(anchor.rater_commentary.slice(0, 50)), `missing commentary for ${anchor.id}`);
    }
  });

  test("the prefix names the machine-writing tells it must avoid", () => {
    const joined = buildSystem().map((b) => b.text).join("\n").toLowerCase();
    for (const tell of ["moreover", "in conclusion", "multifaceted", "this essay will"]) {
      assert.ok(joined.includes(tell), `anti-pattern list does not mention "${tell}"`);
    }
  });

  test("user content carries the topic, variant and required moves", () => {
    const content = buildUserContent({ prompt: PROMPT, targetScore: 6 });
    assert.ok(content.includes(PROMPT.statement));
    assert.ok(content.includes(PROMPT.variant));
    for (const move of PROMPT.requiredMoves) assert.ok(content.includes(move));
  });

  test("a sub-6 target asks for a real shortfall, not a sabotaged essay", () => {
    const content = buildUserContent({ prompt: PROMPT, targetScore: 4 });
    assert.ok(content.includes("would earn a 4"));
    assert.ok(/deliberate typos|writing badly on purpose/.test(content));
  });
});

describe("writer schema", () => {
  test("plans before writing", () => {
    const keys = Object.keys(WRITE_SCHEMA["properties"] as object);
    assert.ok(keys.indexOf("plan") < keys.indexOf("essay"), "the plan must precede the essay");
  });

  test("uses no JSON Schema keyword structured outputs rejects", () => {
    const banned = ["minimum", "maximum", "multipleOf", "minLength", "maxLength", "maxItems"];
    const offences: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((c, i) => walk(c, `${path}[${i}]`));
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (banned.includes(key)) offences.push(`${path}.${key}`);
        if (key === "minItems" && typeof value === "number" && value > 1) {
          offences.push(`${path}.minItems=${value}`);
        }
        walk(value, `${path}.${key}`);
      }
    };
    walk(WRITE_SCHEMA, "schema");
    assert.deepEqual(offences, []);
  });

  test("body paragraphs must name a specific example", () => {
    const paragraphs = (WRITE_SCHEMA["properties"] as any).plan.properties.bodyParagraphs;
    assert.ok(paragraphs.items.required.includes("example"));
    assert.match(paragraphs.items.properties.example.description, /not 'a study'/);
  });
});

describe("write pipeline", () => {
  test("returns a planned essay", async () => {
    const provider = new MockWriter();
    const result = await write({
      statement: TOPIC.statement,
      instruction: TOPIC.instruction,
      provider,
    });
    assert.ok(result.essay.includes("First paragraph"));
    assert.equal(result.plan.position, "A committed thesis.");
    assert.equal(result.wordCount, 11);
    assert.equal(result.prompt.variant, "two_views");
  });

  test("defaults to a target of 6", async () => {
    const provider = new MockWriter();
    await write({ statement: TOPIC.statement, instruction: TOPIC.instruction, provider });
    assert.ok(provider.requests[0]!.userContent.includes("would earn a 6"));
  });

  test("rejects a target the bands cannot demonstrate", async () => {
    await assert.rejects(
      write({
        statement: TOPIC.statement,
        instruction: TOPIC.instruction,
        targetScore: 1,
        provider: new MockWriter(),
      }),
      /targetScore must be one of/,
    );
  });

  test("passes optional guidance through", async () => {
    const provider = new MockWriter();
    await write({
      statement: TOPIC.statement,
      instruction: TOPIC.instruction,
      guidance: "argue against the statement",
      provider,
    });
    assert.ok(provider.requests[0]!.userContent.includes("argue against the statement"));
  });

  test("surfaces a refusal rather than returning an empty essay", async () => {
    const refusing: LLMProvider = {
      name: "mock",
      model: "mock-1",
      async complete() {
        return {
          text: "",
          usage: { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
          refusal: { category: "test", explanation: null },
        };
      },
    };
    await assert.rejects(
      write({ statement: TOPIC.statement, instruction: TOPIC.instruction, provider: refusing }),
      /declined this topic/,
    );
  });
});
