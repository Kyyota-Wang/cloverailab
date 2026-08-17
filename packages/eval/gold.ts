import "../agent/src/env-node.ts";
/**
 * The gold set: every Issue response in the corpus carrying a score a human
 * assigned.
 *
 * 26 items -- 18 scored by ETS raters, 8 by named Magoosh instructors. That is
 * the entire supply. It is why this project uses an LLM grader against a
 * rubric rather than a trained scorer: 26 labels train nothing, but they can
 * hold a grader to account.
 *
 * Machine-scored essays (testbig's e-grader, the GMATAWA auto-grader) are
 * excluded on purpose. There are 2,009 of them and they would make the set
 * look 80x larger while measuring agreement with another automated grader
 * rather than with a human.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import "../agent/src/kb-node.ts";
import { kb } from "../agent/src/kb.ts";
import type { TaskVariant } from "../agent/src/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

export interface GoldItem {
  id: string;
  essay: string;
  statement: string;
  instruction?: string;
  variant?: TaskVariant;
  /** The score a human assigned. */
  trueScore: number;
  /** Who assigned it, and therefore how much weight it carries. */
  labelSource: "ets_official" | "teacher_rated";
  /** Anchors share prompts with the grader's context; see `heldOut`. */
  heldOut: boolean;
}

/**
 * Parse the corpus CSV.
 *
 * Hand-rolled rather than pulled in as a dependency: the file is 27 MB with
 * embedded newlines and quotes inside essay text, and a streaming character
 * scan handles that correctly without adding a package for one call site.
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) return [];
  header[0] = header[0]!.replace(/^﻿/, ""); // strip the BOM Excel needs
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((key, i) => [key, r[i] ?? ""])));
}

/**
 * The 18 ETS anchors, from kb/anchors.json rather than the CSV.
 *
 * The CSV's copies are unusable for this: 7 of the 18 have the rater
 * commentary concatenated into `essay_text`, including all four
 * practice-test score-6 and score-5 records. Scoring those would mean
 * scoring an essay with a rater's verdict stapled to the end of it.
 */
function officialItems(): GoldItem[] {
  return kb().anchors.anchors.map((anchor) => ({
    id: anchor.id,
    essay: anchor.essay,
    statement: anchor.prompt_statement,
    instruction: anchor.prompt_instruction,
    trueScore: anchor.score,
    labelSource: "ets_official" as const,
    // These essays are in the grader's own anchor context. Agreement on them
    // measures retrieval, not judgement.
    heldOut: false,
  }));
}

/**
 * Split a corpus `prompt_text` into its issue statement and task instruction.
 *
 * The corpus stores both in one field. Passing the whole thing as the
 * statement leaves the reviewer with no instruction to classify the task
 * variant from, and it refuses to guess -- correctly, since the required
 * moves differ per variant. Splitting at the standard opener recovers it.
 */
function splitPromptText(text: string): { statement: string; instruction?: string } {
  const match = /Write a response in which[\s\S]*$/.exec(text);
  if (!match) return { statement: text.trim() };
  return {
    statement: text.slice(0, match.index).trim(),
    instruction: match[0].replace(/\s+/g, " ").trim(),
  };
}

function teacherItems(): GoldItem[] {
  let csv: string;
  try {
    csv = readFileSync(join(ROOT, "Data", "gre_human_essays.csv"), "utf8");
  } catch {
    return []; // The corpus is gitignored; the official 18 still work without it.
  }

  return parseCsv(csv)
    .filter(
      (row) =>
        row["subtype"] === "A2_teacher_rated" &&
        row["essay_type"] === "issue" &&
        row["essay_text"] &&
        row["score"],
    )
    .map((row) => {
      const { statement, instruction } = splitPromptText(row["prompt_text"] || "");
      const item: GoldItem = {
        id: row["essay_id"]!,
        essay: row["essay_text"]!,
        statement,
        ...(instruction ? { instruction } : {}),
        trueScore: Number(row["score"]),
        labelSource: "teacher_rated" as const,
        heldOut: true,
      };
      return item;
    })
    .filter((item) => item.statement.length > 20 && Number.isFinite(item.trueScore));
}

export function goldSet(): GoldItem[] {
  return [...officialItems(), ...teacherItems()];
}

/**
 * The subset that measures judgement rather than recall.
 *
 * Report both: agreement on the anchors shows the grader can apply the
 * standard it was given, agreement on held-out items shows it generalises.
 * Only the second number is evidence the reviewer works.
 */
export function heldOutSet(): GoldItem[] {
  return goldSet().filter((item) => item.heldOut);
}

/**
 * The score ladders: each ETS booklet publishes one response per score point
 * for the same prompt. A grader must rank them 1 < 2 < 3 < 4 < 5 < 6.
 *
 * This is the cheapest strong test available. It needs no absolute
 * calibration -- a grader that is uniformly a point generous still passes --
 * so it isolates whether the grader can tell the bands apart at all.
 */
export function ladders(): Array<{ name: string; items: GoldItem[] }> {
  const groups = new Map<string, GoldItem[]>();
  for (const item of officialItems()) {
    const name = item.id.replace(/_score\d$/, "");
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups]
    .map(([name, items]) => ({
      name,
      items: items.sort((a, b) => a.trueScore - b.trueScore),
    }))
    .filter((ladder) => ladder.items.length >= 4);
}

/** True when this file was run directly. Compares real paths, because a
 *  `file://` string comparison does not survive Windows drive letters. */
function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(fileURLToPath(moduleUrl)) === resolve(entry);
}

if (isMain(import.meta.url)) {
  const all = goldSet();
  const held = heldOutSet();
  console.log(`gold set: ${all.length} items`);
  console.log(`  ets_official:  ${all.filter((i) => i.labelSource === "ets_official").length}`);
  console.log(`  teacher_rated: ${all.filter((i) => i.labelSource === "teacher_rated").length}`);
  console.log(`  held out:      ${held.length}`);

  const byScore = new Map<number, number>();
  for (const item of all) byScore.set(item.trueScore, (byScore.get(item.trueScore) ?? 0) + 1);
  console.log("\nscore distribution:");
  for (const [score, n] of [...byScore].sort((a, b) => b[0] - a[0])) {
    console.log(`  ${score.toFixed(1)}  ${"#".repeat(n)} (${n})`);
  }

  console.log(`\nladders: ${ladders().length}`);
  for (const ladder of ladders()) {
    console.log(`  ${ladder.name}: ${ladder.items.map((i) => i.trueScore).join(" < ")}`);
  }
}
