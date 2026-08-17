import "../src/kb-node.ts";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { precheck, isMechanicalZero, formatPrecheck } from "../src/reviewer/precheck.ts";
import { kb, resolvePrompt } from "../src/kb.ts";
import type { PromptSpec } from "../src/types.ts";

const PROMPT: PromptSpec = {
  statement:
    "As people rely more and more on technology to solve problems, the ability of humans to think for themselves will surely deteriorate.",
  instruction:
    "Discuss the extent to which you agree or disagree with the statement and explain your reasoning for the position you take.",
  variant: "statement",
  requiredMoves: ["State a position.", "Consider when it holds.", "Consider when it does not."],
};

describe("precheck: structure", () => {
  test("counts words, paragraphs and sentences", () => {
    const essay = "Technology helps us. It also hurts us.\n\nBut context matters a great deal here.";
    const result = precheck(essay, PROMPT);
    assert.equal(result.paragraphCount, 2);
    assert.equal(result.sentenceCount, 3);
    assert.equal(result.wordCount, 14);
  });

  test("treats single newlines as paragraph breaks when no blank lines exist", () => {
    const essay = "First paragraph here.\nSecond paragraph here.\nThird one.";
    assert.equal(precheck(essay, PROMPT).paragraphCount, 3);
  });

  test("measures sentence-length variety", () => {
    const uniform = precheck("Aaa bbb ccc ddd. Eee fff ggg hhh. Iii jjj kkk lll.", PROMPT);
    const varied = precheck(
      "No. Technology has repeatedly expanded the range of problems that ordinary people are able to reason about without specialist training. It helps.",
      PROMPT,
    );
    assert.equal(uniform.sentenceLengthStdev, 0);
    assert.ok(varied.sentenceLengthStdev > 5, "varied prose should show spread");
  });
});

describe("precheck: topical signals", () => {
  test("flags an off-topic response", () => {
    const essay =
      "My favourite recipe is a slow braised beef stew. Brown the meat first, then add carrots, onions and celery. Simmer for three hours until the meat falls apart. Serve with mashed potato and a glass of red wine. This dish is best made the day before, because the flavours deepen overnight in the refrigerator.";
    const result = precheck(essay, PROMPT);
    assert.ok(result.flags.includes("off_topic"), `flags were ${result.flags.join()}`);
  });

  test("does not flag an on-topic response", () => {
    const essay =
      "Technology does not erode our ability to think; it changes what we think about. Humans who rely on calculators still reason about which computation to perform. The problems people solve today are more abstract than those solved by hand a century ago, which suggests the ability to think has been redirected rather than diminished.";
    const result = precheck(essay, PROMPT);
    assert.ok(!result.flags.includes("off_topic"));
    assert.ok(result.promptOverlap > 0.15);
  });

  test("detects an opening that restates the prompt", () => {
    const echo = precheck(
      "As people rely more on technology to solve problems, the ability of humans to think for themselves will deteriorate. I agree with this.",
      PROMPT,
    );
    const original = precheck(
      "Calculators did not make arithmetic obsolete; they made it cheap. That distinction matters for this question.",
      PROMPT,
    );
    assert.equal(echo.opensByRestatingPrompt, true);
    assert.equal(original.opensByRestatingPrompt, false);
  });
});

describe("precheck: marker detection", () => {
  test("finds concession markers", () => {
    const result = precheck(
      "Technology aids thought. However, critics argue that dependence breeds passivity. Admittedly, that risk is real.",
      PROMPT,
    );
    assert.ok(result.concessionMarkers.includes("however"));
    assert.ok(result.concessionMarkers.includes("critics"));
    assert.ok(result.concessionMarkers.includes("admittedly"));
  });

  test("finds formulaic signposting", () => {
    const result = precheck(
      "Firstly, technology helps. Moreover, it educates. In conclusion, I agree.",
      PROMPT,
    );
    assert.ok(result.formulaicMarkers.includes("firstly"));
    assert.ok(result.formulaicMarkers.includes("in conclusion"));
  });

  test("does not match markers inside longer words", () => {
    // "yetis" must not register the concession marker "yet".
    const result = precheck("Researchers studied yetis and thoroughness in reasoning.", PROMPT);
    assert.ok(!result.concessionMarkers.includes("yet"));
  });

  test("finds specificity markers but ignores sentence-initial capitals", () => {
    const result = precheck(
      "Machines changed everything. The Wright brothers flew in 1903. Boeing later scaled the idea.",
      PROMPT,
    );
    assert.ok(result.specificityMarkers.includes("1903"));
    assert.ok(result.specificityMarkers.includes("Wright"));
    assert.ok(!result.specificityMarkers.includes("Machines"), "first word is not evidence");
  });
});

