"""Collector 5 -- ArguGPT human-written GRE essays (Kaggle).

590 human-written GRE essays from the ArguGPT corpus (Hu et al. 2023),
explicitly labeled as human vs machine-generated.

Human authenticity: ArguGPT explicitly distinguishes human essays from
machine-generated ones as the core of their research, so the human essays
are confirmed authentic by academic publication.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (classify_task, make_essay_id, make_record,  # noqa: E402
                    save_stage, word_count)

CSV_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "argugpt_raw", "argugpt.csv"
)


def parse_all():
    records = []
    with open(CSV_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            eid = row.get("id", "")
            if not eid.startswith("gre_"):
                continue

            prompt = row.get("prompt", "").strip()
            essay = row.get("text", "").strip()
            level = row.get("score_level", "").strip()

            if word_count(essay) < 50:
                continue

            # Every GRE prompt in this corpus is an Issue topic: a position
            # statement followed by "Do you agree or disagree?" (checked across
            # all 590 -- none contains an Argument passage). ArguGPT replaced
            # the real GRE instruction with a TOEFL-style one, so the generic
            # classifier cannot see the task type from the wording alone.
            task = classify_task(prompt, essay)
            if task == "unknown" and re.search(
                    r"do you agree or disagree", prompt, re.I):
                task = "issue"

            records.append(
                make_record(
                    essay_id=make_essay_id("argugpt", eid),
                    essay_text=essay,
                    essay_type=task,
                    prompt_text=prompt,
                    prompt_category="GRE Issue pool topic, reworded by the corpus "
                                    "authors with a TOEFL-style instruction line",
                    score="",
                    score_type="none",
                    score_scale="",
                    human_authenticity="confirmed",
                    exam_or_practice="practice",
                    author_username="",
                    source_name="ArguGPT corpus (Kaggle) - human essays",
                    source_url="https://www.kaggle.com/datasets/alejopaullier/argugpt",
                    publication_date="2023",
                    evidence_for_score="",
                    evidence_for_human_authorship=(
                        "Published in ArguGPT corpus (Hu et al. 2023) as "
                        "human-written GRE essays, explicitly distinguished "
                        "from machine-generated responses in academic research."
                    ),
                    notes=f"proficiency_level: {level}" if level else "",
                )
            )

    print(f"parsed {len(records)} ArguGPT GRE essays")
    save_stage("argugpt", records)


if __name__ == "__main__":
    parse_all()
