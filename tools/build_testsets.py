"""Build the 测试集合/ test sets from the corpus.

Two sets, with different purposes:

  reviewer/  Scored responses, tiered by who assigned the score. The tiers are
             kept apart because their labels are not interchangeable: an ETS
             rater's 6 and a redditor's 6 are different claims about the world,
             and averaging them produces a number that means nothing.

  writer/    Prompts to generate against, chosen to cover all six task
             variants and a spread of subject matter.

Run: cd tools && python build_testsets.py
"""

from __future__ import annotations

import json
import re
from collections import Counter

import pandas as pd

from common import ROOT

OUT = ROOT / "测试集合"
CSV = ROOT / "Data" / "gre_human_essays.csv"

# Same six patterns the TypeScript resolver uses, most specific first.
VARIANT_PATTERNS = [
    ("claim_and_reason", re.compile(r"reason on which th(?:at|e) claim is based", re.I)),
    ("claim_challenge", re.compile(r"could be used to challenge your position", re.I)),
    ("recommendation", re.compile(r"adopting the recommendation", re.I)),
    ("two_views", re.compile(r"which view more closely aligns", re.I)),
    ("policy", re.compile(r"views on the policy", re.I)),
    ("statement", re.compile(r"agree or disagree with the statement", re.I)),
]

INSTRUCTION_START = re.compile(r"(Write a response in which[\s\S]*|Discuss the extent to which[\s\S]*)$")


def split_prompt(text: str) -> tuple[str, str]:
    """Separate an issue statement from its task instruction."""
    if not isinstance(text, str):
        return "", ""
    found = INSTRUCTION_START.search(text)
    if not found:
        return text.strip(), ""
    return text[: found.start()].strip(), re.sub(r"\s+", " ", found.group(1)).strip()


def classify(instruction: str) -> str | None:
    for name, pattern in VARIANT_PATTERNS:
        if pattern.search(instruction):
            return name
    return None


