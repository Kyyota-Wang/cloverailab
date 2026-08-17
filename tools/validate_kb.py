"""Assert the invariants every kb/ file must hold.

Run after any extractor change. These checks are what stop a silent PDF or
parser regression from reaching the agents, where a truncated anchor or a
mis-classified task variant would be very hard to notice.
"""

from __future__ import annotations

import json
import sys

from common import KB

FAILURES: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        FAILURES.append(message)


def load(name: str) -> dict:
    return json.loads((KB / name).read_text(encoding="utf-8"))


def validate_rubric() -> None:
    doc = load("rubric.json")
    scores = [level["score"] for level in doc["levels"]]
    check(scores == [6, 5, 4, 3, 2, 1, 0], f"rubric score points are {scores}")

    axis_ids = {axis["id"] for axis in doc["axes"]}
    check(len(axis_ids) == 5, f"expected 5 rubric axes, got {len(axis_ids)}")

    for level in doc["levels"]:
        expected = {6: 5, 5: 5, 4: 5, 3: 5, 2: 5, 1: 4, 0: 0}[level["score"]]
        check(
            len(level["criteria"]) == expected,
            f"score {level['score']} has {len(level['criteria'])} criteria, expected {expected}",
        )
        check(bool(level["summary"]), f"score {level['score']} has no summary")
        for criterion in level["criteria"]:
            check(
                criterion["axis"] in axis_ids,
                f"score {level['score']} references unknown axis {criterion['axis']!r}",
            )
            check(
                len(criterion["descriptor"]) > 20,
                f"score {level['score']} axis {criterion['axis']} descriptor looks truncated",
            )


def validate_anchors() -> None:
    doc = load("anchors.json")
    anchors = doc["anchors"]
    check(len(anchors) == 18, f"expected 18 anchors, got {len(anchors)}")

    seen_scores: dict[float, int] = {}
    for anchor in anchors:
        seen_scores[anchor["score"]] = seen_scores.get(anchor["score"], 0) + 1
        check(bool(anchor["essay"]), f"{anchor['id']} has no essay text")
        check(
            len(anchor["rater_commentary"].split()) >= 80,
            f"{anchor['id']} commentary is only {len(anchor['rater_commentary'].split())} words",
        )
        check(bool(anchor["prompt_statement"]), f"{anchor['id']} has no prompt statement")
        check(bool(anchor["prompt_instruction"]), f"{anchor['id']} has no task instruction")

        # The commentary must not have leaked into the essay -- this is exactly
        # the defect present in Data/gre_human_essays.csv for 7 of these 18.
        head = " ".join(anchor["rater_commentary"].split()[:10])
        check(head not in anchor["essay"], f"{anchor['id']}: commentary leaked into essay text")

        for trailer in ("NO TEST MATERIAL", "Copyright", "End of The Graduate"):
            check(
                trailer not in anchor["essay"] and trailer not in anchor["rater_commentary"],
                f"{anchor['id']}: booklet trailer {trailer!r} not stripped",
            )

    check(
        seen_scores == {6.0: 3, 5.0: 3, 4.0: 3, 3.0: 3, 2.0: 3, 1.0: 3},
        f"anchor score distribution is {seen_scores}, expected 3 at each of 1-6",
    )


def validate_prompts() -> None:
    doc = load("prompts_issue.json")
    topics = doc["topics"]
    check(len(topics) == 158, f"expected 158 pool topics, got {len(topics)}")
    check(
        len({t["id"] for t in topics}) == len(topics),
        "topic ids are not unique",
    )

    expected_counts = {
        "statement": 53,
        "claim_challenge": 26,
        "claim_and_reason": 25,
        "recommendation": 23,
        "two_views": 20,
        "policy": 11,
    }
    check(
        doc["variant_counts"] == expected_counts,
        f"variant counts are {doc['variant_counts']}",
    )

    for topic in topics:
        check(
            50 <= len(topic["statement"]) <= 700,
            f"{topic['id']} statement length {len(topic['statement'])} is out of range",
        )
        check(
            topic["instruction"].startswith("Write a response in which"),
            f"{topic['id']} instruction does not start with the standard opener",
        )
        check(
            not topic["statement"].startswith("Write a response"),
            f"{topic['id']} statement contains the instruction",
        )
        check(len(topic["required_moves"]) == 3, f"{topic['id']} lacks 3 required moves")


def validate_exemplars() -> None:
    doc = load("style_exemplars.json")
    anchor_ids = {a["id"] for a in load("anchors.json")["anchors"]}
    referenced = [e["anchor_id"] for e in doc["exemplars"] + doc["contrasts"]]
    for anchor_id in referenced:
        check(anchor_id in anchor_ids, f"exemplar references unknown anchor {anchor_id!r}")

    for section in ("official_length_by_score", "human_corpus", "anti_patterns"):
        check("provenance" in doc[section], f"{section} does not declare provenance")

    check(
        doc["anti_patterns"]["provenance"] == "authored",
        "anti-patterns must be labelled as authored, not measured",
    )


def main() -> None:
    validate_rubric()
    validate_anchors()
    validate_prompts()
    validate_exemplars()

    total = sum(path.stat().st_size for path in KB.glob("*.json"))
    print(f"kb/ total size: {total / 1024:.0f} KB")
    for path in sorted(KB.glob("*.json")):
        print(f"  {path.name:<24} {path.stat().st_size / 1024:>7.1f} KB")

    if FAILURES:
        print(f"\n{len(FAILURES)} FAILURE(S):")
        for failure in FAILURES:
            print(f"  - {failure}")
        sys.exit(1)
    print("\nall knowledge-base invariants hold")


if __name__ == "__main__":
    main()
