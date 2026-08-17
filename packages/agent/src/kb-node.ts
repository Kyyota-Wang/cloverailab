/**
 * Node-side knowledge-base loading.
 *
 * Importing this module registers a filesystem loader with kb.ts, so anything
 * running under Node gets the kb/*.json files without thinking about it. The
 * Cloudflare Worker never imports this file -- it calls `setKb()` with JSON it
 * imported at build time, because Workers have no filesystem.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerKbLoader, type KnowledgeBase } from "./kb.ts";

const KB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "kb");

function read<T>(filename: string): T {
  try {
    return JSON.parse(readFileSync(join(KB_DIR, filename), "utf8")) as T;
  } catch (cause) {
    throw new Error(
      `Cannot read kb/${filename}. Rebuild it with the Phase 0 extractors: ` +
        `cd tools && python extract_rubric.py && python extract_anchors.py && ` +
        `python extract_prompts.py && python build_exemplars.py`,
      { cause },
    );
  }
}

registerKbLoader((): KnowledgeBase => ({
  rubric: read("rubric.json"),
  anchors: read("anchors.json"),
  pool: read("prompts_issue.json"),
  style: read("style_exemplars.json"),
}));
