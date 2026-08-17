# GRE Analytical Writing — human-written essay corpus

A traceable dataset of **real, human-written** GRE Analytical Writing responses.
Every record carries its source URL and an explicit statement of *why* we
believe a human wrote it and *where* any score came from.

## Files

| File | What it is |
|---|---|
| `gre_human_essays.csv` | The dataset (UTF-8 with BOM, so Excel opens it correctly). |
| `gre_human_essays.json` | The same records as JSON. |
| `statistics.md` | Counts: totals, score distribution, authenticity, per-source. |
| `source_report.md` | One row per source, with access notes. |
| `potential_sources_requiring_human_action.md` | Sources that need you to log in, buy, or download by hand. |
| `scripts/` | The collectors and the build pipeline. |
| `raw_cache/` | Cached raw pages and PDFs, so nothing is re-downloaded. |
| `out/stage_*.json` | Per-source intermediate output, before dedup. |

## Schema

| Field | Notes |
|---|---|
| `essay_id` | Stable id, prefixed with the source. |
| `essay_text` | The response only — prompt, task instructions, and forum chatter are stripped out. |
| `essay_type` | `issue` / `argument` / `unknown`. |
| `prompt_text` | The GRE task statement, where it was recoverable. |
| `prompt_category` | Where the prompt came from. |
| `score` | The number, on the 0–6 scale. Blank when there is none. |
| `score_available` | `True` only when a score of any kind exists. |
| `score_type` | **Read this before using `score`.** See below. |
| `score_scale` | `0-6` where a score exists. |
| `human_authenticity` | `confirmed` / `likely` / `uncertain`. |
| `exam_or_practice` | `official_scored_sample`, `practice`, `real_exam_reported`. |
| `author_username` | Where public. |
| `source_name`, `source_url` | Provenance. |
| `publication_date` | ISO date where known. |
| `evidence_for_score` | Quoted evidence — who assigned the number and where it is stated. |
| `evidence_for_human_authorship` | Why this is believed to be human writing. |
| `notes` | Anything else, including archive snapshot URLs. |
| `word_count`, `collected_at`, `text_sha1` | Bookkeeping. |
| `data_type` | `A` = has a real (human/official) score, `B` = no score. Coarse -- see `subtype` for who actually produced the score. |
| `subtype` | Five-way split: `A1_official` / `A2_teacher_rated` / `A3_community_rated` / `B1_machine_scored` / `B2_unscored`. `data_type` A/B alone conflates a human community rating with a machine auto-grader score; filter on `subtype` when that distinction matters. `B1_machine_scored` (testbig e-grader, GMATAWA auto-grader output) is `data_type=B` precisely because it is not a real GRE score. |
| `priority` | 1–4, per the collection brief. |
| `duplicate_count`, `duplicate_of_sources` | How many copies were collapsed, and where they were. |

### `score_type` — the important one

| Value | Meaning | Treat as ground truth? |
|---|---|---|
| `official` | Assigned by ETS GRE raters and published by ETS. | **Yes.** |
| `teacher_rated` | Assigned by a named prep-company instructor. | Reasonably. |
| `self_reported` | The test taker says this is the AWA score they received. | With care. |
| `third_party_rated` | A human rater who is not ETS and not an instructor (e.g. a redditor grading the post). | Weak label. |
| `estimated` | **Machine** output (testbig's e-grader, ScoreItNow-style tools). | **No.** Not a real GRE score. |
| `none` | No score. | — |

No score in this dataset was invented, predicted, or inferred by a model. Where
a page said something like "this would probably score a 5", the essay was kept
and the score was **not** recorded.

### `human_authenticity`

- `confirmed` — published by ETS as a real test-taker response, attributed to a
  named account posting before generative-AI tools existed, or otherwise
  directly evidenced.
- `likely` — a named human account asking for feedback on their own work, but
  posted after ChatGPT's launch (2022-11-30), so LLM assistance can't be ruled out.
- `uncertain` — the text contains an LLM tell, or provenance is thin. Filter
  these out if you need a clean human-only set.

A useful clean-set filter:

```bash
python -c "import pandas as pd; d=pd.read_csv('gre_human_essays.csv'); print(d[d.human_authenticity=='confirmed'].shape)"
```

## Reproducing / extending

Collectors are independent and cache everything, so re-running is cheap and
resumable.

```bash
python scripts/collect_ets.py
```

```bash
python scripts/collect_magoosh.py
```

```bash
python scripts/collect_reddit.py --harvest --parse
```

```bash
python scripts/collect_testbig.py --fetch --parse
```

ArguGPT needs the Kaggle CLI configured once (`kaggle configure`), then:

```bash
kaggle datasets download -d alejopaullier/argugpt -p argugpt_raw --unzip
```

```bash
python scripts/collect_argugpt.py
```

GRE Prep Club cannot be fetched from a script — the domain answers anonymous
requests with HTTP 403. Its pages were read inside a logged-in browser session
and dumped to `raw_cache/gre_prepclub_awa.json`; the collector works from that
file:

```bash
python scripts/collect_prepclub.py
```

Then rebuild the merged dataset, dedup, and reports:

```bash
python scripts/build_database.py
```

### The testbig crawl is finished

6,693 of 6,779 archived URLs (**98.7%**) were retrieved. The Internet Archive
refuses a share of connections rather than queueing them, so the crawl reached
that figure over eleven resumable passes, each one retrying only what the
previous pass failed on: +1,139, +841, +631, +428, +321, +278, +230, +203,
+118, +84, +57. The remaining 86 URLs fail on every pass and are almost
certainly broken or absent snapshots rather than rate-limiting.

Re-running `--fetch` is harmless (it skips anything already cached with a 200)
but will not add anything meaningful now.

## Deduplication

GRE sites reprint each other constantly. Exact duplicates are collapsed on
normalised text, then near-duplicates via MinHash (96 permutations, 5-token
shingles, 24 bands, Jaccard ≥ 0.80). The surviving copy is the one with the
strongest provenance — official score beats teacher rating beats self-report,
and a record with a prompt beats one without. Discarded URLs are preserved in
`duplicate_of_sources`, so nothing becomes untraceable.
