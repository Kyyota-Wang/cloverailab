"""Collector 3 -- Magoosh "Real Student Essays with Scores" blog posts.

Magoosh publishes GRE essays written by its own students, each followed by an
analysis from a Magoosh GRE expert that ends in an explicit score on the 0-6
scale ("Score: 4.5"). These are human practice essays with a *teacher* rating,
not an official ETS score -> score_type = 'teacher_rated'.

Page layout:
    h3  GRE Issue Essay Prompt N: <title>
      h4 Prompt          -> prompt text
      h4 Instructions    -> task instruction set
      h4 Student Essay   -> the essay
      h4 ... Analysis    -> contains "Score: X"
"""
from __future__ import annotations

import os
import re
import sys

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (HttpCache, clean_text, fetch_many, make_record,  # noqa: E402
                    save_stage, word_count)

PAGES = [
    ("https://magoosh.com/gre/awa-issue-essay-strategies/", "issue"),
    ("https://magoosh.com/gre/gre-issue-essay/", "issue"),
    ("https://magoosh.com/gre/gre-argument-essay/", "argument"),
    ("https://magoosh.com/gre/gre-awa-argument-essay-sample/", "argument"),
]
CACHE = "magoosh"
SCORE_RX = re.compile(r"Score:?\s*([0-6](?:\.\d)?)\b")


def parse_page(url: str, html: str, default_type: str):
    soup = BeautifulSoup(html, "lxml")
    art = (soup.select_one("article") or soup.select_one(".entry-content")
           or soup.select_one("main") or soup)
    for t in art(["script", "style", "aside", "nav", "form"]):
        t.decompose()

    heads = art.find_all(["h2", "h3", "h4"])
    blocks = []          # (kind, title, text)
    for i, h in enumerate(heads):
        title = clean_text(h.get_text(" ", strip=True))
        end = heads[i + 1] if i + 1 < len(heads) else None
        chunk = []
        for sib in h.next_elements:
            if sib is end:
                break
            if getattr(sib, "name", None) in ("p", "blockquote", "li"):
                chunk.append(clean_text(sib.get_text(" ", strip=True)))
        text = "\n\n".join(x for x in chunk if x)
        low = title.lower()
        if low.startswith("prompt") and "essay prompt" not in low:
            kind = "prompt"
        elif low.startswith("instruction"):
            kind = "instructions"
        elif "student essay" in low or low == "essay":
            kind = "essay"
        elif "analysis" in low:
            kind = "analysis"
        elif re.match(r"(gre .*)?(issue|argument)?\s*essay prompt \d|^prompt \d", low):
            kind = "section"
        else:
            kind = "other"
        blocks.append((kind, title, text))

    records = []
    cur_prompt, cur_instr, cur_section = "", "", ""
    pending = None
    n = 0
    for kind, title, text in blocks:
        if kind == "section":
            cur_section = title
        elif kind == "prompt":
            cur_prompt = text
        elif kind == "instructions":
            cur_instr = text
        elif kind == "essay":
            pending = text
        elif kind == "analysis" and pending:
            m = SCORE_RX.search(text)
            score = float(m.group(1)) if m else ""
            if word_count(pending) >= 100:
                n += 1
                full_prompt = clean_text(
                    (cur_prompt + "\n\n" + cur_instr).strip())
                records.append(make_record(
                    essay_id=f"magoosh_{re.sub(r'[^a-z0-9]+','_',url.split('/')[-2])}_{n}",
                    essay_text=pending,
                    essay_type=default_type,
                    prompt_text=full_prompt,
                    prompt_category=cur_section or "Magoosh-selected GRE prompt",
                    score=score,
                    score_type="teacher_rated" if score != "" else "none",
                    score_scale="0-6" if score != "" else "",
                    human_authenticity="confirmed",
                    exam_or_practice="practice",
                    author_username="",
                    source_name="Magoosh GRE Blog - real student essays with scores",
                    source_url=url,
                    publication_date="",
                    evidence_for_score=(
                        "Score assigned by a Magoosh GRE expert in the published "
                        "'Essay Analysis' immediately after the essay "
                        f"(\"{m.group(0)}\")." if m else ""),
                    evidence_for_human_authorship=(
                        "Magoosh explicitly presents these as essays written by its "
                        "own students ('8 Real Student Essays with Scores'); the "
                        "expert commentary discusses each writer's individual "
                        "grammar and spelling errors."),
                    notes=f"Section: {cur_section}. Analysis excerpt: "
                          f"{text[:300]}",
                ))
            pending = None
    return records


def main():
    cache = HttpCache(CACHE)
    fetch_many(cache, [u for u, _ in PAGES], workers=2, delay=1.0)
    types = dict(PAGES)
    records = []
    for url, body in cache.iter_ok():
        recs = parse_page(url, body, types.get(url, "issue"))
        print(f"{url} -> {len(recs)}")
        records += recs
    for r in records:
        print(f"  {r['essay_id']:<40} score={r['score']} wc={r['word_count']}")
    save_stage("magoosh", records)


if __name__ == "__main__":
    main()
