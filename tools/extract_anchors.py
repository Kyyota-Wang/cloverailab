"""Extract ETS's officially scored Issue essays *with rater commentary*
into kb/anchors.json.

Sources (all Issue task; the Argument samples are ignored):
  sample-issue-task.pdf  6 essays, scores 6..1, plus ETS's own "Strategies
                         for This Topic" notes
  ets_ptresp1.pdf        6 essays, scores 6..1
  ets_ptresp3.pdf        6 essays, scores 6..1

18 essays total, which matches the official Issue count already in
Data/gre_human_essays.csv. What the CSV does *not* carry is the rater
commentary -- the only ground-truth text explaining *why* a response earned
its score. That commentary is the single most valuable asset for the
reviewer, both as few-shot anchors and as the model for its own output voice.
"""

from __future__ import annotations

import re

from common import normalise, pdf_text, strip_page_furniture, write_kb

# Each source pairs an essay marker with a commentary marker. The commentary
# marker must be tested first where one contains the other as a substring.
SOURCES = [
    {
        "id": "sample_issue",
        "pdf": "sample-issue-task.pdf",
        "prompt": (r"Analytical Writing measure: (.*?) Strategies for This Topic", 1),
        "strategies": (r"Strategies for This Topic (.*?) Sample Essay Responses", 1),
        "marker": re.compile(r"(Rater Commentary for )?Essay Response -- Score (\d)"),
        "is_commentary": lambda m: bool(m.group(1)),
        "score": lambda m: int(m.group(2)),
        "stop": "",
    },
    {
        "id": "practice_test_1",
        "pdf": "ets_ptresp1.pdf",
        "prompt": (r"Sample Topic: (.*?) GRE. Scoring Guide", 1),
        "strategies": None,
        "marker": re.compile(
            r"The following sample response received a score of (\d):"
            r"|Comments on sample essay receiving score of (\d):"
        ),
        "is_commentary": lambda m: m.group(2) is not None,
        "score": lambda m: int(m.group(1) or m.group(2)),
        "stop": "",
    },
    {
        "id": "practice_test_3",
        "pdf": "ets_ptresp3.pdf",
        "prompt": (r"Sample Topic: (.*?) GRE. Scoring Guide", 1),
        "strategies": None,
        "marker": re.compile(
            r"The following sample response received a score of (\d):"
            r"|Comments on sample essay receiving score of (\d):"
        ),
        "is_commentary": lambda m: m.group(2) is not None,
        "score": lambda m: int(m.group(1) or m.group(2)),
        "stop": "",
    },
]

_INSTRUCTION = re.compile(
    r"((?:Write a response in which you discuss|Discuss the extent to which).*)$",
    re.DOTALL,
)

# Booklet trailers that follow the final commentary in each PDF.
_TRAILERS = re.compile(
    r"\s*(?:Copyright\s*.?\s*\d{4} by ETS\b"
    r"|End of The Graduate Record Examinations\b"
    r"|NO TEST MATERIAL ON THIS PAGE).*$",
    re.DOTALL,
)


def trim(body: str) -> str:
    return _TRAILERS.sub("", body).strip()


def split_prompt(block: str) -> tuple[str, str]:
    """Separate a topic statement from its task instruction."""
    found = _INSTRUCTION.search(block)
    if not found:
        return block.strip(), ""
    return block[: found.start()].strip(), found.group(1).strip()


def extract(source: dict) -> tuple[dict, list[dict]]:
    text = normalise(strip_page_furniture(pdf_text(source["pdf"])))

    pattern, group = source["prompt"]
    found = re.search(pattern, text)
    if not found:
        raise SystemExit(f"prompt not found in {source['pdf']}")
    statement, instruction = split_prompt(found.group(group))

    strategies = ""
    if source["strategies"]:
        pattern, group = source["strategies"]
        found = re.search(pattern, text)
        strategies = found.group(group).strip() if found else ""

    marks = list(source["marker"].finditer(text))
    if not marks:
        raise SystemExit(f"no essay markers found in {source['pdf']}")

    # Walk the markers, pairing each essay with the commentary that follows it.
    essays: dict[int, str] = {}
    commentary: dict[int, str] = {}
    for i, mark in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = trim(text[mark.end() : end])
        score = source["score"](mark)
        if source["is_commentary"](mark):
            commentary[score] = body
        else:
            # Only the first sighting is the essay; the sample-task PDF
            # repeats the header as running page furniture.
            essays.setdefault(score, body)

    records = []
    for score in sorted(essays, reverse=True):
        records.append(
            {
                "id": f"{source['id']}_score{score}",
                "task": "issue",
                "score": float(score),
                "score_type": "official",
                "prompt_statement": statement,
                "prompt_instruction": instruction,
                "essay": essays[score],
                "rater_commentary": commentary.get(score, ""),
                "source_pdf": source["pdf"],
            }
        )

    prompt_record = {
        "id": source["id"],
        "statement": statement,
        "instruction": instruction,
        "ets_strategies": strategies,
    }
    return prompt_record, records


def main() -> None:
    prompts = []
    anchors = []
    for source in SOURCES:
        prompt_record, records = extract(source)
        prompts.append(prompt_record)
        anchors.extend(records)
        scores = ", ".join(str(int(r["score"])) for r in records)
        missing = [r["id"] for r in records if not r["rater_commentary"]]
        print(f"{source['pdf']}: {len(records)} essays (scores {scores})")
        if missing:
            print(f"  WARNING: no commentary for {missing}")

    if len(anchors) != 18:
        raise SystemExit(f"expected 18 official Issue essays, got {len(anchors)}")

    path = write_kb(
        "anchors.json",
        {
            "source": "ETS published Issue responses with official rater commentary",
            "task": "issue",
            "count": len(anchors),
            "prompts": prompts,
            "anchors": anchors,
        },
    )

    print(f"\n{len(anchors)} anchors -> {path}")
    for record in anchors:
        essay_words = len(record["essay"].split())
        commentary_words = len(record["rater_commentary"].split())
        print(
            f"  {record['id']:<28} score {int(record['score'])}  "
            f"essay {essay_words:>4}w  commentary {commentary_words:>4}w"
        )


if __name__ == "__main__":
    main()
