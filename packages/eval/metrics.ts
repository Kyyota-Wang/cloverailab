/**
 * Scoring metrics for the reviewer.
 *
 * The headline number is not accuracy. An LLM grader applying a rubric is
 * almost always systematically generous, and a generous grader can be useless
 * while looking accurate on average. So three things are reported separately:
 *
 *   bias      Mean signed error. Tells you *which way* it is wrong. A grader
 *             running +0.8 is correctable by prompt or by offset; one running
 *             +0.1 with huge variance is not.
 *   agreement Exact-within-half-a-point rate. What a user actually experiences.
 *   qwk       Quadratic weighted kappa. Agreement corrected for chance, with
 *             big misses punished quadratically. Robust to the gold set's
 *             skewed score distribution in a way raw accuracy is not.
 *
 * Ladder accuracy is reported alongside them because it is the one measure
 * that survives a miscalibrated grader: it asks only whether the bands can be
 * told apart, not whether the numbers are right.
 */

export interface Prediction {
  id: string;
  trueScore: number;
  predictedScore: number;
  labelSource: string;
  samples: number[];
}

export interface Metrics {
  n: number;
  /** Mean signed error: positive means the grader is generous. */
  bias: number;
  meanAbsoluteError: number;
  /** Share scored within half a point of the human label. */
  agreementWithinHalf: number;
  agreementWithinOne: number;
  exactAgreement: number;
  quadraticWeightedKappa: number;
  /** Mean spread across samples; 0 when self-consistency is off. */
  meanSampleSpread: number;
  worstMisses: Array<{ id: string; trueScore: number; predictedScore: number; error: number }>;
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/**
 * Quadratic weighted kappa over the 0-6 scale in half-point steps.
 *
 * Scores are binned to half points, which is the resolution the GRE reports.
 */
export function quadraticWeightedKappa(
  actual: number[],
  predicted: number[],
): number {
  if (actual.length !== predicted.length || actual.length === 0) return 0;

  const bin = (score: number) => Math.round(score * 2); // 0..12
  const size = 13;

  const observed = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const actualCounts = new Array<number>(size).fill(0);
  const predictedCounts = new Array<number>(size).fill(0);

  for (let i = 0; i < actual.length; i++) {
    const a = Math.min(size - 1, Math.max(0, bin(actual[i]!)));
    const p = Math.min(size - 1, Math.max(0, bin(predicted[i]!)));
    observed[a]![p]! += 1;
    actualCounts[a]! += 1;
    predictedCounts[p]! += 1;
  }

  const n = actual.length;
  let numerator = 0;
  let denominator = 0;

  for (let a = 0; a < size; a++) {
    for (let p = 0; p < size; p++) {
      const weight = (a - p) ** 2 / (size - 1) ** 2;
      const expected = (actualCounts[a]! * predictedCounts[p]!) / n;
      numerator += weight * observed[a]![p]!;
      denominator += weight * expected;
    }
  }

  // A denominator of 0 means one rater used a single category throughout;
  // kappa is undefined there, and 0 is the honest report.
  return denominator === 0 ? 0 : 1 - numerator / denominator;
}

export function computeMetrics(predictions: Prediction[]): Metrics {
  if (predictions.length === 0) {
    return {
      n: 0,
      bias: 0,
      meanAbsoluteError: 0,
      agreementWithinHalf: 0,
      agreementWithinOne: 0,
      exactAgreement: 0,
      quadraticWeightedKappa: 0,
      meanSampleSpread: 0,
      worstMisses: [],
    };
  }

  const errors = predictions.map((p) => p.predictedScore - p.trueScore);
  const absolute = errors.map(Math.abs);

  const spreads = predictions.map((p) =>
    p.samples.length > 1 ? Math.max(...p.samples) - Math.min(...p.samples) : 0,
  );

  const worstMisses = predictions
    .map((p) => ({
      id: p.id,
      trueScore: p.trueScore,
      predictedScore: p.predictedScore,
      error: p.predictedScore - p.trueScore,
    }))
    .sort((a, b) => Math.abs(b.error) - Math.abs(a.error))
    .slice(0, 5);

  return {
    n: predictions.length,
    bias: round(mean(errors)),
    meanAbsoluteError: round(mean(absolute)),
    agreementWithinHalf: round(absolute.filter((e) => e <= 0.5).length / predictions.length),
    agreementWithinOne: round(absolute.filter((e) => e <= 1).length / predictions.length),
    exactAgreement: round(absolute.filter((e) => e === 0).length / predictions.length),
    quadraticWeightedKappa: round(
      quadraticWeightedKappa(
        predictions.map((p) => p.trueScore),
        predictions.map((p) => p.predictedScore),
      ),
    ),
    meanSampleSpread: round(mean(spreads)),
    worstMisses,
  };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export interface LadderResult {
  name: string;
  /** True when the grader's scores are non-decreasing along the true order. */
  correctlyOrdered: boolean;
  /** Share of the pairs the grader ordered correctly. */
  pairwiseAccuracy: number;
  scores: Array<{ trueScore: number; predictedScore: number }>;
}

/**
 * How well the grader orders one published score ladder.
 *
 * Pairs at equal predicted scores count as half credit: calling two adjacent
 * bands identical is a weaker error than inverting them.
 */
export function scoreLadder(
  name: string,
  ordered: Array<{ trueScore: number; predictedScore: number }>,
): LadderResult {
  let correct = 0;
  let pairs = 0;

  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const lower = ordered[i]!;
      const higher = ordered[j]!;
      if (lower.trueScore === higher.trueScore) continue;
      pairs += 1;
      if (higher.predictedScore > lower.predictedScore) correct += 1;
      else if (higher.predictedScore === lower.predictedScore) correct += 0.5;
    }
  }

  const monotonic = ordered.every(
    (item, i) => i === 0 || item.predictedScore >= ordered[i - 1]!.predictedScore,
  );

  return {
    name,
    correctlyOrdered: monotonic,
    pairwiseAccuracy: pairs ? round(correct / pairs) : 0,
    scores: ordered,
  };
}

export function formatMetrics(label: string, metrics: Metrics): string {
  if (metrics.n === 0) return `${label}: no items`;

  const direction = metrics.bias > 0 ? "generous" : metrics.bias < 0 ? "harsh" : "unbiased";
  const lines = [
    `${label} (n=${metrics.n})`,
    `  bias                  ${metrics.bias >= 0 ? "+" : ""}${metrics.bias.toFixed(2)}  (${direction})`,
    `  mean absolute error   ${metrics.meanAbsoluteError.toFixed(2)}`,
    `  within 0.5            ${(metrics.agreementWithinHalf * 100).toFixed(0)}%`,
    `  within 1.0            ${(metrics.agreementWithinOne * 100).toFixed(0)}%`,
    `  exact                 ${(metrics.exactAgreement * 100).toFixed(0)}%`,
    `  QWK                   ${metrics.quadraticWeightedKappa.toFixed(3)}`,
  ];
  if (metrics.meanSampleSpread > 0) {
    lines.push(`  mean sample spread    ${metrics.meanSampleSpread.toFixed(2)}`);
  }
  if (metrics.worstMisses.length) {
    lines.push("  worst misses:");
    for (const miss of metrics.worstMisses) {
      const sign = miss.error > 0 ? "+" : "";
      lines.push(
        `    ${miss.id.padEnd(34)} true ${miss.trueScore.toFixed(1)}  predicted ${miss.predictedScore.toFixed(1)}  (${sign}${miss.error.toFixed(1)})`,
      );
    }
  }
  return lines.join("\n");
}
