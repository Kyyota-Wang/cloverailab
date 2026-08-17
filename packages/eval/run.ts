import "../agent/src/env-node.ts";
/**
 * The eval harness.
 *
 * Run this after any change to the reviewer's prompt, schema, model or
 * provider. It is the only thing standing between "the reviewer produces
 * confident-sounding output" and "the reviewer is right".
 *
 *   node packages/eval/run.ts                       full set, leave-one-out
 *   node packages/eval/run.ts --limit 6             a cheap smoke run
 *   node packages/eval/run.ts --samples 3           self-consistency
 *   node packages/eval/run.ts --provider gemini     A/B a provider
 *   node packages/eval/run.ts --no-leave-one-out    faster, but see below
 *
 * Leave-one-out anchoring is on by default: when scoring one of the 18 ETS
 * responses, that response is removed from the grader's own anchor context.
 * Without it the grader is being asked to score an essay it can see the
 * official verdict for, and the resulting numbers measure retrieval rather
 * than judgement. The cost is a prompt-cache miss per item.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { review } from "../agent/src/reviewer/index.ts";
import { createProvider } from "../agent/src/providers/index.ts";
import "../agent/src/kb-node.ts";
import { kb } from "../agent/src/kb.ts";
import { goldSet, ladders, type GoldItem } from "./gold.ts";
import {
  computeMetrics,
  formatMetrics,
  scoreLadder,
  type Prediction,
} from "./metrics.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, "results");

interface Args {
  limit?: number;
  samples: number;
  provider?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  leaveOneOut: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { samples: 1, leaveOneOut: true };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--limit":
        args.limit = Number(value);
        i++;
        break;
      case "--samples":
        args.samples = Number(value);
        i++;
        break;
      case "--provider":
        if (value) args.provider = value;
        i++;
        break;
      case "--model":
        if (value) args.model = value;
        i++;
        break;
      case "--effort":
        if (value) args.effort = value as NonNullable<Args["effort"]>;
        i++;
        break;
      case "--no-leave-one-out":
        args.leaveOneOut = false;
        break;
    }
  }
  return args;
}

/** Rough cost estimate; the real figure depends on the provider's pricing. */
function summariseUsage(
  runs: Array<{ input: number; cached: number; cacheWrite: number; output: number }>,
) {
  const total = runs.reduce(
    (acc, r) => ({
      input: acc.input + r.input,
      cached: acc.cached + r.cached,
      cacheWrite: acc.cacheWrite + r.cacheWrite,
      output: acc.output + r.output,
    }),
    { input: 0, cached: 0, cacheWrite: 0, output: 0 },
  );
  const totalInput = total.input + total.cached + total.cacheWrite;
  return {
    ...total,
    totalInput,
    cacheHitRate: totalInput ? total.cached / totalInput : 0,
  };
}

