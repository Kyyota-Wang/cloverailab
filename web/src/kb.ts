/**
 * Knowledge-base injection for the Worker.
 *
 * Workers have no filesystem, so the four kb/*.json files are imported at
 * build time and bundled into the script (235 KB, well under the size limit).
 * Importing this module for its side effect is what makes the agents work in
 * a Worker; the Node path uses packages/agent/src/kb-node.ts instead.
 */

import rubric from "../../kb/rubric.json" with { type: "json" };
import anchors from "../../kb/anchors.json" with { type: "json" };
import pool from "../../kb/prompts_issue.json" with { type: "json" };
import style from "../../kb/style_exemplars.json" with { type: "json" };
import { setKb, type KnowledgeBase } from "../../packages/agent/src/kb.ts";

setKb({ rubric, anchors, pool, style } as unknown as KnowledgeBase);
