import "../../agent/src/kb-node.ts";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, quadraticWeightedKappa, scoreLadder } from "../metrics.ts";
import { goldSet, heldOutSet, ladders } from "../gold.ts";
import type { Prediction } from "../metrics.ts";

const predict = (pairs: Array<[number, number]>): Prediction[] =>
  pairs.map(([trueScore, predictedScore], i) => ({
    id: `item_${i}`,
    trueScore,
    predictedScore,
    labelSource: "ets_official",
    samples: [predictedScore],
  }));

describe("quadratic weighted kappa", () => {
  test("perfect agreement is 1", () => {
    assert.equal(quadraticWeightedKappa([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]), 1);
  });

  test("a constant prediction scores 0, not high accuracy", () => {
    // The trap this metric exists to catch: always guessing the modal score.
    const kappa = quadraticWeightedKappa([3, 4, 4, 4, 5], [4, 4, 4, 4, 4]);
    assert.equal(kappa, 0);
  });

  test("inverted ordering is negative", () => {
    assert.ok(quadraticWeightedKappa([1, 2, 5, 6], [6, 5, 2, 1]) < 0);
  });

  test("near misses beat far misses", () => {
    const near = quadraticWeightedKappa([1, 3, 5], [1.5, 3.5, 5.5]);
    const far = quadraticWeightedKappa([1, 3, 5], [4, 6, 2]);
    assert.ok(near > far);
  });
});

describe("computeMetrics", () => {
  test("bias is signed and detects a generous grader", () => {
    const metrics = computeMetrics(predict([[3, 4], [4, 5], [5, 6]]));
    assert.equal(metrics.bias, 1);
    assert.equal(metrics.meanAbsoluteError, 1);
    assert.equal(metrics.agreementWithinHalf, 0);
    assert.equal(metrics.agreementWithinOne, 1);
  });

  test("bias is negative for a harsh grader", () => {
    assert.equal(computeMetrics(predict([[5, 4], [4, 3]])).bias, -1);
  });

  test("offsetting errors cancel in bias but not in absolute error", () => {
    const metrics = computeMetrics(predict([[4, 5], [4, 3]]));
    assert.equal(metrics.bias, 0, "a grader can look unbiased while being wrong both ways");
    assert.equal(metrics.meanAbsoluteError, 1);
  });

  test("reports the largest misses first", () => {
    const metrics = computeMetrics(predict([[4, 4], [1, 5], [3, 3.5]]));
    assert.equal(metrics.worstMisses[0]!.error, 4);
  });

  test("sample spread is zero without self-consistency", () => {
    assert.equal(computeMetrics(predict([[4, 4]])).meanSampleSpread, 0);
  });

  test("sample spread measures disagreement across samples", () => {
    const metrics = computeMetrics([
      { id: "a", trueScore: 4, predictedScore: 4, labelSource: "x", samples: [3, 4, 5] },
    ]);
    assert.equal(metrics.meanSampleSpread, 2);
  });

  test("an empty set does not throw", () => {
    assert.equal(computeMetrics([]).n, 0);
  });
});

describe("ladder scoring", () => {
  test("a perfectly ordered ladder", () => {
    const result = scoreLadder(
      "t",
      [1, 2, 3, 4, 5, 6].map((s) => ({ trueScore: s, predictedScore: s })),
    );
    assert.equal(result.correctlyOrdered, true);
    assert.equal(result.pairwiseAccuracy, 1);
  });

  test("a uniformly generous grader still orders correctly", () => {
    // The point of the ladder test: it survives miscalibration.
    const result = scoreLadder(
      "t",
      [1, 2, 3, 4, 5, 6].map((s) => ({ trueScore: s, predictedScore: Math.min(6, s + 1) })),
    );
    assert.equal(result.pairwiseAccuracy > 0.8, true);
  });

  test("ties score half credit", () => {
    const result = scoreLadder("t", [
      { trueScore: 1, predictedScore: 4 },
      { trueScore: 2, predictedScore: 4 },
    ]);
    assert.equal(result.pairwiseAccuracy, 0.5);
  });

  test("an inversion is caught", () => {
    const result = scoreLadder("t", [
      { trueScore: 1, predictedScore: 6 },
      { trueScore: 6, predictedScore: 1 },
    ]);
    assert.equal(result.correctlyOrdered, false);
    assert.equal(result.pairwiseAccuracy, 0);
  });
});

describe("the gold set itself", () => {
  test("has the expected composition", () => {
    const all = goldSet();
    assert.equal(all.length, 26, "26 human-scored Issue responses is the entire supply");
    assert.equal(all.filter((i) => i.labelSource === "ets_official").length, 18);
    assert.equal(all.filter((i) => i.labelSource === "teacher_rated").length, 8);
  });

  test("every item carries a usable prompt and a valid score", () => {
    for (const item of goldSet()) {
      assert.ok(item.essay.length > 20, `${item.id} has no essay`);
      assert.ok(item.statement.length > 20, `${item.id} has no prompt statement`);
      assert.ok(item.trueScore >= 0 && item.trueScore <= 6, `${item.id} score out of range`);
    }
  });

  test("no gold essay carries leaked rater commentary", () => {
    // 7 of the 18 official records in the CSV do; the gold set reads the
    // official items from kb/anchors.json specifically to avoid that.
    for (const item of goldSet()) {
      assert.ok(
        !/this (?:outstanding )?response (?:presents|demonstrates|earns)/i.test(item.essay),
        `${item.id} looks like it contains rater commentary`,
      );
    }
  });

  test("spans the full score range", () => {
    const scores = new Set(goldSet().map((i) => Math.floor(i.trueScore)));
    for (const band of [1, 2, 3, 4, 5, 6]) {
      assert.ok(scores.has(band), `no gold item at score band ${band}`);
    }
  });

  test("three complete ladders, each spanning 1 to 6", () => {
    const found = ladders();
    assert.equal(found.length, 3);
    for (const ladder of found) {
      assert.deepEqual(
        ladder.items.map((i) => i.trueScore),
        [1, 2, 3, 4, 5, 6],
        `${ladder.name} is not a complete ladder`,
      );
    }
  });

  test("heldOutSet is the teacher-rated subset", () => {
    // The official 18 are inside the grader's anchor context, so they are only
    // held out when the eval runs with leave-one-out anchoring.
    assert.ok(heldOutSet().every((i) => i.labelSource === "teacher_rated"));
  });
});