/** Every anchor answering the same prompt as `id`, including `id` itself. */
function siblingAnchorIds(id: string): string[] {
  const group = id.replace(/_score\d$/, "");
  return kb().anchors.anchors.map((a) => a.id).filter((a) => a.startsWith(`${group}_score`));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const provider = createProvider({
    role: "reviewer",
    ...(args.provider ? { provider: args.provider } : {}),
    ...(args.model ? { model: args.model } : {}),
  });

  let items: GoldItem[] = goldSet();
  if (args.limit) {
    // Sample across the score range rather than taking the first N, so a
    // smoke run still exercises every band.
    const byScore = new Map<number, GoldItem[]>();
    for (const item of items) {
      byScore.set(item.trueScore, [...(byScore.get(item.trueScore) ?? []), item]);
    }
    const spread: GoldItem[] = [];
    const buckets = [...byScore.values()];
    for (let round = 0; spread.length < args.limit; round++) {
      let added = false;
      for (const bucket of buckets) {
        const item = bucket[round];
        if (item && spread.length < args.limit) {
          spread.push(item);
          added = true;
        }
      }
      if (!added) break;
    }
    items = spread;
  }

  console.log(
    `Evaluating ${items.length} items on ${provider.name}/${provider.model}\n` +
      `samples=${args.samples}  effort=${args.effort ?? "high"}  ` +
      `leave-one-out=${args.leaveOneOut}\n`,
  );

  const predictions: Prediction[] = [];
  const usageRuns: Array<{ input: number; cached: number; cacheWrite: number; output: number }> = [];
  const failures: Array<{ id: string; error: string }> = [];
  const started = Date.now();

  for (const [index, item] of items.entries()) {
    const label = `[${index + 1}/${items.length}] ${item.id}`;
    try {
      const result = await review({
        essay: item.essay,
        statement: item.statement,
        ...(item.instruction ? { instruction: item.instruction } : {}),
        ...(item.variant ? { variant: item.variant } : {}),
        provider,
        samples: args.samples,
        ...(args.effort ? { effort: args.effort } : {}),
        // Exclude the item's whole prompt group, not just the item. The six
        // anchors in a booklet all answer the same issue statement, so leaving
        // the siblings in lets the grader reason "better than the 5 on this
        // exact prompt" rather than judging against the rubric -- which
        // inflates official-item scores relative to genuinely unseen essays.
        ...(args.leaveOneOut && item.labelSource === "ets_official"
          ? { excludeAnchorIds: siblingAnchorIds(item.id) }
          : {}),
      });

      predictions.push({
        id: item.id,
        trueScore: item.trueScore,
        predictedScore: result.review.holisticScore,
        labelSource: item.labelSource,
        samples: result.samples,
      });
      usageRuns.push({
        input: result.usage.inputTokens,
        cached: result.usage.cachedInputTokens,
        cacheWrite: result.usage.cacheWriteTokens,
        output: result.usage.outputTokens,
      });

      const error = result.review.holisticScore - item.trueScore;
      const mark = Math.abs(error) <= 0.5 ? "ok " : Math.abs(error) <= 1 ? "~  " : "MISS";
      console.log(
        `${mark} ${label}  true ${item.trueScore.toFixed(1)}  ` +
          `predicted ${result.review.holisticScore.toFixed(1)}  ` +
          `(${error >= 0 ? "+" : ""}${error.toFixed(1)})`,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failures.push({ id: item.id, error: message });
      console.log(`ERR ${label}  ${message.split("\n")[0]}`);
    }
  }

  console.log("\n" + "=".repeat(72));

  const official = predictions.filter((p) => p.labelSource === "ets_official");
  const teacher = predictions.filter((p) => p.labelSource === "teacher_rated");

  console.log(formatMetrics("ALL", computeMetrics(predictions)));
  if (official.length) console.log("\n" + formatMetrics("ETS official", computeMetrics(official)));
  if (teacher.length) console.log("\n" + formatMetrics("Teacher rated", computeMetrics(teacher)));

  // Ladders: can the grader tell the bands apart, independent of calibration?
  console.log("\nScore ladders (ordering, independent of absolute calibration):");
  const byId = new Map(predictions.map((p) => [p.id, p]));
  const ladderResults = [];
  for (const ladder of ladders()) {
    const scored = ladder.items
      .map((item) => byId.get(item.id))
      .filter((p): p is Prediction => Boolean(p))
      .map((p) => ({ trueScore: p.trueScore, predictedScore: p.predictedScore }));
    if (scored.length < 4) continue;
    const result = scoreLadder(ladder.name, scored);
    ladderResults.push(result);
    console.log(
      `  ${ladder.name.padEnd(20)} ` +
        `${result.correctlyOrdered ? "ordered  " : "INVERTED "} ` +
        `pairwise ${(result.pairwiseAccuracy * 100).toFixed(0)}%  ` +
        `predicted [${scored.map((s) => s.predictedScore.toFixed(1)).join(", ")}]`,
    );
  }

  const usage = summariseUsage(usageRuns);
  console.log(
    `\nTokens: ${usage.totalInput.toLocaleString()} input ` +
      `(${usage.input.toLocaleString()} uncached, ` +
      `${usage.cacheWrite.toLocaleString()} cache writes, ` +
      `${usage.cached.toLocaleString()} cache reads = ${(usage.cacheHitRate * 100).toFixed(0)}% hit), ` +
      `${usage.output.toLocaleString()} output`,
  );
  if (args.leaveOneOut && usage.cacheHitRate < 0.3) {
    console.log(
      "  Low cache hit rate is expected with leave-one-out: the anchor set, " +
        "and so the cached prefix, changes for each official item.",
    );
  }
  console.log(`Elapsed: ${((Date.now() - started) / 1000).toFixed(0)}s`);

  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    for (const failure of failures) console.log(`  ${failure.id}: ${failure.error}`);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outfile = join(RESULTS_DIR, `${provider.name}-${provider.model}-${stamp}.json`);
  writeFileSync(
    outfile,
    JSON.stringify(
      {
        provider: provider.name,
        model: provider.model,
        options: args,
        metrics: {
          all: computeMetrics(predictions),
          official: computeMetrics(official),
          teacher: computeMetrics(teacher),
        },
        ladders: ladderResults,
        usage,
        predictions,
        failures,
      },
      null,
      2,
    ),
  );
  console.log(`\nWritten to ${outfile}`);

  if (failures.length === items.length && items.length > 0) process.exitCode = 1;
}

function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && resolve(fileURLToPath(moduleUrl)) === resolve(entry!);
}

if (isMain(import.meta.url)) {
  await main();
}
