# CloverAI Lab — GRE Analytical Writing agents

**Live at [cloverailab.com](https://cloverailab.com)**

A reviewer that scores GRE Issue essays against the ETS rubric, and a writer that drafts
them. TypeScript end to end, deployed on Cloudflare Workers.

There are 30 officially scored GRE essays in existence that anyone can get hold of. **You
cannot train a scoring model on 30 examples**, and the projects that claim to have done so
are usually reporting agreement with themselves. So this is LLM-as-judge with an explicit
rubric and officially scored anchors in context — no fine-tuning, no GPU, no ML pipeline.
The corpus is inference-time context and an evaluation set, not training weights.

The interesting engineering is in stopping a judge from being confidently wrong, and in
measuring whether that worked.

---

## Does it work?

Leave-one-out over the gold set, `claude-sonnet-5`:

| Gold set | n | QWK | Within ½ band | Within 1 band | Exact | Bias |
|---|---:|---:|---:|---:|---:|---:|
| ETS official anchors | 18 | **0.825** | 50.0% | 83.3% | 22.2% | −0.33 |
| Teacher-scored (Magoosh) | 8 | 0.448 | 50.0% | 75.0% | 12.5% | −0.81 |
| All | 26 | **0.774** | 50.0% | 80.8% | 19.2% | −0.48 |

Ladder ordering — six essays per set, scored 1 through 6, checking whether the reviewer can
tell the bands apart independently of how it is calibrated:

| Ladder | Pairwise accuracy | Fully ordered |
|---|---:|:--:|
| `practice_test_1` | 93.3% | ✅ |
| `practice_test_3` | 90.0% | ❌ |
| `sample_issue` | 86.7% | ❌ |

**Where it fails.** The bias is negative and it is not noise. Every one of the five worst
misses is the same failure: a 4.5-to-6 essay marked 1.5 bands low.

| Essay | True | Predicted |
|---|---:|---:|
| `practice_test_1_score6` | 6 | 4.5 |
| `sample_issue_score5` | 5 | 3.5 |
| `practice_test_1_score5` | 5 | 3.5 |
| `magoosh_awa_issue_essay_strategies_2` | 5 | 3.5 |
| `magoosh_awa_issue_essay_strategies_3` | 4.5 | 3 |

The reviewer is a harsh grader at the top of the scale. Raw results, including these, are
committed under [`packages/eval/results/`](packages/eval/results/) — a benchmark you can only
pass is not a benchmark.

Reproduce:

```bash
node packages/eval/run.ts                    # all 26, leave-one-out
node packages/eval/run.ts --limit 6          # cheap smoke test, sampled across bands
node packages/eval/run.ts --provider gemini  # A/B against the other adapter
```

---

## The design decisions that matter

**Schema field order is reasoning order.** The reviewer makes one call, and the structured
output schema puts `holisticScore` *last* — after compliance, after per-axis evidence, after
the anchor comparison. The model generates in schema order, so it cannot pick a number first
and reverse-engineer the justification. That is the signature failure of an LLM judge, and
the fix is free. Splitting it into three calls would cost 3× (output is 85% of spend); whether
that buys anything is a question for the eval, not for taste.

**Leave-one-out anchoring in evaluation.** When grading one of the 18 official essays, that
essay is removed from the grader's own anchor context. Skip this and the model is scoring an
essay whose official score and rater commentary are sitting in its prompt — you would be
measuring retrieval, not judgment. It costs one cache miss per essay. Evaluation runs rarely.
Worth it.

**Length is a confounder, not a criterion.** In the official corpus, score-6 essays have a
median of 775 words and score-1 essays 49. That correlation is real and it is not the rubric.
The prompt forbids using length as evidence, explicitly.

**Mechanical zeros never reach the model.** An empty submission or a copy of the prompt is a
zero by ETS definition. Short-circuit, spend nothing.

**Prompt-cache invariants are covered by tests.** The rubric, anchors and instructions are
~9k tokens identical across every request and must sit before the cache breakpoint. Tests
assert the system prefix is byte-identical, that there is exactly one breakpoint, and that no
timestamp or UUID leaks into the prefix. Break any one and input cost rises 10× silently, with
no error anywhere. 55 tests in total.

**The prompt resolver refuses to guess.** Issue prompts recur across the official pool with
different task instructions — "discuss the extent to which you agree", "address the most
compelling evidence that could challenge your position", and four more. Each demands a
different argumentative move, and it is where most test-takers actually lose points. When the
instruction is ambiguous, `resolvePrompt()` returns unresolved rather than picking one.

---

## A data defect, and why it is in the README

Seven of the eighteen official Issue essays in the widely used public CSV have **rater
commentary spliced into the essay text**. `ets_practice_test_1_issue_0_score6` is recorded at
1,039 words; the essay is 775 of them and the remaining 264 are a grader observing that the
response demonstrates facility with the conventions of standard written English.

The affected essays are, precisely, the high-score anchors — two 6s, two 5s, one 4, two 3s.
Used as-is, the reviewer's best exemplars would have taught it that *sounding like a grader*
is what a 6 looks like.

[`tools/extract_anchors.py`](tools/extract_anchors.py) re-derives them from the source PDFs and
separates the two. [`tools/validate_kb.py`](tools/validate_kb.py) asserts commentary never
appears in essay text, so the defect cannot come back. The original CSV is left untouched as
an archive.

---

## Layout

```
kb/          235 KB knowledge base, deployed to the edge
             rubric.json (5 axes × 7 bands) · anchors.json (18 scored essays +
             commentary) · prompts_issue.json (158 official prompts, 6 instruction
             variants) · style_exemplars.json
packages/
  agent/     reviewer + writer + provider adapters (Anthropic, Gemini)
  eval/      harness, metrics, committed results
tools/       Python, one-time ETL from source PDFs into kb/
web/         Cloudflare Worker + React front end
```

The agent logic is TypeScript, so `wrangler dev` runs the code that ships — no rewrite between
prototype and production. Python appears only in the one-time extraction step, where pulling
tables out of PDFs is what the ecosystem is good at.

Providers sit behind `interface LLMProvider { complete(req): Promise<Resp> }` with Anthropic
and Gemini adapters, so which model goes to production is decided by the eval harness rather
than by whichever one was wired up first.

---

## Run it

```bash
npm install
npm run typecheck
npm test              # 55 tests, no API key needed
```

For the live form, create `web/.dev.vars` from `web/.dev.vars.example` and add an
`ANTHROPIC_API_KEY`, then:

```bash
npm run dev           # http://127.0.0.1:8788, real Workers runtime
```

Rebuilding the knowledge base from source PDFs is a one-time step and needs the source
material; see [`Data/README.md`](Data/README.md). Deployment procedure is in
[`DEPLOY.md`](DEPLOY.md), architecture notes in [`BACKEND.md`](BACKEND.md), and the full
reasoning behind the above in [`PLAN.md`](PLAN.md).

---

## Not built

- Argument task. Issue only — the gold set drops from 38 to 26 and still covers every band,
  and the two tasks' rubrics overlap heavily. The 12 official Argument samples are kept in the
  eval directory as extra ladder calibration and do not reach the product.
- No account system, no persistence. A submission and its review live in the browser session.
- The teacher-scored subset is small (n=8) and its QWK of 0.448 should be read as
  underpowered rather than as a finding.
