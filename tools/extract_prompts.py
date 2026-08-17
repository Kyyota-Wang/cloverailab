"""Extract the official GRE Issue topic pool into kb/prompts_issue.json.

Source: Data/raw_cache/analytical-writing-pool.pdf (the current pool -- the
Argument pool is deliberately not extracted; the Argument task was retired
from the GRE on 2023-09-22).

Each pool entry is a topic statement followed by one of six task-instruction
variants. The variant matters more than the topic: it dictates which
argumentative moves a response must make, and it is where most test takers
lose points. Classifying it here lets the reviewer check compliance without
an LLM call.

Instruction text is fixed boilerplate, so each variant is matched by its own
full regex rather than by a sentence count -- the variants are 1 or 2
sentences long, and the pool interleaves page numbers into the text.
"""

from __future__ import annotations

import hashlib
import re

from common import normalise, pdf_text, write_kb

_OPEN = r"Write a response in which "

# (name, instruction regex, what the variant asks for, the moves it requires)
VARIANTS = [
    (
        "statement",
        _OPEN + r".*?explain how these considerations shape your position\.",
        "Agree/disagree with a statement, qualified by when it does and does not hold.",
        [
            "State a position on the statement.",
            "Consider ways the statement might hold true.",
            "Consider ways it might not, and explain how those considerations shape the position.",
        ],
    ),
    (
        "claim_challenge",
        _OPEN + r".*?that could be used to challenge your position\.",
        "Agree/disagree with the claim, and confront the strongest case against you.",
        [
            "State a position on the claim.",
            "Raise the most compelling reasons or examples that could challenge that position.",
            "Answer those challenges rather than merely acknowledging them.",
        ],
    ),
    (
        "claim_and_reason",
        _OPEN + r".*?reason on which th(?:at|e) claim is based\.",
        "Agree/disagree with BOTH the claim and the reason offered for it.",
        [
            "State a position on the claim.",
            "State a separate position on the reason -- a claim can be right for the wrong reason.",
            "Address the logical link between reason and claim explicitly.",
        ],
    ),
    (
        "recommendation",
        _OPEN + r".*?explain how these examples shape your position\.",
        "Agree/disagree with a recommendation, argued through specific circumstances.",
        [
            "State a position on the recommendation.",
            "Describe specific circumstances where adopting it would be advantageous.",
            "Describe specific circumstances where it would not be, and explain how both shape the position.",
        ],
    ),
    (
        "two_views",
        _OPEN + r".*?address both of the views presented\.",
        "Choose between two opposing views and defend the choice.",
        [
            "Say which of the two views is closer to your own position.",
            "Address BOTH views -- ignoring the rejected view is the standard failure here.",
            "Explain the reasoning behind the choice.",
        ],
    ),
    (
        "policy",
        _OPEN + r".*?explain how these consequences shape your position\.",
        "Take a position on a policy, argued through its consequences.",
        [
            "State a position on the policy.",
            "Consider the possible consequences of implementing it.",
            "Explain how those consequences shape the position.",
        ],
    ),
]

_COMPILED = [(name, re.compile(rx), summary, moves) for name, rx, summary, moves in VARIANTS]

# Each instruction is matched inside the slice that runs up to the *next*
# instruction, so a variant's `.*?` can never swallow an intervening topic.
_START = re.compile(_OPEN)

# Page numbers sit between one instruction and the next topic statement.
_LEADING_PAGE = re.compile(r"^\s*\d{1,3}\s+")


def match_instruction(segment: str) -> tuple[str, str, str, list[str]]:
    for name, pattern, summary, moves in _COMPILED:
        found = pattern.match(segment)
        if found:
            return name, found.group(0), summary, moves
    raise ValueError(f"unclassified task instruction: {segment[:140]!r}")


def main() -> None:
    text = normalise(pdf_text("analytical-writing-pool.pdf"))
    starts = [m.start() for m in _START.finditer(text)]
    if not starts:
        raise SystemExit("no task instructions found -- did the PDF change?")

    topics = []
    prev_end = 0
    for i, start in enumerate(starts):
        segment_end = starts[i + 1] if i + 1 < len(starts) else len(text)
        variant, instruction, summary, moves = match_instruction(text[start:segment_end])

        # The topic statement runs from the end of the previous instruction to
        # the start of this one. For the first topic that is the pool's
        # front-matter, so take only its trailing sentence-block.
        statement = _LEADING_PAGE.sub("", text[prev_end:start]).strip()
        if not i:
            statement = statement.rsplit("as it appears in the actual test. ", 1)[-1].strip()
        prev_end = start + len(instruction)

        # The pool intentionally repeats some topic statements under different
        # task instructions, so the variant is part of a topic's identity.
        key = f"{variant}\n{statement}".encode()
        topics.append(
            {
                "id": "issue_" + hashlib.sha1(key).hexdigest()[:10],
                "statement": statement,
                "instruction": instruction,
                "variant": variant,
                "variant_summary": summary,
                "required_moves": moves,
            }
        )

    counts: dict[str, int] = {}
    for topic in topics:
        counts[topic["variant"]] = counts.get(topic["variant"], 0) + 1

    path = write_kb(
        "prompts_issue.json",
        {
            "source": "ETS Pool of Analytical Writing Topics (analytical-writing-pool.pdf)",
            "task": "issue",
            "count": len(topics),
            "variant_counts": counts,
            "topics": topics,
        },
    )

    print(f"{len(topics)} topics -> {path}")
    for name, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>3}  {name}")

    unique_ids = len({t["id"] for t in topics})
    if unique_ids != len(topics):
        raise SystemExit(f"id collision: {unique_ids} unique ids for {len(topics)} topics")
    restated = len(topics) - len({t["statement"] for t in topics})
    print(f"\n{restated} statements appear under more than one task instruction")

    lengths = sorted(len(t["statement"]) for t in topics)
    print(f"\nstatement length: min {lengths[0]}, median {lengths[len(lengths) // 2]}, max {lengths[-1]}")
    suspicious = [t for t in topics if len(t["statement"]) < 40 or len(t["statement"]) > 700]
    if suspicious:
        print(f"WARNING: {len(suspicious)} statements look mis-segmented:")
        for t in suspicious[:5]:
            print("   ", t["variant"], repr(t["statement"][:160]))
    else:
        print("all statements within expected length range")


if __name__ == "__main__":
    main()