def write_jsonl(path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------
# reviewer/
# --------------------------------------------------------------------------

TIERS = [
    {
        "file": "tier1_ets_official.jsonl",
        "subtype": "A1_official",
        "trust": "ground_truth",
        "note": "Scored by ETS raters and published by ETS with rater commentary. The only ground truth that exists.",
    },
    {
        "file": "tier2_teacher_rated.jsonl",
        "subtype": "A2_teacher_rated",
        "trust": "strong",
        "note": "Scored 0-6 by a named Magoosh GRE instructor in a published analysis. Not an ETS score, but a professional one.",
    },
    {
        "file": "tier3_community_rated.jsonl",
        "subtype": "A3_community_rated",
        "trust": "weak",
        "note": "Scored by a forum member or redditor. Rater skill unknown and unverifiable. Useful for rank-order checks, not for calibration.",
    },
    {
        "file": "tier4_machine_scored.jsonl",
        "subtype": "B1_machine_scored",
        "trust": "not_a_label",
        "note": "Output of an automated e-grader, not a human score. Agreement with it measures similarity to another machine, not correctness.",
    },
]


def reviewer_record(row: pd.Series, tier: dict) -> dict:
    statement, instruction = split_prompt(row.get("prompt_text", ""))
    return {
        "id": row["essay_id"],
        "essay": row["essay_text"],
        "statement": statement,
        "instruction": instruction,
        "variant": classify(instruction),
        "true_score": float(row["score"]),
        "label_source": tier["subtype"],
        "trust": tier["trust"],
        "source_name": row.get("source_name", ""),
        "source_url": row.get("source_url", ""),
        "word_count": int(row["word_count"]),
        "evidence_for_score": row.get("evidence_for_score", ""),
    }


def official_records(tier: dict) -> list[dict]:
    """Tier 1 comes from kb/anchors.json, never from the corpus CSV.

    7 of the 18 official Issue records in the CSV have the rater commentary
    concatenated into `essay_text` -- including all four practice-test 6s and
    5s. Building the ground-truth tier from those would mean testing the
    grader on essays with the official verdict stapled to the end.
    """
    anchors = json.loads((ROOT / "kb" / "anchors.json").read_text(encoding="utf-8"))
    return [
        {
            "id": anchor["id"],
            "essay": anchor["essay"],
            "statement": anchor["prompt_statement"],
            "instruction": anchor["prompt_instruction"],
            "variant": classify(anchor["prompt_instruction"]) or "statement",
            "true_score": float(anchor["score"]),
            "label_source": tier["subtype"],
            "trust": tier["trust"],
            "source_name": "ETS published sample responses with rater commentary",
            "source_url": anchor["source_pdf"],
            "word_count": len(re.findall(r"[A-Za-z][A-Za-z'-]*", anchor["essay"])),
            "evidence_for_score": "Assigned by ETS raters and published by ETS with their commentary.",
            "rater_commentary": anchor["rater_commentary"],
            "also_used_as_reviewer_anchor": True,
        }
        for anchor in anchors["anchors"]
    ]


def build_reviewer(frame: pd.DataFrame) -> dict:
    issue = frame[(frame.essay_type == "issue") & frame.score.notna() & frame.essay_text.notna()]
    manifest = {"task": "issue", "tiers": []}

    for tier in TIERS:
        if tier["subtype"] == "A1_official":
            records = official_records(tier)
        else:
            rows = issue[issue.subtype == tier["subtype"]]
            records = [reviewer_record(row, tier) for _, row in rows.iterrows()]
        records.sort(key=lambda r: (-r["true_score"], r["id"]))
        write_jsonl(OUT / "reviewer" / tier["file"], records)

        resolvable = sum(1 for r in records if r["variant"])
        manifest["tiers"].append(
            {
                "file": tier["file"],
                "trust": tier["trust"],
                "note": tier["note"],
                "count": len(records),
                "variant_resolvable": resolvable,
                "score_distribution": dict(sorted(Counter(r["true_score"] for r in records).items())),
            }
        )
        print(f"  {tier['file']:<32} {len(records):>4} 篇  (可解析变体 {resolvable})")

    # The Argument machine-scored pile: out of scope for the current product,
    # but it is the only bulk scored data in existence, so it is preserved
    # rather than thrown away.
    argument = frame[
        (frame.essay_type == "argument")
        & (frame.subtype == "B1_machine_scored")
        & frame.score.notna()
        & frame.essay_text.notna()
    ]
    arg_records = [
        {
            "id": row["essay_id"],
            "essay": row["essay_text"],
            "prompt_text": row.get("prompt_text", ""),
            "true_score": float(row["score"]),
            "label_source": "B1_machine_scored",
            "trust": "not_a_label",
            "source_name": row.get("source_name", ""),
            "word_count": int(row["word_count"]),
        }
        for _, row in argument.iterrows()
    ]
    write_jsonl(OUT / "reviewer" / "argument_out_of_scope" / "machine_scored_argument.jsonl", arg_records)
    dist = dict(sorted(Counter(r["true_score"] for r in arg_records).items()))
    top_two = sorted(dist.values(), reverse=True)[:3]
    manifest["argument_out_of_scope"] = {
        "count": len(arg_records),
        "score_distribution": dist,
        "concentration_top3": round(sum(top_two) / max(len(arg_records), 1), 3),
    }
    print(f"  argument_out_of_scope/           {len(arg_records):>4} 篇  (Argument, 产品范围外)")

    (OUT / "reviewer" / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return manifest


# --------------------------------------------------------------------------
# writer/
# --------------------------------------------------------------------------

# Four prompts per variant, chosen for subject spread. Prompts that already
# have officially scored responses at every band are marked, because those are
# the only ones where generated output can be compared against ground truth.
ANCHORED_STATEMENTS = {
    "As people rely more and more on technology to solve problems, the ability of humans to think for themselves will surely deteriorate.",
    "The best ideas arise from a passionate interest in commonplace things.",
    "The best way for a society to prepare its young people for leadership in government, industry, or other fields is by instilling in them a sense of cooperation, not competition.",
}

# Rough subject tags, used only to spread the selection across domains.
DOMAIN_HINTS = [
    ("education", re.compile(r"\b(school|student|educat|teach|universit|colleg|learn|curricul)", re.I)),
    ("government", re.compile(r"\b(government|polit|law|state|nation|citizen|public|societ)", re.I)),
    ("science_tech", re.compile(r"\b(scien|technolog|research|innovat|discover|engineer)", re.I)),
    ("arts_culture", re.compile(r"\b(art|artist|music|literat|culture|creativ|film)", re.I)),
    ("work_business", re.compile(r"\b(business|employ|work|corporat|industr|econom|profit)", re.I)),
    ("individual", re.compile(r"\b(individual|person|character|moral|happ|success|leader)", re.I)),
]


def domain_of(statement: str) -> str:
    for name, pattern in DOMAIN_HINTS:
        if pattern.search(statement):
            return name
    return "general"


def build_writer(per_variant: int = 4) -> dict:
    pool = json.loads((ROOT / "kb" / "prompts_issue.json").read_text(encoding="utf-8"))
    anchors = json.loads((ROOT / "kb" / "anchors.json").read_text(encoding="utf-8"))

    def entry(topic: dict, anchor_group: str | None) -> dict:
        return {
            "id": topic["id"],
            "statement": topic["statement"],
            "instruction": topic["instruction"],
            "variant": topic["variant"],
            "variant_summary": topic["variant_summary"],
            "required_moves": topic["required_moves"],
            "domain": domain_of(topic["statement"]),
            "has_official_scored_responses": anchor_group is not None,
            "official_anchor_group": anchor_group,
            "suggested_targets": [6, 4],
        }

    selected: list[dict] = []
    seen: set[str] = set()

    # The three prompts ETS published scored responses for come first and are
    # never dropped. They are the only prompts where generated output can be
    # held against real 1-6 responses to the same question, which makes them
    # worth more than any other prompt in the pool. Two of the three are not in
    # the current pool file (ETS reworded them), so they are taken from the
    # anchor set directly rather than matched by statement.
    variant_of = {t["variant"]: t for t in pool["topics"]}
    for prompt in anchors["prompts"]:
        variant = classify(prompt["instruction"]) or "statement"
        template = variant_of[variant]
        topic = {
            "id": f"anchored_{prompt['id']}",
            "statement": prompt["statement"],
            "instruction": prompt["instruction"],
            "variant": variant,
            "variant_summary": template["variant_summary"],
            "required_moves": template["required_moves"],
        }
        selected.append(entry(topic, prompt["id"]))
        seen.add(prompt["statement"])

    for variant in pool["variant_counts"]:
        already = sum(1 for s in selected if s["variant"] == variant)
        candidates = [
            t for t in pool["topics"] if t["variant"] == variant and t["statement"] not in seen
        ]

        # Spread across subject domains, preferring domains not yet used
        # anywhere in the set so the whole file stays varied.
        used_here: set[str] = set()
        picked: list[dict] = []
        for pass_number in (1, 2):
            for topic in candidates:
                if already + len(picked) >= per_variant:
                    break
                if topic["statement"] in seen:
                    continue
                domain = domain_of(topic["statement"])
                if pass_number == 1 and domain in used_here:
                    continue
                picked.append(topic)
                used_here.add(domain)
                seen.add(topic["statement"])

        selected.extend(entry(topic, None) for topic in picked)

    selected.sort(key=lambda s: (s["variant"], not s["has_official_scored_responses"], s["id"]))

    write_jsonl(OUT / "writer" / "prompts.jsonl", selected)

    manifest = {
        "task": "issue",
        "count": len(selected),
        "per_variant": per_variant,
        "variant_counts": dict(Counter(p["variant"] for p in selected)),
        "domain_counts": dict(Counter(p["domain"] for p in selected)),
        "with_official_scored_responses": sum(1 for p in selected if p["has_official_scored_responses"]),
    }
    (OUT / "writer" / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"  prompts.jsonl                    {len(selected):>4} 道题")
    for name, count in sorted(manifest["variant_counts"].items()):
        print(f"      {name:<20} {count}")
    return manifest


def main() -> None:
    frame = pd.read_csv(CSV)
    print("reviewer/")
    reviewer = build_reviewer(frame)
    print("\nwriter/")
    writer = build_writer()

    total = sum(t["count"] for t in reviewer["tiers"])
    print(f"\n共 {total} 篇评分作文 + {writer['count']} 道生成题 -> {OUT}")


if __name__ == "__main__":
    main()
