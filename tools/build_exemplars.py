"""Build kb/style_exemplars.json -- the writer agent's style brief.

Two kinds of content, kept explicitly separate by a `provenance` field:

  measured   Length and structure targets computed from the corpus. These
             answer "what does a real GRE Issue response actually look like",
             which is the thing an LLM gets wrong by default.
  authored   The anti-pattern list. These are judgement calls about how LLM
             prose gives itself away; nothing in the corpus derives them, and
             they should be revised once the reviewer's eval data exists.

Exemplar essays are referenced by anchor id rather than copied, so anchors.json
stays the single source of truth for ETS text.
"""

from __future__ import annotations

import json
import re
import statistics

import pandas as pd

from common import KB, ROOT, write_kb

CSV = ROOT / "Data" / "gre_human_essays.csv"


def percentiles(values: list[int]) -> dict[str, int]:
    ordered = sorted(values)
    quantiles = statistics.quantiles(ordered, n=10, method="inclusive")
    return {
        "p10": round(quantiles[0]),
        "p25": round(statistics.quantiles(ordered, n=4, method="inclusive")[0]),
        "median": round(statistics.median(ordered)),
        "p75": round(statistics.quantiles(ordered, n=4, method="inclusive")[2]),
        "p90": round(quantiles[8]),
    }


def corpus_stats() -> dict:
    frame = pd.read_csv(CSV)
    issue = frame[
        (frame.essay_type == "issue")
        & (frame.human_authenticity == "confirmed")
        & frame.essay_text.notna()
    ]
    # Paragraph structure survives in ~95% of the corpus; restrict the
    # structure stats to the rows where it actually does.
    structured = issue[issue.essay_text.str.contains("\n")]
    paragraphs = [
        len([p for p in re.split(r"\n\s*\n", text) if p.strip()])
        for text in structured.essay_text
    ]

    return {
        "provenance": "measured",
        "basis": (
            f"{len(issue)} Issue essays from Data/gre_human_essays.csv with "
            "human_authenticity == 'confirmed'"
        ),
        "caveat": (
            "These are real test-taker responses at unknown quality, not "
            "high-scoring exemplars. Treat them as the realistic envelope, "
            "not as the target."
        ),
        "word_count": percentiles(issue.word_count.tolist()),
        "paragraph_count": percentiles(paragraphs),
    }


def official_stats(anchors: list[dict]) -> list[dict]:
    by_score: dict[int, list[int]] = {}
    for anchor in anchors:
        by_score.setdefault(int(anchor["score"]), []).append(len(anchor["essay"].split()))
    return [
        {
            "score": score,
            "n": len(counts),
            "word_counts": sorted(counts),
            "median_words": round(statistics.median(counts)),
        }
        for score, counts in sorted(by_score.items(), reverse=True)
    ]


ANTI_PATTERNS = {
    "provenance": "authored",
    "status": (
        "Working hypotheses about how LLM prose reads as machine-written. "
        "Revisit once the reviewer eval produces evidence."
    ),
    "avoid": [
        {
            "pattern": "Uniform paragraph length and perfectly parallel body sections",
            "why": "Real 30-minute responses are lopsided; the strongest paragraph is usually longer than the others.",
        },
        {
            "pattern": "Signposting boilerplate -- 'Firstly', 'Moreover', 'In conclusion', 'This essay will argue'",
            "why": "Official score-6 responses transition through content, not through labels.",
        },
        {
            "pattern": "Abstract placeholder examples ('a certain company', 'many studies show')",
            "why": "Score 6 vs 5 turns on whether examples are specific and load-bearing. Name the case.",
        },
        {
            "pattern": "Register inflation -- 'multifaceted', 'delve into', 'plays a pivotal role', 'in today's rapidly evolving world'",
            "why": "Reads as vocabulary display rather than the precise usage the rubric rewards.",
        },
        {
            "pattern": "A concession paragraph that concedes nothing and is immediately dismissed",
            "why": "Several task variants require genuinely engaging the opposing case, not gesturing at it.",
        },
        {
            "pattern": "Restating the prompt as the opening sentence",
            "why": "ETS commentary explicitly marks generic prompt-restatement as a low-score signal.",
        },
        {
            "pattern": "Flawless mechanics across 600 words",
            "why": "Even score-6 responses carry minor errors; ETS says so in the rubric itself.",
        },
    ],
    "prefer": [
        "Commit to a position in the first paragraph and never hedge it away.",
        "Make one body paragraph do the heavy lifting with a specific, extended example.",
        "Vary sentence length deliberately -- a short sentence after a long one carries emphasis.",
        "Answer the task variant's required moves explicitly; that is what the rubric's first criterion scores.",
    ],
}


def main() -> None:
    anchors_doc = json.loads((KB / "anchors.json").read_text(encoding="utf-8"))
    anchors = anchors_doc["anchors"]

    exemplars = [
        {"anchor_id": a["id"], "score": a["score"], "role": "target"}
        for a in anchors
        if a["score"] >= 5
    ]
    contrasts = [
        {"anchor_id": a["id"], "score": a["score"], "role": "contrast"}
        for a in anchors
        if a["score"] in (3.0, 4.0)
    ]

    payload = {
        "task": "issue",
        "note": (
            "Exemplars are referenced by anchor id; the text lives in "
            "anchors.json. 'target' essays show what the writer should sound "
            "like; 'contrast' essays show the band immediately below, which is "
            "what a competent-but-unremarkable response looks like."
        ),
        "exemplars": exemplars,
        "contrasts": contrasts,
        "official_length_by_score": {
            "provenance": "measured",
            "basis": "18 ETS-scored Issue responses (kb/anchors.json)",
            "bands": official_stats(anchors),
        },
        "human_corpus": corpus_stats(),
        "anti_patterns": ANTI_PATTERNS,
    }

    path = write_kb("style_exemplars.json", payload)
    print(f"{len(exemplars)} target exemplars, {len(contrasts)} contrasts -> {path}")
    print("\nofficial word counts by score:")
    for band in payload["official_length_by_score"]["bands"]:
        print(f"  score {band['score']}: median {band['median_words']:>4}w  {band['word_counts']}")
    corpus = payload["human_corpus"]
    print(f"\nhuman corpus ({corpus['basis']}):")
    print(f"  words      {corpus['word_count']}")
    print(f"  paragraphs {corpus['paragraph_count']}")


if __name__ == "__main__":
    main()
