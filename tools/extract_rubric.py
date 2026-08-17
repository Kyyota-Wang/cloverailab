"""Extract the official GRE "Analyze an Issue" Scoring Guide into kb/rubric.json.

Source: Data/raw_cache/ets_ptresp1.pdf (the guide is reprinted verbatim in
ets_ptresp3.pdf; the two are compared as a check).

The guide is the only authoritative statement of what each score point means.
The reviewer scores each of its five criteria separately before committing to
a holistic score, so the criteria are extracted as structured axes rather than
as one prose blob.
"""

from __future__ import annotations

import re

from common import normalise, pdf_text, strip_page_furniture, write_kb

# ETS numbers five characteristics per score point (four at score 1, none at
# score 0), and their order is stable across score points. These labels name
# the axis each numbered item belongs to.
AXES = [
    {
        "id": "position",
        "name": "Position on the issue and task compliance",
        "note": "Whether a clear position is articulated *in accordance with the assigned task* -- this is where the six task-instruction variants are enforced.",
    },
    {
        "id": "development",
        "name": "Development and support",
        "note": "Reasons and examples: their relevance, persuasiveness, and whether claims are supported at all.",
    },
    {
        "id": "organization",
        "name": "Focus and organization",
        "note": "Whether the analysis stays focused and connects ideas logically.",
    },
    {
        "id": "language",
        "name": "Language: vocabulary and sentence variety",
        "note": "Fluency and precision of expression, effective vocabulary, sentence variety.",
    },
    {
        "id": "conventions",
        "name": "Conventions of standard written English",
        "note": "Grammar, usage, and mechanics -- and whether errors interfere with meaning.",
    },
]

# At score 1 ETS collapses the five axes into four: development and
# organization are merged into a single characteristic.
AXES_AT_1 = ["position", "development", "language", "conventions"]

_GUIDE = re.compile(r"Scoring Guide (.*?) Sample Responses with Reader")
_LEVEL = re.compile(r"Score (\d)\b")
_ITEM = re.compile(r"(?:^|\s)(\d)\.\s")


def parse_level(body: str) -> tuple[str, list[str]]:
    """Split one score point into its summary sentence and numbered criteria."""
    marker = "following characteristics:"
    if marker not in body:
        return body.strip(), []
    summary, items_text = body.split(marker, 1)

    positions = [(int(m.group(1)), m.end()) for m in _ITEM.finditer(items_text)]
    criteria = []
    for i, (_, start) in enumerate(positions):
        end = positions[i + 1][1] - len(f"{positions[i + 1][0]}. ") if i + 1 < len(positions) else len(items_text)
        criteria.append(items_text[start:end].strip())
    return (summary + marker).strip(), criteria


def extract_guide(pdf: str) -> dict[str, dict]:
    text = normalise(strip_page_furniture(pdf_text(pdf)))
    found = _GUIDE.search(text)
    if not found:
        raise SystemExit(f"scoring guide not found in {pdf}")
    guide_text = found.group(1)

    marks = list(_LEVEL.finditer(guide_text))
    levels = {}
    for i, mark in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(guide_text)
        score = mark.group(1)
        summary, criteria = parse_level(guide_text[mark.end() : end])

        if score == "1":
            axis_ids = AXES_AT_1
        elif score == "0":
            axis_ids = []
        else:
            axis_ids = [axis["id"] for axis in AXES]

        levels[score] = {
            "score": int(score),
            "summary": summary,
            "criteria": [
                {"axis": axis_id, "descriptor": descriptor}
                for axis_id, descriptor in zip(axis_ids, criteria)
            ],
        }
    return levels


def main() -> None:
    levels = extract_guide("ets_ptresp1.pdf")
    cross_check = extract_guide("ets_ptresp3.pdf")

    mismatched = [s for s in levels if levels[s] != cross_check.get(s)]
    if mismatched:
        print(f"WARNING: score points differ between the two booklets: {mismatched}")
    else:
        print("scoring guide identical in ets_ptresp1.pdf and ets_ptresp3.pdf")

    for score in ("6", "5", "4", "3", "2", "1", "0"):
        if score not in levels:
            raise SystemExit(f"score point {score} missing from the guide")

    path = write_kb(
        "rubric.json",
        {
            "source": "GRE Scoring Guide, Analyze an Issue (ets_ptresp1.pdf)",
            "task": "issue",
            "scale": "0-6",
            "note": (
                "Scores 6-2 list five characteristics; score 1 lists four "
                "(development and organization are merged); score 0 is "
                "off-topic/non-responsive and has none."
            ),
            "axes": AXES,
            "levels": [levels[s] for s in ("6", "5", "4", "3", "2", "1", "0")],
        },
    )

    print(f"7 score points -> {path}")
    for score in ("6", "5", "4", "3", "2", "1", "0"):
        level = levels[score]
        print(f"  score {score}: {len(level['criteria'])} criteria, summary {len(level['summary'])} chars")


if __name__ == "__main__":
    main()