describe("precheck: mechanical zero", () => {
  test("empty input", () => {
    const result = precheck("   \n  ", PROMPT);
    assert.ok(result.flags.includes("empty"));
    assert.equal(isMechanicalZero(result), true);
  });

  test("copying the prompt", () => {
    const result = precheck(PROMPT.statement, PROMPT);
    assert.ok(result.flags.includes("copies_prompt"));
    assert.equal(isMechanicalZero(result), true);
  });

  test("a short but genuine response is not a mechanical zero", () => {
    const result = precheck(
      "I disagree. Technology frees attention for harder problems rather than replacing thought.",
      PROMPT,
    );
    assert.equal(isMechanicalZero(result), false);
  });
});

describe("precheck: against the official ETS anchors", () => {
  const anchors = kb().anchors.anchors;

  test("no official anchor is flagged off topic or as a mechanical zero", () => {
    for (const anchor of anchors) {
      const prompt = resolvePrompt({
        statement: anchor.prompt_statement,
        instruction: anchor.prompt_instruction,
      });
      const result = precheck(anchor.essay, prompt);
      assert.ok(
        !result.flags.includes("off_topic"),
        `${anchor.id} (score ${anchor.score}) was flagged off topic; overlap ${result.promptOverlap}`,
      );
      assert.equal(isMechanicalZero(result), false, `${anchor.id} was called a mechanical zero`);
    }
  });

  test("word counts separate the score bands as expected", () => {
    const median = (values: number[]) =>
      values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    const at = (score: number) =>
      median(
        anchors
          .filter((a) => a.score === score)
          .map((a) => precheck(a.essay, PROMPT).wordCount),
      );
    assert.ok(at(6) > at(4), "score 6 anchors are longer than score 4 anchors");
    assert.ok(at(4) > at(1), "score 4 anchors are longer than score 1 anchors");
  });

  test("formatPrecheck renders every signal", () => {
    const anchor = anchors.find((a) => a.score === 6)!;
    const prompt = resolvePrompt({
      statement: anchor.prompt_statement,
      instruction: anchor.prompt_instruction,
    });
    const rendered = formatPrecheck(precheck(anchor.essay, prompt));
    for (const label of ["Length:", "Sentence length:", "Topical overlap", "Mechanical flags:"]) {
      assert.ok(rendered.includes(label), `missing ${label}`);
    }
  });
});

describe("resolvePrompt", () => {
  test("classifies by instruction text", () => {
    assert.equal(
      resolvePrompt({
        statement: "Anything at all.",
        instruction:
          "Write a response in which you discuss which view more closely aligns with your own position and explain your reasoning for the position you take. In developing and supporting your position, you should address both of the views presented.",
      }).variant,
      "two_views",
    );
  });

  test("falls back to a unique statement match in the pool", () => {
    const unique = kb().pool.topics.find(
      (t) => kb().pool.topics.filter((o) => o.statement === t.statement).length === 1,
    )!;
    assert.equal(resolvePrompt({ statement: unique.statement }).variant, unique.variant);
  });

  test("refuses to guess when a statement is reused across variants", () => {
    const counts = new Map<string, number>();
    for (const topic of kb().pool.topics) {
      counts.set(topic.statement, (counts.get(topic.statement) ?? 0) + 1);
    }
    const reused = [...counts].find(([, n]) => n > 1)?.[0];
    assert.ok(reused, "the pool should contain at least one reused statement");
    assert.throws(() => resolvePrompt({ statement: reused }), /different task/);
  });

  test("an explicit variant always wins", () => {
    const spec = resolvePrompt({ statement: "Anything.", variant: "policy" });
    assert.equal(spec.variant, "policy");
    assert.equal(spec.requiredMoves.length, 3);
  });
});
